import { describe, expect, it } from 'vitest';
import {
  ImportError,
  createEncryptedExport,
  detectImportKind,
  exportAccountsToText,
  exportParams,
  parseImport,
  planImport,
} from '../backup';
import { CryptoError, encryptJson } from '../crypto';
import { buildOtpauth, parseOtpauth } from '../otpauth';
import type { OtpAuthParams } from '../otpauth';
import type { Account } from '../types';
import { addAccount, emptyVault } from '../vault';

/**
 * 这些用例只用 RFC 4648 的公开示例密钥，不含任何真实账户。
 * 加密相关的用例走真实参数（600k 次 PBKDF2），每次约 50ms。
 */

const PASSWORD = 'correct horse battery';
const RFC_SECRET = 'JBSWY3DPEHPK3PXP';
const RFC_SECRET_2 = 'GEZDGNBVGY3TQOJQ';

function makeAccount(issuer: string, account: string, secret: string): Account {
  return addAccount(emptyVault(), { issuer, account, secret }).accounts[0] as Account;
}

const ACCOUNTS: Account[] = [
  makeAccount('示例站点', 'alice@example.com', RFC_SECRET),
  makeAccount('', 'bob@example.com', RFC_SECRET_2),
];

describe('buildOtpauth · 与解析器成对', () => {
  it('字段全写出来，解析回来一个不少', () => {
    const params: OtpAuthParams = {
      issuer: '示例 站点',
      account: 'alice@example.com',
      secret: RFC_SECRET,
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
    };
    expect(parseOtpauth(buildOtpauth(params))).toEqual(params);
  });

  it('没有 issuer 时不写 issuer 参数，也不留一个空的冒号', () => {
    const uri = buildOtpauth({
      issuer: '',
      account: 'bob@example.com',
      secret: RFC_SECRET_2,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    expect(uri).not.toContain('issuer=');
    expect(uri).toContain('otpauth://totp/bob%40example.com?');
    expect(parseOtpauth(uri).issuer).toBe('');
  });

  it('空格编码成 %20 而不是 +：不少第三方验证器不会把 + 还原成空格', () => {
    const uri = buildOtpauth({
      issuer: '示例 站点',
      account: 'alice@example.com',
      secret: RFC_SECRET,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    expect(uri).toContain('%20');
    expect(uri).not.toContain('+');
  });
});

describe('明文导出 → 导入', () => {
  it('每行一条，导出再导入字段逐条一致', async () => {
    const text = exportAccountsToText(ACCOUNTS);
    expect(text.split('\n')).toHaveLength(2);
    expect(text.split('\n')[0]?.startsWith('otpauth://totp/')).toBe(true);

    const parsed = await parseImport(text);
    expect(parsed.kind).toBe('otpauth');
    expect(parsed.drafts).toEqual(exportParams(ACCOUNTS));
    expect(parsed.issues).toEqual([]);
  });

  it('夹着说明文字的明文也能挑出来', async () => {
    const text = `这是我的账号：\n${buildOtpauth(exportParams(ACCOUNTS)[0]!)}\n另一条：${buildOtpauth(exportParams(ACCOUNTS)[1]!)}`;
    const parsed = await parseImport(text);
    expect(parsed.drafts).toHaveLength(2);
  });

  it('一条能解析一条不能时，好的收下、坏的记账', async () => {
    const text = [
      buildOtpauth(exportParams(ACCOUNTS)[0]!),
      `otpauth://totp/bad?secret=${RFC_SECRET}&digits=7`,
    ].join('\n');
    const parsed = await parseImport(text);
    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatch(/位数/);
  });

  it('报错信息里不会把密钥带出来', async () => {
    const parsed = await parseImport(`otpauth://totp/bad?secret=????&algorithm=SHA1`);
    expect(parsed.issues.join(' ')).not.toContain('????');
  });
});

describe('加密 JSON 导出 → 导入', () => {
  it('往返一致，且文件里查不到明文密钥', async () => {
    const text = await createEncryptedExport(ACCOUNTS, PASSWORD);
    expect(text).not.toContain(RFC_SECRET);
    expect(text).not.toContain('alice@example.com');
    expect(detectImportKind(text)).toBe('encrypted-json');

    const parsed = await parseImport(text, PASSWORD);
    expect(parsed.drafts).toEqual(exportParams(ACCOUNTS));
  });

  it('不给密码时明确要求密码，而不是报一个含糊的失败', async () => {
    const text = await createEncryptedExport(ACCOUNTS, PASSWORD);
    await expect(parseImport(text)).rejects.toMatchObject({ reason: 'encrypted' });
  });

  it('密码错 → wrong-key，不泄露是密码错还是文件被改', async () => {
    const text = await createEncryptedExport(ACCOUNTS, PASSWORD);
    await expect(parseImport(text, 'another fine password')).rejects.toBeInstanceOf(CryptoError);
  });

  it('密文被改过一个字节 → 解不开', async () => {
    const text = await createEncryptedExport(ACCOUNTS, PASSWORD);
    const file = JSON.parse(text) as { payload: { ct: string } };
    const ct = file.payload.ct;
    file.payload.ct = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    await expect(parseImport(JSON.stringify(file), PASSWORD)).rejects.toBeInstanceOf(CryptoError);
  });

  it('导出密码太短时直接拒绝，不生成一份"看起来能用"的备份', async () => {
    await expect(createEncryptedExport(ACCOUNTS, 'short')).rejects.toBeInstanceOf(CryptoError);
  });

  it('保险库密文搬不进来：两边的 AAD 不同', async () => {
    // 用 vault 的密文冒充导出载荷：即使密码对，也只会得到 wrong-key
    const text = await createEncryptedExport(ACCOUNTS, PASSWORD);
    const file = JSON.parse(text) as Record<string, unknown>;
    file.payload = await encryptJson(new TextEncoder().encode(RFC_SECRET.padEnd(32, 'A')), {
      accounts: exportParams(ACCOUNTS),
    });
    await expect(parseImport(JSON.stringify(file), PASSWORD)).rejects.toBeInstanceOf(CryptoError);
  });

  it('版本比我们新时给出可操作的提示', async () => {
    const text = await createEncryptedExport(ACCOUNTS, PASSWORD);
    const file = JSON.parse(text) as Record<string, unknown>;
    file.version = 2;
    await expect(parseImport(JSON.stringify(file), PASSWORD)).rejects.toMatchObject({
      reason: 'unsupported-version',
    });
  });

  it('不是本扩展导出的 JSON → 说清楚，而不是当成坏文件', async () => {
    await expect(parseImport('{"hello":"world"}', PASSWORD)).rejects.toBeInstanceOf(ImportError);
    await expect(parseImport('{"hello":"world"}', PASSWORD)).rejects.toMatchObject({
      reason: 'not-export',
    });
  });
});

describe('别的工具导出的裸 JSON 数组', () => {
  it('也收，缺算法/位数/周期时用默认值', async () => {
    const text = JSON.stringify([
      { issuer: '示例', account: 'a@example.com', secret: RFC_SECRET.toLowerCase() },
    ]);
    const parsed = await parseImport(text);
    expect(parsed.kind).toBe('json');
    expect(parsed.drafts[0]).toEqual({
      issuer: '示例',
      account: 'a@example.com',
      secret: RFC_SECRET,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  });

  it('密钥不合法的条目跳过并记账，不整包拒绝', async () => {
    const text = JSON.stringify([
      { issuer: '示例', account: 'a@example.com', secret: RFC_SECRET },
      { issuer: '坏的', account: 'b@example.com', secret: 'not-base32!' },
    ]);
    const parsed = await parseImport(text);
    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toContain('第 2 条');
  });
});

describe('detectImportKind', () => {
  it('空内容 / 迁移码 / 明文 / 封装 JSON 各自认得出来', async () => {
    expect(detectImportKind('   ')).toBe('empty');
    expect(detectImportKind('otpauth-migration://offline?data=AAAA')).toBe('migration');
    expect(detectImportKind(buildOtpauth(exportParams(ACCOUNTS)[0]!))).toBe('otpauth');
    expect(detectImportKind('随便一段话')).toBe('empty');
    expect(detectImportKind(await createEncryptedExport(ACCOUNTS, PASSWORD))).toBe('encrypted-json');
  });

  it('空内容导入时给出明确的一句话', async () => {
    await expect(parseImport('  ')).rejects.toMatchObject({ reason: 'empty' });
  });
});

describe('planImport · 只做加法', () => {
  const draft = (over: Partial<OtpAuthParams> = {}): OtpAuthParams => ({
    issuer: '示例',
    account: 'a@example.com',
    secret: RFC_SECRET,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    ...over,
  });

  const parsed = (drafts: OtpAuthParams[]): Parameters<typeof planImport>[1] => ({
    kind: 'otpauth',
    drafts,
    issues: [],
    batch: null,
  });

  it('空库里全部新增', () => {
    const plan = planImport([], parsed([draft()]));
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]?.note).toBeNull();
    expect(plan.skip).toHaveLength(0);
  });

  it('同一个密钥已存在 → 跳过，而不是再来一条', () => {
    const existing = [makeAccount('另一个名字', 'x@example.com', RFC_SECRET)];
    const plan = planImport(existing, parsed([draft()]));
    expect(plan.add).toHaveLength(0);
    expect(plan.skip[0]?.reason).toContain('已存在');
  });

  it('同名不同密钥 → 新增并标注，绝不覆盖', () => {
    const existing = [makeAccount('示例', 'a@example.com', RFC_SECRET_2)];
    const plan = planImport(existing, parsed([draft()]));
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]?.note).toContain('同名');
  });

  it('文件内部重复的密钥只收一条', () => {
    const plan = planImport([], parsed([draft(), draft({ account: 'b@example.com' })]));
    expect(plan.add).toHaveLength(1);
    expect(plan.skip).toHaveLength(1);
    expect(plan.skip[0]?.reason).toContain('重复');
  });

  it('名字大小写不同也算同名', () => {
    const existing = [makeAccount('Example', 'A@Example.com', RFC_SECRET_2)];
    const plan = planImport(existing, parsed([draft({ issuer: 'example', account: 'a@example.COM' })]));
    expect(plan.add[0]?.note).toContain('同名');
  });
});

describe('导出→导入 完整闭环（模拟卸载重装）', () => {
  it('新库里导入后，账户与原来逐条一致且验证码相同', async () => {
    const text = await createEncryptedExport(ACCOUNTS, PASSWORD);
    const parsed = await parseImport(text, PASSWORD);
    const plan = planImport([], parsed);
    expect(plan.add).toHaveLength(2);

    const rebuilt = plan.add.reduce(
      (vault, entry) => addAccount(vault, entry.draft),
      emptyVault(),
    );
    expect(rebuilt.accounts.map((a) => [a.issuer, a.account, a.secret, a.algorithm])).toEqual(
      ACCOUNTS.map((a) => [a.issuer, a.account, a.secret, a.algorithm]),
    );
  });
});
