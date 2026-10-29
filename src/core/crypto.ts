import { base32Decode, base32Encode } from './base32';

/**
 * 加密原语。只做三件事：派生、封装、解封。
 *
 * 设计要点（改动前请先看完）：
 * 1. **一条代码路径**。vault 永远是一团密文，区别只在 `dekWrap` 是
 *    `none` / `password` / `recovery` 哪一种。开关加密 = 换一个 wrap，
 *    vault 密文一个字都不动，所以不存在"加密版 / 明文版"两条分支。
 * 2. **AAD 做用途隔离**。vault 密文与 DEK 包装用不同的 additionalData，
 *    把其中一团的密文挪到另一个字段会直接解不开，而不是"看起来能解"。
 * 3. **失败必须是异常，不能返回空值**。解封失败一律抛 `CryptoError`，
 *    调用方据此区分"密码错"与"数据坏"，绝不会把半个 vault 当成功。
 */

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const DEK_BYTES = 32;
/** 恢复码熵：20 字节 = 160 bit，base32 后正好 32 字符 */
export const RECOVERY_BYTES = 20;
export const MIN_PASSWORD_LENGTH = 8;

/** 用途隔离标签，写进 GCM 的 additionalData */
const AAD_VAULT = '2fa/vault/v1';
const AAD_DEK = '2fa/dek/v1';
const AAD_EXPORT = '2fa/export/v1';
const AAD_RECOVERY_LABEL = '2fa/recovery/v1';

export type CryptoFailure =
  /** 密码 / 恢复码不对，或密文被改过 —— GCM 校验失败，两者不可区分 */
  | 'wrong-key'
  /** 形状不对：base64 坏、长度不对、字段缺失 */
  | 'malformed'
  /** 版本比我们认识的新 */
  | 'unsupported-version';

export class CryptoError extends Error {
  constructor(
    readonly reason: CryptoFailure,
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'CryptoError';
  }
}

/** 统一密文形状。`v` 留给将来换参数（比如 AES-GCM → XChaCha）。 */
export interface SealedBlob {
  v: 1;
  /** base64，12 字节 */
  iv: string;
  /** base64，含 GCM tag */
  ct: string;
}

/** DEK 的三种包装方式，见 SPEC §3.5 */
export type DekWrap =
  | { v: 1; kind: 'none'; dek: string }
  | { v: 1; kind: 'password'; salt: string; iter: number; iv: string; ct: string }
  | { v: 1; kind: 'recovery'; iv: string; ct: string };

// ---------------------------------------------------------------- 随机与编码

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  // getRandomValues 单次上限是 65536 字节（规范硬限制，浏览器与 Node 一致），
  // 超过就得分块，否则长缓冲区会直接抛 QuotaExceededError
  const MAX = 65_536;
  for (let offset = 0; offset < length; offset += MAX) {
    crypto.getRandomValues(out.subarray(offset, Math.min(offset + MAX, length)));
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // 分块避免 apply/扩展运算符在长数组上爆栈
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new CryptoError('malformed', 'base64 decode failed');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 返回不带连字符的大写 base32；非法字符直接抛错，不做"猜你想输入什么" */
export function normalizeRecoveryCode(input: string): string {
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-7]+$/.test(cleaned)) {
    throw new CryptoError('malformed', 'recovery code contains non-base32 characters');
  }
  if (cleaned.length !== (RECOVERY_BYTES * 8) / 5) {
    throw new CryptoError('malformed', `recovery code should be 32 chars, got ${cleaned.length}`);
  }
  return cleaned;
}

// ---------------------------------------------------------------- 密钥派生

function subtle(): SubtleCrypto {
  return crypto.subtle;
}

/**
 * WebCrypto 的 `BufferSource` 要求底层是 `ArrayBuffer`，
 * 而 TS 5.7 起 `Uint8Array` 的默认泛型参数是 `ArrayBufferLike`（含 `SharedArrayBuffer`），
 * 直接把 `Uint8Array` 传进去会报类型错。
 *
 * 我们这里所有字节都来自 `new Uint8Array(n)` 或 `atob` 解出来的普通缓冲区，
 * 不可能是 `SharedArrayBuffer`，所以在这里一次收口，别在调用点撒断言。
 */
function view(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

/**
 * 密码 → KEK。PBKDF2-SHA256，迭代数随 wrap 一起落盘，
 * 这样将来调高迭代数不会把老用户的 vault 锁死。
 */
export async function deriveKek(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  if (salt.length !== SALT_BYTES) {
    throw new CryptoError('malformed', `salt should be ${SALT_BYTES} bytes`);
  }
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: view(salt), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 恢复码 → KEK。
 *
 * 恢复码本身就是 160 bit 随机熵，再过 PBKDF2 只会白白多花一次慢哈希，
 * 所以这里只做一次 SHA-256 把 20 字节摊成 32 字节的合法 AES 密钥长度。
 * 加标签做域隔离，避免"同一串字节在别处还能当别的密钥用"。
 */
export async function deriveRecoveryKek(code: string): Promise<CryptoKey> {
  const raw = base32Decode(normalizeRecoveryCode(code));
  if (raw.length !== RECOVERY_BYTES) {
    throw new CryptoError('malformed', `recovery code should decode to ${RECOVERY_BYTES} bytes`);
  }
  const material = new Uint8Array(raw.length + AAD_RECOVERY_LABEL.length);
  material.set(new TextEncoder().encode(AAD_RECOVERY_LABEL), 0);
  material.set(raw, AAD_RECOVERY_LABEL.length);
  const digest = await subtle().digest('SHA-256', material);
  return subtle().importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function generateDek(): Uint8Array {
  return randomBytes(DEK_BYTES);
}

/** 20 字节随机 → 32 字符 base32 → 8 组 4 字符，人眼抄写不累 */
export function generateRecoveryCode(): string {
  const raw = randomBytes(RECOVERY_BYTES);
  const encoded = base32Encode(raw);
  return (encoded.match(/.{1,4}/g) ?? []).join('-');
}

async function toAesKey(key: CryptoKey | Uint8Array): Promise<CryptoKey> {
  if (key instanceof CryptoKey) return key;
  if (key.length !== DEK_BYTES) {
    throw new CryptoError('malformed', `AES key should be ${DEK_BYTES} bytes, got ${key.length}`);
  }
  return subtle().importKey('raw', view(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ---------------------------------------------------------------- 密封 / 解封

async function seal(
  key: CryptoKey | Uint8Array,
  plaintext: Uint8Array,
  aad: string,
): Promise<SealedBlob> {
  const aes = await toAesKey(key);
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: view(iv), additionalData: new TextEncoder().encode(aad) },
    aes,
    view(plaintext),
  );
  return { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

async function open(
  key: CryptoKey | Uint8Array,
  blob: SealedBlob,
  aad: string,
): Promise<Uint8Array> {
  if (!blob || typeof blob !== 'object') throw new CryptoError('malformed', 'blob is not an object');
  if (blob.v !== 1) throw new CryptoError('unsupported-version', String(blob.v));
  const iv = base64ToBytes(blob.iv);
  if (iv.length !== IV_BYTES) throw new CryptoError('malformed', 'bad iv length');
  const ct = base64ToBytes(blob.ct);
  if (ct.length <= 16) throw new CryptoError('malformed', 'ciphertext shorter than GCM tag');
  const aes = await toAesKey(key);
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: view(iv), additionalData: new TextEncoder().encode(aad) },
      aes,
      view(ct),
    );
    return new Uint8Array(plain);
  } catch {
    // GCM 校验失败：密码错、密文被改、AAD 不匹配，三者在密码学上不可区分
    throw new CryptoError('wrong-key');
  }
}

/** 用 DEK 加密整个 vault（JSON） */
export async function encryptJson(key: CryptoKey | Uint8Array, data: unknown): Promise<SealedBlob> {
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  return seal(key, plaintext, AAD_VAULT);
}

export async function decryptJson<T>(
  key: CryptoKey | Uint8Array,
  blob: SealedBlob,
): Promise<T> {
  const plain = await open(key, blob, AAD_VAULT);
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new CryptoError('malformed', 'decrypted payload is not JSON');
  }
}

/**
 * 导出文件的内容加密。
 *
 * AAD 与 vault 密文不同，所以两者**互相搬不动**：把保险库里那团密文塞进
 * 导出文件，或者反过来把导出文件塞进存储，都只会得到 `wrong-key`，
 * 而不是"看起来解开了一堆别的东西"。
 */
export async function sealExport(key: CryptoKey | Uint8Array, data: unknown): Promise<SealedBlob> {
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  return seal(key, plaintext, AAD_EXPORT);
}

export async function openExport<T>(key: CryptoKey | Uint8Array, blob: SealedBlob): Promise<T> {
  const plain = await open(key, blob, AAD_EXPORT);
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new CryptoError('malformed', 'decrypted payload is not JSON');
  }
}

/** 用 KEK 包装 DEK */
export async function wrapDek(dek: Uint8Array, kek: CryptoKey): Promise<SealedBlob> {
  if (dek.length !== DEK_BYTES) throw new CryptoError('malformed', 'bad dek length');
  return seal(kek, dek, AAD_DEK);
}

/** 解出 DEK。密码错 / 恢复码错 / 密文被篡改都会抛 `wrong-key`。 */
export async function unwrapDek(blob: SealedBlob, kek: CryptoKey): Promise<Uint8Array> {
  const dek = await open(kek, blob, AAD_DEK);
  if (dek.length !== DEK_BYTES) throw new CryptoError('malformed', 'unwrapped dek has bad length');
  return dek;
}

// ---------------------------------------------------------------- 密码强度

/** 密码不合格的具体原因。文案在 `ui/i18n.ts`，这里只说"哪一条不满足"。 */
export type PasswordIssue =
  | { code: 'too-short'; min: number; actual: number }
  | { code: 'repeated' };

export interface PasswordCheck {
  ok: boolean;
  /** 具体理由，空数组表示通过 */
  issues: PasswordIssue[];
}

/**
 * 密码强度。只要求长度，不强制大小写数字符号：
 * 强制字符类会把用户推向 `Passw0rd!` 这种可预测结构，反而更差。
 */
export function checkPassword(password: string): PasswordCheck {
  const issues: PasswordIssue[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push({ code: 'too-short', min: MIN_PASSWORD_LENGTH, actual: password.length });
  }
  // 20 个连续字符以上的重复，多半是压着键盘凑长度
  if (/(.)\1{19,}/u.test(password)) {
    issues.push({ code: 'repeated' });
  }
  return { ok: issues.length === 0, issues };
}
