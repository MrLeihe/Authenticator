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
 * 因此 `normalizeVault` 从不抛错，而是把丢掉的东西记进 `notes` 里 ——
 * 记的是**原因码**而不是句子：要不要说、说成哪种语言，是界面的事。
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

/**
 * 修复时"丢了什么 / 补了什么"。与 `Diagnostic` 同一个思路：
 * 数据层只说哪一种，文案表在 `ui/i18n.ts`。
 */
export type RepairNote =
  | { code: 'not-object' }
  | { code: 'account-not-object'; index: number }
  | { code: 'account-bad-secret'; index: number; label: string }
  | { code: 'setting-bad-type'; key: string }
  | { code: 'migrated'; from: number }
  | { code: 'duplicate-id' };

export interface NormalizeResult {
  vault: Vault;
  /** 修复记录，空数组表示干干净净 */
  notes: RepairNote[];
}

/** 纯英文调试串，只给控制台和测试看，不进界面 */
export function debugRepair(note: RepairNote): string {
  return Object.entries(note)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
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

function normalizeAccount(raw: unknown, index: number, notes: RepairNote[]): Account | null {
  if (!isRecord(raw)) {
    notes.push({ code: 'account-not-object', index });
    return null;
  }
  const secret = asString(raw.secret).toUpperCase();
  if (!validSecret(secret)) {
    // label 只用来在界面上指认"是哪一条"，可能是空串（连 issuer 都没有）
    notes.push({ code: 'account-bad-secret', index, label: asString(raw.issuer) });
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
    ...(typeof raw.archivedAt === 'number' && Number.isFinite(raw.archivedAt)
      ? { archivedAt: raw.archivedAt }
      : {}),
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

/** 枚举型设置的合法取值表。字符串设置尤其需要，见 normalizeSettings 的注释。 */
const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  autoLockMinutes: ['0', '5', '30', '120'],
  clipboardClearSeconds: ['0', '15', '30', '60'],
  theme: ['system', 'light', 'dark'],
  language: ['system', 'zh', 'en'],
  sortBy: ['manual', 'issuer', 'name'],
  style: ['classic', 'modern'],
  // 曾有过 'masked'（打码视图），已移除：旧数据里的这个值会落回默认的 normal
  view: ['normal', 'compact'],
};

function isAllowedValue(key: keyof Settings, value: unknown): boolean {
  const allowed = ENUMS[key];
  return !allowed || allowed.includes(String(value));
}

function normalizeSettings(raw: unknown, notes: RepairNote[]): Settings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  const merged: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    const value = raw[key];
    if (value === undefined) continue;
    // 类型对不上就保留默认值，不让一个坏字段把整个设置区带崩。
    // 枚举字段只比 typeof 不够：'fr' 也是 string，但界面认不出它。
    if (typeof value === typeof DEFAULT_SETTINGS[key] && isAllowedValue(key, value)) {
      (merged[key] as unknown) = value;
    } else {
      notes.push({ code: 'setting-bad-type', key });
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
  const notes: RepairNote[] = [];
  if (!isRecord(raw)) {
    return { vault: emptyVault(), notes: [{ code: 'not-object' }] };
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
    notes.push({ code: 'migrated', from: version });
  }

  const accountsRaw = Array.isArray(raw.accounts) ? raw.accounts : [];
  const accounts: Account[] = [];
  const seenIds = new Set<string>();
  for (const [index, item] of accountsRaw.entries()) {
    const account = normalizeAccount(item, index, notes);
    if (!account) continue;
    // id 撞车会让 React key 与缓存一起错乱，这里直接换一个新 id
    if (seenIds.has(account.id)) {
      account.id = newId();
      notes.push({ code: 'duplicate-id' });
    }
    seenIds.add(account.id);
    accounts.push(account);
  }

  // 「最近删除」：老数据没有这个字段，补空数组。trash 里的账户同样要归一化
  const trashRaw = Array.isArray(raw.trash) ? raw.trash : [];
  const trash: Account[] = [];
  for (const [index, item] of trashRaw.entries()) {
    const account = normalizeAccount(item, index, notes);
    if (!account) continue;
    // trash 与 accounts 之间也要防 id 撞车
    if (seenIds.has(account.id)) {
      account.id = newId();
      notes.push({ code: 'duplicate-id' });
    }
    seenIds.add(account.id);
    trash.push(account);
  }

  const groupsRaw = Array.isArray(raw.groups) ? raw.groups : [];
  const groups = groupsRaw
    .map((item, index) => normalizeGroup(item, index))
    .filter((group): group is Group => group !== null);

  // groupId 指向不存在的分组时清空，避免"幽灵分组"。accounts 和 trash 都要清
  const groupIds = new Set(groups.map((g) => g.id));
  for (const account of accounts) {
    if (account.groupId && !groupIds.has(account.groupId)) account.groupId = null;
  }
  for (const account of trash) {
    if (account.groupId && !groupIds.has(account.groupId)) account.groupId = null;
  }

  return {
    vault: { version: VAULT_VERSION, accounts, trash, groups, settings: normalizeSettings(raw.settings, notes) },
    notes,
  };
}

export function emptyVault(): Vault {
  return { version: VAULT_VERSION, accounts: [], trash: [], groups: [], settings: { ...DEFAULT_SETTINGS } };
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
  if (!validSecret(secret)) throw new VaultError('malformed', 'secret is not valid base32');
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
      if (!validSecret(secret)) throw new VaultError('malformed', 'secret is not valid base32');
      merged.secret = secret;
    }
    return merged;
  });
  if (!found) throw new VaultError('malformed', 'account to update not found');
  return { ...vault, accounts };
}

/**
 * 软删除：把账户从 `accounts` 移进 `trash`，记下删除时间。
 *
 * 不真删。删除后 30 天内可以在「最近删除」里恢复，过期后被惰性清理。
 * 这是对「误删」这个场景的真正兜底 —— 快照按天留，误删按秒发生，
 * 只有可逆的删除才追得上用户的后悔速度。
 */
export function removeAccount(vault: Vault, id: string): Vault {
  const target = vault.accounts.find((account) => account.id === id);
  if (!target) return vault;
  const archived: Account = { ...target, archivedAt: Date.now() };
  return {
    ...vault,
    accounts: vault.accounts.filter((account) => account.id !== id),
    trash: [...vault.trash, archived],
  };
}

/**
 * 从「最近删除」恢复：移回 `accounts`，去掉 `archivedAt`。
 *
 * 判重沿用导入那一套（`issuer + account`）：同名账户还在列表里时，
 * 恢复会造成重名。这里只做**名**一级的提醒，不拦 —— 密钥相同说明
 * 是同一凭据（应当拦），但软删除与活跃列表不会同时存在同一密钥，
 * 所以这里不按密钥去重，交给界面用同名提示兜底。
 */
export function restoreTrashed(vault: Vault, id: string): Vault {
  const target = vault.trash.find((account) => account.id === id);
  if (!target) throw new VaultError('malformed', 'trashed account not found');
  const { archivedAt: _archivedAt, ...account } = target;
  // 不能原样沿用旧 order：删除后若又新增过账户，`nextOrder` 可能已经复用了
  // 这个 order，恢复回来会造成两个账户共用同一排序键，位置取决于 sort 的
  // 稳定性。恢复时重新排到末尾（pinned 依旧优先于 order，不受影响）。
  return {
    ...vault,
    accounts: [...vault.accounts, { ...account, order: nextOrder(vault.accounts) }],
    trash: vault.trash.filter((item) => item.id !== id),
  };
}

/** 彻底删除：从「最近删除」里移除，这一步才真正消失。 */
export function purgeTrashed(vault: Vault, id: string): Vault {
  return { ...vault, trash: vault.trash.filter((account) => account.id !== id) };
}

/** 「最近删除」保留天数。和 iOS 相册对齐，用户有熟悉的预期。 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 惰性清理：把超过保留期的账户从「最近删除」里真正移除。
 *
 * MV3 的 service worker 会被休眠，没法保证定时器准点触发，所以清理挂在
 * 「打开扩展」这一下上 —— 每次冷启动检查一次，过期就删，不依赖后台。
 * 返回是否真的删掉过东西，让调用方决定要不要顺手再落一次盘。
 */
export function expireTrash(vault: Vault, now: number = Date.now()): Vault {
  const trash = vault.trash.filter(
    (account) => !account.archivedAt || now - account.archivedAt < TRASH_RETENTION_MS,
  );
  if (trash.length === vault.trash.length) return vault;
  return { ...vault, trash };
}

/** 新账户排在最后：取最大 order 再加一个间隔 */
export function nextOrder(accounts: readonly Account[]): number {
  return accounts.reduce((max, account) => Math.max(max, account.order), 0) + ORDER_STEP;
}

/**
 * 置顶 / 取消置顶。
 *
 * 「置顶」的含义是"到最上面"，所以两边都放到各自分组的最前面：
 * 置顶的进置顶区顶部，取消置顶的落到非置顶区顶部（也就是所有置顶项之后）。
 * order 只是个排序键，允许为负数，这样这条路径永远不用重排。
 */
export function setPinned(vault: Vault, id: string, pinned: boolean): Vault {
  const target = vault.accounts.find((account) => account.id === id);
  if (!target) throw new VaultError('malformed', 'account not found');
  if (target.pinned === pinned) return vault;

  const group = vault.accounts.filter((account) => account.id !== id && account.pinned === pinned);
  const min = group.reduce((acc, account) => Math.min(acc, account.order), Infinity);
  const order = group.length === 0 ? target.order : min - ORDER_STEP;

  return updateAccount(vault, id, { pinned, order });
}

/** 排序键：置顶优先，其次 order。界面与这里必须用同一套规则。 */
function compareOrder(a: Account, b: Account): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.order - b.order;
}

/**
 * 拖拽排序：把 `id` 插到 `beforeId` 之前，`beforeId` 为 null 表示末尾。
 *
 * 拖到另一个分组（置顶 / 非置顶）时，`pinned` 跟着落点走 ——
 * 否则界面会把这一行弹回原处，用户只会觉得"拖不动"。
 * 组内相邻差不足 2 时重排**这一组**（不是整表）：组外的 order 与它无关。
 */
export function reorderAccount(vault: Vault, id: string, beforeId: string | null): Vault {
  const moved = vault.accounts.find((account) => account.id === id);
  if (!moved) throw new VaultError('malformed', 'account to move not found');
  if (beforeId === id) return vault;

  const rest = vault.accounts.filter((account) => account.id !== id).sort(compareOrder);
  const index = beforeId === null ? rest.length : rest.findIndex((a) => a.id === beforeId);
  if (beforeId !== null && index < 0) throw new VaultError('malformed', 'target account for reorder not found');

  // 落点前后是谁，决定了这一行该进哪个分组
  const prev = rest[index - 1];
  const next = rest[index];
  const pinned = prev ? prev.pinned : next ? next.pinned : moved.pinned;

  const before = rest.slice(0, index).filter((a) => a.pinned === pinned).pop();
  const after = rest.slice(index).find((a) => a.pinned === pinned);

  let order: number;
  let crowded = false;
  if (!before) {
    order = after ? after.order - ORDER_STEP : moved.order;
  } else if (!after) {
    order = before.order + ORDER_STEP;
  } else if (after.order - before.order >= 2) {
    order = before.order + Math.floor((after.order - before.order) / 2);
  } else {
    order = 0;
    crowded = true;
  }

  // 直接插到目标位置上 —— `rest` 本来就是视觉顺序，插进去就还是视觉顺序。
  // 不能靠"给一个临时 order 再排序"：挤不出空隙时那个值根本没有合适的位置可放。
  const merged = [...rest];
  merged.splice(index, 0, { ...moved, pinned, order });
  if (!crowded) return { ...vault, accounts: merged };

  // 挤不出空隙：只把**这一组**按 1024 重排，组外的 order 与它无关
  let counter = 0;
  return {
    ...vault,
    accounts: merged.map((account) =>
      account.pinned === pinned ? { ...account, order: (counter += 1) * ORDER_STEP } : account,
    ),
  };
}
