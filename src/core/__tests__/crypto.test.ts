import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  DEK_BYTES,
  IV_BYTES,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  base64ToBytes,
  bytesToBase64,
  checkPassword,
  decryptJson,
  deriveKek,
  deriveRecoveryKek,
  encryptJson,
  generateDek,
  generateRecoveryCode,
  normalizeRecoveryCode,
  randomBytes,
  unwrapDek,
  wrapDek,
} from '../crypto';
import type { SealedBlob } from '../crypto';

/** 测试里把迭代数压到很小，600k 会让每个用例慢上一秒；生产默认值另有单独断言 */
const TEST_ITER = 1_000;

async function kekFor(password: string, salt = randomBytes(SALT_BYTES)) {
  return deriveKek(password, salt, TEST_ITER);
}

describe('base64', () => {
  it('往返不丢字节，含 0x00 与 0xFF', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 254]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('长输入也不会爆栈（分块编码）', () => {
    const bytes = randomBytes(100_000);
    expect(base64ToBytes(bytesToBase64(bytes)).length).toBe(100_000);
  });

  it('坏 base64 抛 malformed', () => {
    expect(() => base64ToBytes('!!!')).toThrow(CryptoError);
  });
});

describe('DEK 包装与解封', () => {
  it('密码正确能解回原始 DEK', async () => {
    const dek = generateDek();
    const kek = await kekFor('correct horse battery');
    const wrapped = await wrapDek(dek, kek);
    const back = await unwrapDek(wrapped, kek);
    expect(Array.from(back)).toEqual(Array.from(dek));
  });

  it('密码错误抛 wrong-key', async () => {
    const dek = generateDek();
    const salt = randomBytes(SALT_BYTES);
    const good = await deriveKek('right-password-here', salt, TEST_ITER);
    const wrapped = await wrapDek(dek, good);
    const bad = await deriveKek('wrong-password-here', salt, TEST_ITER);
    await expect(unwrapDek(wrapped, bad)).rejects.toMatchObject({ reason: 'wrong-key' });
  });

  it('密文被改一个 bit 也解不开', async () => {
    const dek = generateDek();
    const kek = await kekFor('tamper-me-please');
    const wrapped = await wrapDek(dek, kek);
    const raw = base64ToBytes(wrapped.ct);
    raw[0] = (raw[0] ?? 0) ^ 0x01;
    const tampered: SealedBlob = { ...wrapped, ct: bytesToBase64(raw) };
    await expect(unwrapDek(tampered, kek)).rejects.toMatchObject({ reason: 'wrong-key' });
  });

  it('IV 被换掉解不开（GCM 认证覆盖 IV 之外的整包）', async () => {
    const dek = generateDek();
    const kek = await kekFor('iv-swap-attempt');
    const wrapped = await wrapDek(dek, kek);
    const other = await wrapDek(generateDek(), kek); // 另一条记录，结构合法
    const moved: SealedBlob = { ...wrapped, iv: other.iv };
    await expect(unwrapDek(moved, kek)).rejects.toMatchObject({ reason: 'wrong-key' });
  });

  it('IV 长度不对是 malformed，不是 wrong-key', async () => {
    const dek = generateDek();
    const kek = await kekFor('short-iv-case');
    const wrapped = await wrapDek(dek, kek);
    const bad: SealedBlob = { ...wrapped, iv: bytesToBase64(new Uint8Array(8)) };
    await expect(unwrapDek(bad, kek)).rejects.toMatchObject({ reason: 'malformed' });
  });

  it('版本号不认识就拒绝，不猜', async () => {
    const dek = generateDek();
    const kek = await kekFor('future-version');
    const wrapped = await wrapDek(dek, kek);
    const future = { ...wrapped, v: 2 } as unknown as SealedBlob;
    await expect(unwrapDek(future, kek)).rejects.toMatchObject({
      reason: 'unsupported-version',
    });
  });

  it('每次包装的 IV 都不同', async () => {
    const dek = generateDek();
    const kek = await kekFor('iv-uniqueness');
    const a = await wrapDek(dek, kek);
    const b = await wrapDek(dek, kek);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(base64ToBytes(a.iv).length).toBe(IV_BYTES);
  });
});

describe('vault 加解密', () => {
  const vault = {
    version: 1,
    accounts: [{ id: 'a1', issuer: '示例', account: 'u@example.com', secret: 'JBSWY3DPEHPK3PXP' }],
    groups: [],
  };

  it('往返后结构一致（含中文与 emoji）', async () => {
    const dek = generateDek();
    const blob = await encryptJson(dek, { ...vault, note: '中文 🎉' });
    const back = await decryptJson<typeof vault & { note: string }>(dek, blob);
    expect(back).toEqual({ ...vault, note: '中文 🎉' });
  });

  it('AAD 隔离：vault 密文塞进 dekWrap 位置解不开', async () => {
    const dek = generateDek();
    const kek = await kekFor('cross-purpose');
    const vaultBlob = await encryptJson(dek, vault);
    // 结构完全合法，但 AAD 不同 —— 这正是我们要拦的"张冠李戴"
    await expect(unwrapDek(vaultBlob, kek)).rejects.toMatchObject({ reason: 'wrong-key' });
  });

  it('换 DEK 解不开', async () => {
    const blob = await encryptJson(generateDek(), vault);
    await expect(decryptJson(generateDek(), blob)).rejects.toMatchObject({
      reason: 'wrong-key',
    });
  });

  it('DEK 长度不对时明确报错', async () => {
    await expect(encryptJson(new Uint8Array(16), vault)).rejects.toMatchObject({
      reason: 'malformed',
    });
  });
});

describe('恢复码', () => {
  it('长度 32 字符、8 组 4 字、只含 base32 字母表', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
    expect(normalizeRecoveryCode(code)).toHaveLength(32);
  });

  it('两次生成不重复', () => {
    const set = new Set(Array.from({ length: 20 }, () => generateRecoveryCode()));
    expect(set.size).toBe(20);
  });

  it('忽略大小写、空格与连字符', () => {
    const code = generateRecoveryCode();
    const messy = ` ${code.toLowerCase().replace(/-/g, ' ')} `;
    expect(normalizeRecoveryCode(messy)).toBe(normalizeRecoveryCode(code));
  });

  it('长度不对或含非法字符都拒绝', () => {
    expect(() => normalizeRecoveryCode('ABCD')).toThrow(CryptoError);
    expect(() => normalizeRecoveryCode('0O1I'.repeat(8))).toThrow(CryptoError);
  });

  it('恢复码能解封 DEK，错的恢复码不能', async () => {
    const dek = generateDek();
    const code = generateRecoveryCode();
    const wrapped = await wrapDek(dek, await deriveRecoveryKek(code));
    await expect(unwrapDek(wrapped, await deriveRecoveryKek(code))).resolves.toHaveLength(DEK_BYTES);

    let other = generateRecoveryCode();
    while (other === code) other = generateRecoveryCode();
    await expect(unwrapDek(wrapped, await deriveRecoveryKek(other))).rejects.toMatchObject({
      reason: 'wrong-key',
    });
  });
});

describe('密码策略', () => {
  it('8 位起步，不要求字符种类', () => {
    expect(checkPassword('aaaaaaaa').ok).toBe(true);
    expect(checkPassword('aB3$xY9!').ok).toBe(true);
  });

  it('太短给出具体差几位', () => {
    const result = checkPassword('abc');
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('8');
  });

  it('20 个以上相同字符被判为凑长度', () => {
    expect(checkPassword('a'.repeat(24)).ok).toBe(false);
  });
});

describe('生产参数', () => {
  it('迭代数是 600k，且真的跑得动', async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const started = Date.now();
    const kek = await deriveKek('performance-check', randomBytes(SALT_BYTES));
    expect(kek.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    // 只是防呆：真机上 600k 大约几百毫秒，超过 10 秒说明环境有问题
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('salt 长度不对直接拒绝', async () => {
    await expect(deriveKek('whatever-1', new Uint8Array(8), TEST_ITER)).rejects.toMatchObject({
      reason: 'malformed',
    });
  });
});
