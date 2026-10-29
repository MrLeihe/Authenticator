import { describe, expect, it } from 'vitest';
import { formatCode, hotp, remainingSeconds, totp } from '../totp';

const ascii = (s: string) => new TextEncoder().encode(s);

/**
 * RFC 6238 附录 B 官方测试向量。
 * 三个算法用的种子长度不同，这是 RFC 里最容易被抄错的地方。
 */
const SEEDS = {
  SHA1: ascii('12345678901234567890'),
  SHA256: ascii('12345678901234567890123456789012'),
  SHA512: ascii(
    '1234567890123456789012345678901234567890123456789012345678901234',
  ),
} as const;

const VECTORS: Array<{ t: number; sha1: string; sha256: string; sha512: string }> = [
  { t: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
  { t: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
  { t: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
  { t: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
  { t: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
  { t: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
];

describe('TOTP · RFC 6238 官方向量', () => {
  for (const v of VECTORS) {
    it(`T=${v.t}`, async () => {
      const now = v.t * 1000;
      const sha1 = await totp(SEEDS.SHA1, { algorithm: 'SHA1', digits: 8, now });
      const sha256 = await totp(SEEDS.SHA256, { algorithm: 'SHA256', digits: 8, now });
      const sha512 = await totp(SEEDS.SHA512, { algorithm: 'SHA512', digits: 8, now });

      expect(sha1.code).toBe(v.sha1);
      expect(sha256.code).toBe(v.sha256);
      expect(sha512.code).toBe(v.sha512);
    });
  }

  it('六组向量全部通过（合计 18 个断言）', () => {
    expect(VECTORS).toHaveLength(6);
  });
});

describe('TOTP · 时间窗', () => {
  it('counter = floor(unixSeconds / period)', async () => {
    const r = await totp(SEEDS.SHA1, { now: 59_000 });
    expect(r.counter).toBe(1); // floor(59/30)
  });

  it('窗口边界处刚好翻到下一个 counter', async () => {
    const before = await totp(SEEDS.SHA1, { now: 29_999 });
    const after = await totp(SEEDS.SHA1, { now: 30_000 });
    expect(before.counter).toBe(0);
    expect(after.counter).toBe(1);
    expect(before.code).not.toBe(after.code);
  });

  it('remaining 落在 1..period', async () => {
    for (const ms of [0, 999, 1000, 15_000, 29_000, 29_999, 30_000]) {
      const r = await totp(SEEDS.SHA1, { now: ms });
      expect(r.remaining).toBeGreaterThanOrEqual(1);
      expect(r.remaining).toBeLessThanOrEqual(30);
    }
  });

  it('expiresAt 是当前窗口的结束时刻', async () => {
    const r = await totp(SEEDS.SHA1, { now: 45_000 });
    expect(r.expiresAt).toBe(60_000);
  });

  it('支持自定义周期', async () => {
    const r = await totp(SEEDS.SHA1, { period: 60, now: 90_000 });
    expect(r.counter).toBe(1); // floor(90/60)
    expect(r.remaining).toBe(30);
  });
});

describe('TOTP · 位数', () => {
  it('6 位等于 8 位去掉前两位', async () => {
    for (const t of [59, 1111111109, 2000000000]) {
      const now = t * 1000;
      const eight = await totp(SEEDS.SHA1, { digits: 8, now });
      const six = await totp(SEEDS.SHA1, { digits: 6, now });
      expect(six.code).toBe(eight.code.slice(2));
    }
  });

  it('始终补齐到指定位数', async () => {
    const r = await totp(SEEDS.SHA1, { digits: 6, now: 1111111109_000 });
    expect(r.code).toHaveLength(6);
    expect(r.code).toMatch(/^\d{6}$/);
  });
});

describe('HOTP 原语', () => {
  it('RFC 4226 附录 D 向量（counter 0..9）', async () => {
    const key = ascii('12345678901234567890');
    const expected = [
      '755224', '287082', '359152', '969429', '338314',
      '254676', '287922', '162583', '399871', '520489',
    ];
    for (let c = 0; c < expected.length; c++) {
      expect(await hotp(key, c)).toBe(expected[c]);
    }
  });

  it('counter 超过 2^32 不溢出', async () => {
    const key = ascii('12345678901234567890');
    const code = await hotp(key, 2 ** 32 + 1, 8);
    expect(code).toMatch(/^\d{8}$/);
  });

  it('拒绝空密钥和非法计数器', async () => {
    await expect(hotp(new Uint8Array(0), 0)).rejects.toThrow(/密钥为空/);
    const key = ascii('12345678901234567890');
    await expect(hotp(key, -1)).rejects.toThrow(/计数器非法/);
    await expect(hotp(key, 1.5)).rejects.toThrow(/计数器非法/);
  });
});

describe('remainingSeconds', () => {
  it('不依赖 HMAC，纯时间换算', () => {
    expect(remainingSeconds(30, 0)).toBe(30);
    expect(remainingSeconds(30, 1000)).toBe(29);
    expect(remainingSeconds(30, 29_500)).toBe(1);
    expect(remainingSeconds(30, 30_000)).toBe(30);
    // 60 秒周期：t=15s 时窗口还剩 45s，t=45s 时只剩 15s
    expect(remainingSeconds(60, 15_000)).toBe(45);
    expect(remainingSeconds(60, 45_000)).toBe(15);
    expect(remainingSeconds(60, 59_999)).toBe(1);
  });
});

describe('formatCode', () => {
  it('6 位切 3+3，8 位切 4+4', () => {
    expect(formatCode('288139')).toBe('288 139');
    expect(formatCode('94287082')).toBe('9428 7082');
  });
});
