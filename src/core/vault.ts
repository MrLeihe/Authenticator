import type { Account, Group, Settings, Vault } from './types';
import { DEFAULT_SETTINGS } from './types';
import type { Algorithm } from './types';
import { base32Decode } from './base32';

/**
 * vault 的读写模型：纯函数，不认识 chrome 也不认识 React。
 *
 * 这里的原则是**宽容读取、严格写入**：
 * - 读：老版本或个别字段坏掉时尽量把能用的账户捞回来，不整包拒绝
 *   （整包拒绝等于用户数据全丢，那是最坏的失败方式）。
 * - 写：结构必须完整，避免把半成品写回存储。
 *
 * 因此 `normalizeVault` 从不抛错，而是把丢掉的东西记进 `issues` 里，
 * 由界面决定要不要告诉用户。
 */

export const VAULT_VERSION = 1;

export class VaultError extends Error {
  constructor(
    readonly reason: 'unsupported-version' | 'malformed',
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'VaultError';
  }
}

const ALGORITHMS: readonly Algorithm[] = ['SHA1', 'SHA256', 'SHA512'];

export interface NormalizeResult {
  vault: Vault;
  /** 人类可读的问题清单，空数组表示干干净净 */
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 密钥必须是合法 base32，否则这个账户永远算不出码，留着只会误导 */
function validSecret(secret: string): boolean {
  if (!secret) return false;
  try {
    return base32Decode(secret).length > 0;
  } catch {
    return false;
  }
}

function normalizeAccount(raw: unknown, index: number, issues: string[]): Account | null {
  if (!isRecord(raw)) {
    issues.push(`第 ${index + 1} 个账户不是对象，已跳过`);
    return null;
  }
  const secret = asString(raw.secret).toUpperCase();
  if (!validSecret(secret)) {
    issues.push(`${asString(raw.issuer) || `第 ${index + 1} 个账户`} 的密钥无法解析，已跳过`);
    return null;
  }
  const algorithm = ALGORITHMS.includes(raw.algorithm as Algorithm)
    ? (raw.algorithm as Algorithm)
    : 'SHA1';
  const digits = raw.digits === 8 ? 8 : 6;
  const period = Math.min(3600, Math.max(1, Math.round(asNumber(raw.period, 30))));

  return {
    id: asString(raw.id) || newId(),
    issuer: asString(raw.issuer),
    account: asString(raw.account),
    secret,
    algorithm,
    digits,
    period,
    order: asNumber(raw.order, (index + 1) * ORDER_STEP),
    pinned: raw.pinned === true,
    groupId: typeof raw.groupId === 'string' ? raw.groupId : null,
    createdAt: asNumber(raw.createdAt, Date.now()),
  };
}

function normalizeGroup(raw: unknown, index: number): Group | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name).trim();
  if (!name) return null;
  return {
    id: asString(raw.id) || newId(),
    name,
    order: asNumber(raw.order, (index + 1) * ORDER_STEP),
  };
}

function normalizeSettings(raw: unknown, issues: string[]): Settings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  const merged: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    const value = raw[key];
    if (value === undefined) continue;
    // 类型对不上就保留默认值，不让一个坏字段把整个设置区带崩
    if (typeof value === typeof DEFAULT_SETTINGS[key]) {
      (merged[key] as unknown) = value;
    } else {
      issues.push(`设置项 ${key} 类型不对，已用默认值`);
    }
  }
  return merged;
}

/**
 * 把任意来源的数据收敛成当前版本的 Vault。
 *
 * 将来的 schemaVersion 迁移也挂在这里：先看 `version`，逐级往上搬，
 * 每一步只动必要字段，最后统一走一遍 normalize。
 */
export function normalizeVault(raw: unknown): NormalizeResult {
  const issues: string[] = [];
  if (!isRecord(raw)) {
    return { vault: emptyVault(), issues: ['数据不是对象，已按空保险库处理'] };
  }

  // 没有 version 字段按 v0 处理，不能默认成当前版本 ——
  // 那样迁移分支永远进不去，老数据会被当成"已经是新版"
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > VAULT_VERSION) {
    throw new VaultError(
      'unsupported-version',
      `保险库版本 ${version} 高于本扩展支持的 ${VAULT_VERSION}，请升级扩展后再打开`,
    );
  }
  // v0（早期内部格式）没有 version 字段，字段名与 v1 一致，直接按 v1 收敛
  if (version < VAULT_VERSION) {
    issues.push(`已从旧版本 v${version} 迁移到 v${VAULT_VERSION}`);
  }

  const accountsRaw = Array.isArray(raw.accounts) ? raw.accounts : [];
  const accounts: Account[] = [];
  const seenIds = new Set<string>();
  for (const [index, item] of accountsRaw.entries()) {
    const account = normalizeAccount(item, index, issues);
    if (!account) continue;
    // id 撞车会让 React key 与缓存一起错乱，这里直接换一个新 id
    if (seenIds.has(account.id)) {
      account.id = newId();
      issues.push('发现重复的账户 id，已重新分配');
    }
    seenIds.add(account.id);
    accounts.push(account);
  }

  const groupsRaw = Array.isArray(raw.groups) ? raw.groups : [];
  const groups = groupsRaw
    .map((item, index) => normalizeGroup(item, index))
    .filter((group): group is Group => group !== null);

  // groupId 指向不存在的分组时清空，避免"幽灵分组"
  const groupIds = new Set(groups.map((g) => g.id));
  for (const account of accounts) {
    if (account.groupId && !groupIds.has(account.groupId)) account.groupId = null;
  }

  return {
    vault: { version: VAULT_VERSION, accounts, groups, settings: normalizeSettings(raw.settings, issues) },
    issues,
  };
}

export function emptyVault(): Vault {
  return { version: VAULT_VERSION, accounts: [], groups: [], settings: { ...DEFAULT_SETTINGS } };
}

// ---------------------------------------------------------------- 账户增删改（纯函数）

/** 稀疏排序间隔：拖动一次只写一行，见 SPEC §3.4 */
export const ORDER_STEP = 1024;

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // 极老的运行时兜底：时间戳 + 随机，仅用于去重，不承担密码学用途
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface NewAccountInput {
  issuer: string;
  account: string;
  secret: string;
  algorithm?: Algorithm;
  digits?: 6 | 8;
  period?: number;
  groupId?: string | null;
}

export function addAccount(vault: Vault, input: NewAccountInput): Vault {
  const secret = input.secret.replace(/[\s-]/g, '').toUpperCase();
  if (!validSecret(secret)) throw new VaultError('malformed', '密钥不是合法 base32');
  const account: Account = {
    id: newId(),
    issuer: input.issuer.trim(),
    account: input.account.trim(),
    secret,
    algorithm: input.algorithm ?? 'SHA1',
    digits: input.digits ?? 6,
    period: input.period ?? 30,
    order: nextOrder(vault.accounts),
    pinned: false,
    groupId: input.groupId ?? null,
    createdAt: Date.now(),
  };
  return { ...vault, accounts: [...vault.accounts, account] };
}

export function updateAccount(
  vault: Vault,
  id: string,
  patch: Partial<Omit<Account, 'id' | 'createdAt'>>,
): Vault {
  let found = false;
  const accounts = vault.accounts.map((account) => {
    if (account.id !== id) return account;
    found = true;
    const merged: Account = { ...account, ...patch };
    if (patch.secret !== undefined) {
      const secret = patch.secret.replace(/[\s-]/g, '').toUpperCase();
      if (!validSecret(secret)) throw new VaultError('malformed', '密钥不是合法 base32');
      merged.secret = secret;
    }
    return merged;
  });
  if (!found) throw new VaultError('malformed', '找不到要修改的账户');
  return { ...vault, accounts };
}

export function removeAccount(vault: Vault, id: string): Vault {
  return { ...vault, accounts: vault.accounts.filter((account) => account.id !== id) };
}

/** 新账户排在最后：取最大 order 再加一个间隔 */
export function nextOrder(accounts: readonly Account[]): number {
  return accounts.reduce((max, account) => Math.max(max, account.order), 0) + ORDER_STEP;
}

/** 把账户放到 target 之前（或末尾）。相邻差不足 2 时整表重排。 */
export function moveAccount(vault: Vault, id: string, targetIndex: number): Vault {
  const sorted = [...vault.accounts].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((account) => account.id === id);
  if (from < 0) throw new VaultError('malformed', '找不到要移动的账户');
  const [moved] = sorted.splice(from, 1);
  if (!moved) throw new VaultError('malformed', '找不到要移动的账户');
  const index = Math.max(0, Math.min(targetIndex, sorted.length));
  sorted.splice(index, 0, moved);

  const before = sorted[index - 1]?.order;
  const after = sorted[index + 1]?.order;
  if (before !== undefined && after !== undefined) {
    const gap = after - before;
    if (gap >= 2) {
      moved.order = before + Math.floor(gap / 2);
      return { ...vault, accounts: sorted };
    }
  }
  // 挤不出空隙就整表重排：1024 间隔下要 1024 次相邻插入才会遇到一次
  const renumbered = sorted.map((account, i) => ({ ...account, order: (i + 1) * ORDER_STEP }));
  return { ...vault, accounts: renumbered };
}
