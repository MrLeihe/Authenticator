import type { Algorithm } from './types';

const WEB_CRYPTO_ALG: Record<Algorithm, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};

const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;

export interface TotpOptions {
  algorithm?: Algorithm;
  digits?: 6 | 8;
  period?: number;
  /** 毫秒时间戳，默认取当前时间。测试里显式传值，不要 mock 全局时钟。 */
  now?: number;
}

export interface TotpResult {
  code: string;
  /** 第几个时间窗（floor(unixSeconds / period)） */
  counter: number;
  /** 当前窗口剩余秒数，1..period */
  remaining: number;
  /** 当前窗口何时结束（毫秒时间戳） */
  expiresAt: number;
}

/** 把计数器写成 8 字节大端。用 BigInt，避免 2^32 之后溢出。 */
function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(counter), false);
  return buf;
}

/**
 * RFC 4226 HOTP。
 * 注意：WebCrypto 的 sign 是异步的，这里没有同步版本可用。
 */
export async function hotp(
  key: Uint8Array,
  counter: number,
  digits: 6 | 8 = DEFAULT_DIGITS,
  algorithm: Algorithm = 'SHA1',
): Promise<string> {
  if (key.length === 0) {
    throw new Error('密钥为空');
  }
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error('计数器非法');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    // Uint8Array<ArrayBufferLike> 与 BufferSource 的 TS 兼容性用 slice 归一
    key.slice(),
    { name: 'HMAC', hash: WEB_CRYPTO_ALG[algorithm] },
    false,
    ['sign'],
  );

  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes(counter).slice()));

  // 动态截断：偏移量取**最后一个字节**的低 4 位。
  // 不能写死 mac[19] —— 那只对 SHA1 成立。
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;

  const b0 = mac[offset] ?? 0;
  const b1 = mac[offset + 1] ?? 0;
  const b2 = mac[offset + 2] ?? 0;
  const b3 = mac[offset + 3] ?? 0;

  // 去掉最高位，得到 31 位无符号整数（用 >>> 0 保证不落到负数）
  const binary = (((b0 & 0x7f) << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;

  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, '0');
}

/** RFC 6238 TOTP */
export async function totp(secret: Uint8Array, opts: TotpOptions = {}): Promise<TotpResult> {
  const {
    algorithm = 'SHA1',
    digits = DEFAULT_DIGITS,
    period = DEFAULT_PERIOD,
    now = Date.now(),
  } = opts;

  if (!Number.isFinite(period) || period <= 0) {
    throw new Error('周期非法');
  }

  const unixSeconds = Math.floor(now / 1000);
  const counter = Math.floor(unixSeconds / period);
  const code = await hotp(secret, counter, digits, algorithm);

  return {
    code,
    counter,
    remaining: period - (unixSeconds % period),
    expiresAt: (counter + 1) * period * 1000,
  };
}

/** 只要剩余秒数时用它，避免为了一个倒计时去算 HMAC */
export function remainingSeconds(period: number = DEFAULT_PERIOD, now: number = Date.now()): number {
  const unixSeconds = Math.floor(now / 1000);
  return period - (unixSeconds % period);
}

/** 把 6/8 位码切成 3+3（8 位切 4+4），仅用于展示 */
export function formatCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}
