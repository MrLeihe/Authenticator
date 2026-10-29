import { base32Decode } from './base32';
import {
  CryptoError,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  base64ToBytes,
  bytesToBase64,
  checkPassword,
  deriveKek,
  openExport,
  randomBytes,
  sealExport,
} from './crypto';
import type { SealedBlob } from './crypto';
import type { Diagnostic } from './diagnostics';
import { isMigrationUri, parseMigrationUri } from './migration';
import type { MigrationBatch } from './migration';
import { OtpAuthError, buildOtpauth, findOtpauthUris, parseOtpauth } from './otpauth';
import type { OtpAuthParams } from './otpauth';
import type { Account, Algorithm } from './types';
import type { NewAccountInput } from './vault';

/**
 * 导出与导入。
 *
 * 三条设计约束：
 * 1. **导出文件与保险库没有关系**。文件用「导出密码」独立派生一把密钥，
 *    不碰 vault 的 DEK —— 否则换台电脑、重装扩展之后（DEK 已经不在了）
 *    这份备份就打不开了，而"备份打不开"正是备份最不该有的失败方式。
 * 2. **导入只做加法**。同一条账户已存在就跳过，同名但密钥不同就提示后新增。
 *    任何情况下都不覆盖已有条目：覆盖是唯一会让用户静默丢数据的操作。
 * 3. **明文导出是显式选择**，界面上必须把后果说清楚：拿到这个文件的人
 *    可以直接生成你的验证码。
 */

export const EXPORT_FORMAT = 'authenticator-export';
export const EXPORT_VERSION = 1;

export class ImportError extends Error {
  /** `message` 只放英文调试串；界面按 `reason` 说话，见 `ui/i18n.ts`。 */
  constructor(
    readonly reason: 'not-export' | 'unsupported-version' | 'malformed' | 'encrypted' | 'empty',
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface EncryptedExportFile {
  format: string;
  version: number;
  encrypted: true;
  /** 导出时间。只到日期级别也够用，用户拿它分辨"哪份是新的" */
  createdAt: string;
  kdf: { algo: string; iter: number; salt: string };
  payload: SealedBlob;
}

// ---------------------------------------------------------------- 导出

/** 导出只带走重建这条账户必需的字段：id / order / pinned 属于本机状态，不该跟着走 */
export function exportParams(accounts: readonly Account[]): OtpAuthParams[] {
  return accounts.map((account) => ({
    issuer: account.issuer,
    account: account.account,
    secret: account.secret,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
  }));
}

/** 明文导出：每行一条 otpauth 地址，别的验证器可以直接读 */
export function exportAccountsToText(accounts: readonly Account[]): string {
  return exportParams(accounts)
    .map((params) => buildOtpauth(params))
    .join('\n');
}

export async function createEncryptedExport(
  accounts: readonly Account[],
  password: string,
  now: Date = new Date(),
): Promise<string> {
  const check = checkPassword(password);
  // 密码不合格是调用方的责任（界面在按钮旁就拦住了），这里只兜底，不给文案
  if (!check.ok) throw new CryptoError('malformed', `weak export password: ${check.issues[0]?.code}`);

  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKek(password, salt);
  const payload = await sealExport(kek, { accounts: exportParams(accounts) });

  const file: EncryptedExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    encrypted: true,
    createdAt: now.toISOString(),
    kdf: { algo: 'PBKDF2-SHA256', iter: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    payload,
  };
  // 缩进过的 JSON：用户可能会用编辑器打开它确认"里面没有明文"
  return JSON.stringify(file, null, 2);
}

// ---------------------------------------------------------------- 解析导入内容

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ALGORITHMS: readonly Algorithm[] = ['SHA1', 'SHA256', 'SHA512'];

/** 校验一条来自外部文件的账户。诊断里**绝不回显密钥**。 */
function readParams(raw: unknown, index: number, issues: Diagnostic[]): OtpAuthParams | null {
  if (!isRecord(raw)) {
    issues.push({ code: 'entry-not-object', index });
    return null;
  }
  const secret = String(raw.secret ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
  let valid = false;
  try {
    valid = secret.length > 0 && base32Decode(secret).length > 0;
  } catch {
    valid = false;
  }
  if (!valid) {
    issues.push({ code: 'entry-bad-secret', index });
    return null;
  }

  const algorithm = ALGORITHMS.includes(raw.algorithm as Algorithm)
    ? (raw.algorithm as Algorithm)
    : 'SHA1';
  const digits: 6 | 8 = raw.digits === 8 ? 8 : 6;
  const rawPeriod = typeof raw.period === 'number' ? raw.period : 30;
  const period = Math.min(3600, Math.max(1, Math.round(rawPeriod)));

  return {
    issuer: typeof raw.issuer === 'string' ? raw.issuer.trim() : '',
    account: typeof raw.account === 'string' ? raw.account.trim() : '',
    secret,
    algorithm,
    digits,
    period,
  };
}

/** 迁移码里的参数是可选的；补齐成后面各环节统一的完整形态，缺失项按 otpauth 默认值 */
function fillDefaults(input: NewAccountInput): OtpAuthParams {
  return {
    issuer: input.issuer.trim(),
    account: input.account.trim(),
    secret: input.secret.replace(/[\s-]/g, '').toUpperCase(),
    algorithm: input.algorithm ?? 'SHA1',
    digits: input.digits ?? 6,
    period: input.period ?? 30,
  };
}

/** `{ accounts: [...] }` 与裸数组都收：别的工具导出的格式常常就是裸数组 */
function readAccountList(raw: unknown): { drafts: OtpAuthParams[]; issues: Diagnostic[] } {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.accounts) ? raw.accounts : null;
  if (!list) {
    throw new ImportError('not-export', 'json has no account list');
  }
  const issues: Diagnostic[] = [];
  const drafts: OtpAuthParams[] = [];
  for (const [index, item] of list.entries()) {
    const params = readParams(item, index, issues);
    if (params) drafts.push(params);
  }
  return { drafts, issues };
}

/** 只判断"看起来是不是我们的加密封装"，真正的校验在 parseExportFile */
function looksLikeEnvelope(text: string): boolean {
  return text.includes(`"${EXPORT_FORMAT}"`);
}

function parseExportFile(text: string): EncryptedExportFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('malformed', 'file is not valid json');
  }
  if (!isRecord(raw) || raw.format !== EXPORT_FORMAT) {
    throw new ImportError('not-export', 'not an export file');
  }
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > EXPORT_VERSION) {
    throw new ImportError(
      'unsupported-version',
      `export version ${version} is newer than supported`,
    );
  }
  if (raw.encrypted !== true) {
    throw new ImportError('malformed', 'export file has no encryption info');
  }
  if (!isRecord(raw.kdf) || !isRecord(raw.payload)) {
    throw new ImportError('malformed', 'export file structure is incomplete');
  }
  return raw as unknown as EncryptedExportFile;
}

export type ImportKind = 'encrypted-json' | 'json' | 'migration' | 'otpauth' | 'empty';

export function detectImportKind(text: string): ImportKind {
  const trimmed = text.trim();
  if (!trimmed) return 'empty';
  if (isMigrationUri(trimmed)) return 'migration';
  // 裸数组也算 JSON：别的工具导出的就是 `[{issuer, account, secret}]`
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return looksLikeEnvelope(trimmed) ? 'encrypted-json' : 'json';
  }
  return findOtpauthUris(trimmed).length > 0 ? 'otpauth' : 'empty';
}

export interface ParsedImport {
  kind: Exclude<ImportKind, 'encrypted-json' | 'empty'>;
  drafts: OtpAuthParams[];
  /** 逐条失败原因，空数组表示全部读出来了 */
  issues: Diagnostic[];
  /** 迁移码分批导出时为非 null */
  batch: MigrationBatch | null;
}

/**
 * 解析一份导入内容。
 *
 * 加密文件且没给密码时抛 `ImportError('encrypted')`，界面据此切到"输密码"那一屏 ——
 * 让调用方用异常来分支，比返回一个 `{needsPassword:true}` 再到处判空要少出错。
 */
export async function parseImport(text: string, password?: string): Promise<ParsedImport> {
  const trimmed = text.trim();
  const kind = detectImportKind(trimmed);
  if (kind === 'empty') {
    throw new ImportError('empty', 'no importable content');
  }

  if (kind === 'migration') {
    const result = parseMigrationUri(trimmed);
    // detect 已经确认过前缀，这里 null 只可能是竞态，按格式错处理
    if (!result) throw new ImportError('malformed', 'bad migration uri');
    return {
      kind: 'migration',
      drafts: result.accounts.map(fillDefaults),
      issues: result.issues,
      batch: result.batch,
    };
  }

  if (kind === 'encrypted-json') {
    const file = parseExportFile(trimmed);
    if (!password) {
      throw new ImportError('encrypted', 'backup is encrypted');
    }
    const salt = base64ToBytes(file.kdf.salt);
    if (salt.length !== SALT_BYTES) {
      throw new ImportError('malformed', 'bad salt length');
    }
    const iter = file.kdf.iter;
    // 迭代数来自文件，所以要设上限：否则一个被改过的文件可以让解密卡到天荒地老
    if (!Number.isInteger(iter) || iter < 10_000 || iter > 10_000_000) {
      throw new ImportError('malformed', 'unreasonable kdf iterations');
    }
    const kek = await deriveKek(password, salt, iter);
    const data = await openExport<unknown>(kek, file.payload);
    const { drafts, issues } = readAccountList(data);
    return { kind: 'json', drafts, issues, batch: null };
  }

  if (kind === 'json') {
    const { drafts, issues } = readAccountList(JSON.parse(trimmed));
    return { kind: 'json', drafts, issues, batch: null };
  }

  // 明文文本：可能是我们的导出文件，也可能是从别处复制来的一堆地址
  const drafts: OtpAuthParams[] = [];
  const issues: Diagnostic[] = [];
  for (const uri of findOtpauthUris(trimmed)) {
    try {
      drafts.push(parseOtpauth(uri));
    } catch (cause) {
      // 地址里有密钥，所以只记"哪一项不对"，绝不把 URI 贴回来
      issues.push(uriProblem(cause));
    }
  }
  if (drafts.length === 0 && issues.length === 0) {
    throw new ImportError('empty', 'no otpauth uri found');
  }
  return { kind: 'otpauth', drafts, issues, batch: null };
}

/**
 * `OtpAuthError` → 诊断。
 *
 * 这里不放 URI 原文、也不放 message：一条地址里就有密钥，
 * 任何"顺手把出错的那行贴回去"的写法都是在把密钥往界面上搬。
 */
function uriProblem(cause: unknown): Diagnostic {
  if (!(cause instanceof OtpAuthError)) {
    return { code: 'uri-not-otpauth' };
  }
  switch (cause.problem) {
    case 'unsupported-type':
      return { code: 'uri-unsupported-type', value: cause.value ?? '' };
    case 'missing-secret':
      return { code: 'uri-missing-secret' };
    case 'bad-secret':
      return { code: 'uri-bad-secret' };
    case 'bad-algorithm':
      return { code: 'uri-bad-algorithm', value: cause.value ?? '' };
    case 'bad-digits':
      return { code: 'uri-bad-digits', value: cause.value ?? '' };
    case 'bad-period':
      return { code: 'uri-bad-period', value: cause.value };
    case 'not-otpauth':
    default:
      return { code: 'uri-not-otpauth' };
  }
}

// ---------------------------------------------------------------- 合并计划

function labelKey(issuer: string, account: string): string {
  return `${issuer.trim().toLowerCase()}\u0000${account.trim().toLowerCase()}`;
}

/** 新增但要提醒一句的情形 */
export type ImportNote = 'label-collision';

/** 不新增的原因 */
export type SkipReason = 'duplicate-in-file' | 'already-exists';

export interface ImportPlan {
  /** 会新增的条目；`note` 非空时界面要标黄提示 */
  add: Array<{ draft: OtpAuthParams; note: ImportNote | null }>;
  /** 已存在、不会重复添加的条目 */
  skip: Array<{ draft: OtpAuthParams; reason: SkipReason }>;
  issues: Diagnostic[];
  batch: MigrationBatch | null;
}

/**
 * 把"解析出来的账户"和"库里已有的账户"对一遍，算出这次导入到底会做什么。
 *
 * 判定顺序是有讲究的：**先按密钥**（同一把密钥就是同一条凭据，
 * 名字改过也一样），再按名字。同名但密钥不同意味着用户重新绑定了这个站点，
 * 两条都可能有效，所以只能提示 + 新增，不能替用户选。
 */
export function planImport(existing: readonly Account[], parsed: ParsedImport): ImportPlan {
  const secrets = new Set(existing.map((account) => account.secret));
  const labels = new Set(existing.map((account) => labelKey(account.issuer, account.account)));

  const add: ImportPlan['add'] = [];
  const skip: ImportPlan['skip'] = [];
  const seenInFile = new Set<string>();

  for (const draft of parsed.drafts) {
    if (seenInFile.has(draft.secret)) {
      skip.push({ draft, reason: 'duplicate-in-file' });
      continue;
    }
    seenInFile.add(draft.secret);

    if (secrets.has(draft.secret)) {
      skip.push({ draft, reason: 'already-exists' });
      continue;
    }

    const collides = labels.has(labelKey(draft.issuer, draft.account));
    add.push({
      draft,
      note: collides ? 'label-collision' : null,
    });
  }

  return { add, skip, issues: parsed.issues, batch: parsed.batch };
}
