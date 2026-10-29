import { base32Encode } from './base32';
import type { Diagnostic } from './diagnostics';
import { splitOtpauthLabel } from './otpauth';
import type { Algorithm } from './types';
import type { NewAccountInput } from './vault';

/**
 * Google Authenticator 的迁移码（`otpauth-migration://offline?data=...`）。
 *
 * 那串 `data` 是 URL 编码的 base64，里面是 protobuf 的 `MigrationPayload`。
 * 这里手写一个只认这几类字段的最小 protobuf 读取器，而不是引入 protobufjs：
 * 需要的总共就 12 个字段，全部是 varint 与 length-delimited 两种线格式，
 * 为它拖进一个几十 KB 的运行时依赖、还要过一遍商店审核，不划算。
 *
 * 三条边界必须说清楚（界面据此提示，不假装成功）：
 * - **HOTP 会跳过**：计数器式的一次性密码没有时间概念，按 TOTP 算出来的码永远错。
 * - **MD5 会跳过**：本扩展不支持，也不打算支持。
 * - **分批导出**：账户多时 GA 会拆成多张码，一张只能拿到一部分，
 *   所以 `batch` 一定要如实返回，否则用户会以为剩下的账户丢了。
 */

export class MigrationError extends Error {
  /**
   * `message` 只放英文调试串，给控制台和测试看。界面按 `reason` 说话，
   * 这样同一份数据在中文界面和英文界面里都能说对。
   */
  constructor(
    readonly reason: 'not-migration' | 'malformed' | 'unsupported-version',
    message: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationBatch {
  /** 从 0 开始 */
  index: number;
  size: number;
}

export interface MigrationResult {
  accounts: NewAccountInput[];
  /** 大于一张时非 null */
  batch: MigrationBatch | null;
  /** 逐条被跳过的原因，空数组表示全部收下 */
  issues: Diagnostic[];
}

const PREFIX = /^otpauth-migration:\/\//i;

export function isMigrationUri(text: string): boolean {
  return PREFIX.test(text.trim());
}

// ---------------------------------------------------------------- 最小 protobuf 读取器

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH = 2;
const WIRE_32BIT = 5;

interface RawField {
  number: number;
  /** varint 的数值；length-delimited 时为 undefined */
  value: number;
  /** length-delimited 的原始字节；其它线格式时为 undefined */
  bytes: Uint8Array | undefined;
}

function readVarint(bytes: Uint8Array, start: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < bytes.length) {
    const byte = bytes[offset++] as number;
    // 超过 2^53 的 varint 只有 `counter` 用的上，而 HOTP 本来就会被跳过，
    // 所以这里允许精度损失，但绝不能把 length / tag 读歪
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
    if (shift > 63) throw new MigrationError('malformed', 'varint too long');
  }
  throw new MigrationError('malformed', 'truncated payload');
}

function readFields(bytes: Uint8Array): RawField[] {
  const fields: RawField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const number = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (number === 0) throw new MigrationError('malformed', 'field number 0');

    if (wire === WIRE_VARINT) {
      const read = readVarint(bytes, offset);
      offset = read.offset;
      fields.push({ number, value: read.value, bytes: undefined });
    } else if (wire === WIRE_LENGTH) {
      const length = readVarint(bytes, offset);
      offset = length.offset;
      const end = offset + length.value;
      if (end > bytes.length) throw new MigrationError('malformed', 'field length out of range');
      fields.push({ number, value: 0, bytes: bytes.subarray(offset, end) });
      offset = end;
    } else if (wire === WIRE_64BIT || wire === WIRE_32BIT) {
      // 这两种线格式在迁移载荷里没有出现，但要能跳过，否则一个无关字段就把整包读歪
      offset += wire === WIRE_64BIT ? 8 : 4;
      if (offset > bytes.length) throw new MigrationError('malformed', 'truncated payload');
    } else {
      throw new MigrationError('malformed', `unknown wire type ${wire}`);
    }
  }
  return fields;
}

function text(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder().decode(bytes).trim() : '';
}

function number(fields: RawField[], target: number): number {
  return fields.find((field) => field.number === target)?.value ?? 0;
}

// ---------------------------------------------------------------- 载荷解码

/** MigrationPayload.Algorithm */
const ALGORITHMS: Record<number, Algorithm | 'MD5'> = {
  0: 'SHA1',
  1: 'SHA1',
  2: 'SHA256',
  3: 'SHA512',
  4: 'MD5',
};

/** MigrationPayload.OtpType */
const TOTP = 2;

function decodeParams(raw: Uint8Array, index: number, issues: Diagnostic[]): NewAccountInput | null {
  const fields = readFields(raw);

  const secretBytes = fields.find((field) => field.number === 1)?.bytes;
  if (!secretBytes || secretBytes.length === 0) {
    issues.push({ code: 'migration-no-secret', index });
    return null;
  }

  const name = text(fields.find((field) => field.number === 2)?.bytes);
  const issuerField = text(fields.find((field) => field.number === 3)?.bytes);
  const label = splitOtpauthLabel(name);

  // GA 有时把 issuer 放进 name 的前缀（`ACME:alice`），有时单独放在 issuer 字段。
  // 两处都有时以 issuer 字段为准，并从 name 里把重复的前缀剥掉。
  const issuer = issuerField || label.issuer;
  const account = !issuerField
    ? label.account
    : label.issuer === issuerField
      ? label.account
      : name.trim();

  const type = number(fields, 6);
  if (type === 1) {
    issues.push({ code: 'migration-hotp', index, label: issuer || account });
    return null;
  }
  if (type !== 0 && type !== TOTP) {
    issues.push({ code: 'migration-unknown-type', index, label: issuer || account, value: String(type) });
    return null;
  }

  const algorithm = ALGORITHMS[number(fields, 4)] ?? 'SHA1';
  if (algorithm === 'MD5') {
    issues.push({ code: 'migration-md5', index, label: issuer || account });
    return null;
  }

  // DigitCount：1 = 六位，2 = 八位，0 = 未指定（按六位）
  const digits: 6 | 8 = number(fields, 5) === 2 ? 8 : 6;

  return { issuer, account, secret: base32Encode(secretBytes), algorithm, digits, period: 30 };
}

function base64ToBytes(text: string): Uint8Array {
  // 迁移码里用的是标准 base64，但经过 URL 编码；这里同时容错 URL-safe 变体与缺 padding
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new MigrationError('malformed', 'data is not valid base64');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function readData(uri: string): string {
  const questionMark = uri.indexOf('?');
  if (questionMark < 0) throw new MigrationError('malformed', 'missing data parameter');
  for (const part of uri.slice(questionMark + 1).split('&')) {
    if (!part.startsWith('data=')) continue;
    const raw = part.slice('data='.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  throw new MigrationError('malformed', 'missing data parameter');
}

/** 解析一条迁移地址。不是迁移地址时返回 `null`，由调用方换个格式再试。 */
export function parseMigrationUri(input: string): MigrationResult | null {
  const uri = input.trim();
  if (!isMigrationUri(uri)) return null;

  const bytes = base64ToBytes(readData(uri));
  if (bytes.length === 0) throw new MigrationError('malformed', 'empty payload');

  const fields = readFields(bytes);
  const version = number(fields, 2);
  if (version > 1) {
    throw new MigrationError(
      'unsupported-version',
      `payload version ${version} is newer than supported`,
    );
  }

  const issues: Diagnostic[] = [];
  const accounts: NewAccountInput[] = [];
  let index = 0;
  for (const field of fields) {
    if (field.number !== 1 || !field.bytes) continue;
    const account = decodeParams(field.bytes, index, issues);
    index += 1;
    if (account) accounts.push(account);
  }

  if (accounts.length === 0 && issues.length === 0) {
    throw new MigrationError('malformed', 'no accounts in payload');
  }

  const size = number(fields, 3);
  const batch: MigrationBatch | null =
    size > 1 ? { index: number(fields, 4), size } : null;

  return { accounts, batch, issues };
}
