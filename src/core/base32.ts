/**
 * RFC 4648 base32（无填充）。
 *
 * 容错是刻意的：用户从网页上抄密钥时会带空格、连字符、小写、末尾 `=`，
 * 全都应该能正常导入，而不是逼人手动清洗。
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 合法 base32 的字符数对 8 取模只可能是这几个值 */
const VALID_REMAINDERS = new Set([0, 2, 4, 5, 7]);

export class Base32Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Base32Error';
  }
}

/** 去掉空格/连字符/下划线、转大写、剥掉末尾填充 */
export function normalizeBase32(input: string): string {
  return input
    .replace(/[\s\-_]/g, '')
    .toUpperCase()
    .replace(/=+$/, '');
}

export function base32Decode(input: string): Uint8Array {
  const clean = normalizeBase32(input);

  if (clean.length === 0) {
    throw new Base32Error('密钥为空');
  }

  if (!VALID_REMAINDERS.has(clean.length % 8)) {
    throw new Base32Error('密钥长度非法');
  }

  const out: number[] = [];
  let value = 0;
  let bits = 0;

  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Base32Error(`密钥包含非法字符：${ch}`);
    }

    value = (value << 5) | idx;
    bits += 5;

    while (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }

    // 丢掉已消费的高位，保证 value 里只剩未消费的 bits 位
    value &= (1 << bits) - 1;
  }

  // 剩余位必须全 0，否则说明输入被截断过
  if (value !== 0) {
    throw new Base32Error('密钥长度非法');
  }

  return Uint8Array.from(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let value = 0;
  let bits = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET.charAt((value >>> bits) & 0x1f);
    }

    value &= (1 << bits) - 1;
  }

  // 末尾不足 5 位的补零成一组
  if (bits > 0) {
    out += ALPHABET.charAt((value << (5 - bits)) & 0x1f);
  }

  return out;
}
