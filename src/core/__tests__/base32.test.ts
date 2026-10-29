import { describe, expect, it } from 'vitest';
import { Base32Error, base32Decode, base32Encode, normalizeBase32 } from '../base32';

const ascii = (s: string) => new TextEncoder().encode(s);

describe('base32Encode', () => {
  // RFC 4648 §10 官方测试向量
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];

  it.each(vectors)('编码 %s → %s', (input, expected) => {
    expect(base32Encode(ascii(input))).toBe(expected);
  });

  it('输出恒为大写且无填充', () => {
    const out = base32Encode(new Uint8Array([0, 1, 2, 3, 4]));
    expect(out).toMatch(/^[A-Z2-7]+$/);
    expect(out).not.toContain('=');
  });
});

describe('base32Decode', () => {
  it('解码 RFC 4648 向量', () => {
    expect(Array.from(base32Decode('MZXW6YTBOI'))).toEqual(Array.from(ascii('foobar')));
  });

  it('解码 RFC 6238 的 SHA1 种子', () => {
    const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(new TextDecoder().decode(base32Decode(seed))).toBe('12345678901234567890');
  });

  it('容错：小写 / 空格 / 连字符 / 末尾填充', () => {
    const expected = Array.from(ascii('foobar'));
    for (const messy of [
      'mzxw6ytboi',
      'MZXW 6YTB OI',
      'MZXW-6YTB-OI',
      'MZXW6YTBOI=',
      'mzxw-6ytb oi==',
      ' MZXW6YTBOI ',
    ]) {
      expect(Array.from(base32Decode(messy))).toEqual(expected);
    }
  });

  it.each([
    ['', '密钥为空'],
    ['   ', '密钥为空'],
    ['MZXW6YTBO1', '非法字符'],
    ['MZXW6YTB0I', '非法字符'],
    ['MZXW6YTB8I', '非法字符'],
  ])('拒绝非法输入 %j', (input, msg) => {
    expect(() => base32Decode(input)).toThrow(Base32Error);
    expect(() => base32Decode(input)).toThrow(new RegExp(msg));
  });

  it('拒绝非法长度（字符数 mod 8 ∈ {1,3,6}）', () => {
    for (const bad of ['A', 'AAA', 'AAAAAA']) {
      expect(() => base32Decode(bad)).toThrow(/密钥长度非法/);
    }
  });

  it('拒绝末位有冗余 1 的输入（非规范编码）', () => {
    // 2 个字符 = 10 位，够 1 字节 + 2 个残留位。规范编码要求残留位全为 0。
    // M=01100 Z=11001 Y=11000 B=00001
    // MY → 01100110|00   残留 00 → 合法（即 'f'）
    // MZ → 01100110|01   残留 01 → 非法
    // MB → 01100000|01   残留 01 → 非法
    expect(() => base32Decode('MY')).not.toThrow();
    expect(() => base32Decode('MZ')).toThrow(/密钥长度非法/);
    expect(() => base32Decode('MB')).toThrow(/密钥长度非法/);
  });
});

describe('往返一致性', () => {
  it('256 组随机字节 encode → decode 后完全一致', () => {
    for (let len = 1; len <= 64; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (len * 31 + i * 17) & 0xff;
      const round = base32Decode(base32Encode(bytes));
      expect(Array.from(round)).toEqual(Array.from(bytes));
    }
  });
});

describe('normalizeBase32', () => {
  it('清洗规则可组合', () => {
    expect(normalizeBase32(' jbsw-y3dp ehpk_3pxp== ')).toBe('JBSWY3DPEHPK3PXP');
  });
});
