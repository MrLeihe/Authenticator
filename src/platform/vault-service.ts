import {
  CryptoError,
  DEK_BYTES,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  base64ToBytes,
  bytesToBase64,
  checkPassword,
  decryptJson,
  deriveKek,
  deriveRecoveryKek,
  encryptJson,
  generateDek,
  generateRecoveryCode,
  normalizeRecoveryCode,
  randomBytes,
  unwrapDek,
  wrapDek,
} from '@/core/crypto';
import type { DekWrap, SealedBlob } from '@/core/crypto';
import type { Account, Vault } from '@/core/types';
import { VAULT_VERSION, emptyVault, normalizeVault } from '@/core/vault';
import { KEYS, backupKey, local, session } from './storage';

/**
 * 保险库服务：把「加密原语」和「存储」缝在一起，是 P3 的唯一编排点。
 *
 * 三条不能破的规矩：
 * 1. DEK 明文只在两处：本模块的内存变量、以及 `chrome.storage.session`。
 *    任何时刻都不会碰 `chrome.storage.local`。
 * 2. 切换加密方式只换 `dekWrap`，vault 密文原样不动 —— 也就没有
 *    "迁移到加密格式"这一步，不存在迁移失败把数据搞丢的窗口。
 * 3. 开加密后立刻清掉会话，强制用户马上用新密码解锁一次：
 *    否则密码记错要等到下次重启才发现，那时已经晚了。
 */

export interface VaultMeta {
  createdAt: number;
  lastBackupDate: string | null;
  schemaVersion: number;
}

export type VaultStatus =
  | { kind: 'empty' }
  /** 有密码保护且当前会话没有可用 DEK */
  | { kind: 'locked'; canRecover: boolean }
  /** `canRecover` 只在开了密码保护时为真：没开密码时恢复码包装是被删掉的 */
  | { kind: 'unlocked'; vault: Vault; canRecover: boolean };

export type LockReason = 'manual' | 'timeout' | 'password-change' | 'reload';

/** 解锁后的 DEK 与解密结果只活在内存里 */
let cached: { dek: Uint8Array } | null = null;

export function isUnlocked(): boolean {
  return cached !== null;
}

// ---------------------------------------------------------------- 底层读写

async function readStatusRaw(): Promise<{ wrap: DekWrap | null; recovery: DekWrap | null }> {
  const wrap = await local.get<DekWrap>(KEYS.dekWrap);
  const recovery = await local.get<DekWrap>(KEYS.dekWrapRecovery);
  return { wrap: wrap ?? null, recovery: recovery ?? null };
}

async function readSessionDek(): Promise<Uint8Array | null> {
  const encoded = await session.get<string>(KEYS.dek);
  if (!encoded) return null;
  try {
    const dek = base64ToBytes(encoded);
    return dek.length === DEK_BYTES ? dek : null;
  } catch {
    return null;
  }
}

async function rememberDek(dek: Uint8Array): Promise<void> {
  cached = { dek };
  await session.set(KEYS.dek, bytesToBase64(dek));
  await session.set(KEYS.unlockedAt, Date.now());
}

async function forgetDek(): Promise<void> {
  cached = null;
  await session.remove(KEYS.dek);
  await session.remove(KEYS.unlockedAt);
}

/** 用户有操作时刷新解锁时间点，节流由调用方控制 */
export async function touchUnlocked(): Promise<void> {
  if (!cached) return;
  await session.set(KEYS.unlockedAt, Date.now());
}

async function decryptVault(dek: Uint8Array): Promise<Vault> {
  const blob = await local.get<SealedBlob>(KEYS.vault);
  if (!blob) throw new CryptoError('malformed', 'vault blob missing');
  const raw = await decryptJson<unknown>(dek, blob);
  return normalizeVault(raw).vault;
}

// ---------------------------------------------------------------- 冷启动

/**
 * 判断当前该进哪一屏。
 *
 * `autoLockMinutes === 0` 表示关闭自动锁：会话 DEK 一直有效，
 * 直到浏览器关闭（storage.session 随之清空）。
 */
export async function resolveStatus(autoLockMinutes: number): Promise<VaultStatus> {
  const { wrap, recovery } = await readStatusRaw();
  if (!wrap) return { kind: 'empty' };

  if (wrap.kind === 'none') {
    // 没开密码保护：DEK 就写在 wrap 里，"解锁"是解密本身
    const dek = base64ToBytes(wrap.dek);
    if (dek.length !== DEK_BYTES) throw new CryptoError('malformed', 'plaintext dek has bad length');
    cached = { dek };
    return { kind: 'unlocked', vault: await decryptVault(dek), canRecover: false };
  }

  const sessionDek = await readSessionDek();
  const unlockedAt = await session.get<number>(KEYS.unlockedAt);
  if (sessionDek && !expired(autoLockMinutes, unlockedAt)) {
    try {
      const vault = await decryptVault(sessionDek);
      cached = { dek: sessionDek };
      return { kind: 'unlocked', vault, canRecover: recovery !== null };
    } catch {
      // 会话里的 DEK 解不开（存储被改过 / vault 换了）：当作未解锁，让用户重新输密码
      await forgetDek();
    }
  } else if (sessionDek) {
    await forgetDek();
  }

  return { kind: 'locked', canRecover: recovery !== null };
}

/**
 * 定时巡检：会话空了太久就上锁。返回"这一次真的锁上了"。
 *
 * 只查 `unlockedAt`，不重新解密保险库 —— 5 秒一次的巡检不该顺带做解密工作。
 */
export async function autoLockIfExpired(autoLockMinutes: number): Promise<boolean> {
  if (!cached) return false;
  // 没设密码的库不参与自动锁：DEK 本来就明文写在 wrap 里，
  // 锁屏拦不住任何能碰到这台电脑的人，只会把用户关在一个自己没有密码的锁屏外面。
  const { wrap } = await readStatusRaw();
  if (wrap?.kind === 'none') return false;
  const unlockedAt = await session.get<number>(KEYS.unlockedAt);
  if (!expired(autoLockMinutes, unlockedAt)) return false;
  await lock('timeout');
  return true;
}

export function expired(autoLockMinutes: number, unlockedAt: number | undefined): boolean {
  if (autoLockMinutes <= 0) return false;
  if (typeof unlockedAt !== 'number') return true;
  return Date.now() - unlockedAt > autoLockMinutes * 60_000;
}

// ---------------------------------------------------------------- 首次创建

export interface InitResult {
  vault: Vault;
  recoveryCode: string | null;
}

/** 第一次打开扩展：建 DEK、建空保险库。给了密码就顺手开启加密。 */
export async function initializeVault(password?: string): Promise<InitResult> {
  const dek = generateDek();
  const vault = emptyVault();
  await local.set(KEYS.vault, await encryptJson(dek, vault));

  const meta: VaultMeta = {
    createdAt: Date.now(),
    lastBackupDate: null,
    schemaVersion: VAULT_VERSION,
  };
  await local.set(KEYS.meta, meta);

  if (password) {
    const result = await applyPassword(dek, password);
    // 立刻清会话：提示界面马上用新密码解锁一次，验证密码真的记住了
    await forgetDek();
    return { vault, recoveryCode: result.recoveryCode };
  }

  await local.set(KEYS.dekWrap, { v: 1, kind: 'none', dek: bytesToBase64(dek) } satisfies DekWrap);
  // 必须走 rememberDek：只设 `cached` 会让 `unlockedAt` 缺失，
  // 于是 5 秒一次的自动锁巡检立刻判定"早就该锁了"，把刚建好的库锁在门外。
  await rememberDek(dek);
  return { vault, recoveryCode: null };
}

/** 用密码包一层，并额外生成恢复码包装。两条包装指向同一个 DEK。 */
async function applyPassword(
  dek: Uint8Array,
  password: string,
): Promise<{ recoveryCode: string }> {
  const check = checkPassword(password);
  if (!check.ok) throw new CryptoError('malformed', `weak password: ${check.issues[0]?.code}`);

  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKek(password, salt);
  const wrapped = await wrapDek(dek, kek);
  const passwordWrap: DekWrap = {
    v: 1,
    kind: 'password',
    salt: bytesToBase64(salt),
    iter: PBKDF2_ITERATIONS,
    iv: wrapped.iv,
    ct: wrapped.ct,
  };

  const recoveryCode = generateRecoveryCode();
  const recoveryWrapped = await wrapDek(dek, await deriveRecoveryKek(recoveryCode));
  const recoveryWrap: DekWrap = {
    v: 1,
    kind: 'recovery',
    iv: recoveryWrapped.iv,
    ct: recoveryWrapped.ct,
  };

  await local.set(KEYS.dekWrap, passwordWrap);
  await local.set(KEYS.dekWrapRecovery, recoveryWrap);
  return { recoveryCode };
}

// ---------------------------------------------------------------- 解锁

export async function unlockWithPassword(password: string): Promise<Vault> {
  const { wrap } = await readStatusRaw();
  if (!wrap) throw new CryptoError('malformed', 'no vault');
  if (wrap.kind === 'none') throw new CryptoError('malformed', 'password protection is off');
  if (wrap.kind === 'recovery') {
    throw new CryptoError('malformed', 'primary wrap is recovery, cannot unlock with password');
  }

  const kek = await deriveKek(password, base64ToBytes(wrap.salt), wrap.iter);
  const dek = await unwrapDek({ v: 1, iv: wrap.iv, ct: wrap.ct }, kek);
  const vault = await decryptVault(dek);
  await rememberDek(dek);
  return vault;
}

export async function unlockWithRecovery(code: string): Promise<Vault> {
  const { recovery } = await readStatusRaw();
  if (!recovery) throw new CryptoError('malformed', 'recovery wrap missing');
  if (recovery.kind !== 'recovery') {
    throw new CryptoError('malformed', 'recovery wrap has bad shape');
  }
  const kek = await deriveRecoveryKek(normalizeRecoveryCode(code));
  const dek = await unwrapDek({ v: 1, iv: recovery.iv, ct: recovery.ct }, kek);
  const vault = await decryptVault(dek);
  await rememberDek(dek);
  return vault;
}

// ---------------------------------------------------------------- 关闭 / 更换

/** 开启密码保护。调用后必须重新解锁一次（会话已清）。 */
export async function enablePassword(password: string): Promise<{ recoveryCode: string }> {
  const dek = requireDek();
  const result = await applyPassword(dek, password);
  await forgetDek();
  return result;
}

/**
 * 已解锁时换密码，同时换一张新恢复码（旧的在屏幕上出现过，用完即废）。
 *
 * 不走「关密码 + 开密码」两步：那中间会有一瞬间把 DEK 以 `kind:'none'`
 * 写进存储，等于短暂地把保护关掉了。这里只用当前密码验一次身份
 * （只解不落盘），然后直接重新包一层。
 */
export async function changePassword(
  current: string,
  next: string,
): Promise<{ recoveryCode: string }> {
  const { wrap } = await readStatusRaw();
  if (!wrap || wrap.kind !== 'password') {
    throw new CryptoError('malformed', 'password protection is off');
  }
  const kek = await deriveKek(current, base64ToBytes(wrap.salt), wrap.iter);
  // 密码不对在这一步就会抛 wrong-key，不会走到写盘
  const dek = await unwrapDek({ v: 1, iv: wrap.iv, ct: wrap.ct }, kek);
  const result = await applyPassword(dek, next);
  await forgetDek();
  return result;
}

/** 关闭密码保护：先验密码，再退化成 kind:'none'，并删掉恢复码包装。 */
export async function disablePassword(password: string): Promise<Vault> {
  const vault = await unlockWithPassword(password);
  const dek = requireDek();
  await local.set(KEYS.dekWrap, { v: 1, kind: 'none', dek: bytesToBase64(dek) } satisfies DekWrap);
  // 备用钥匙必须一起删掉，否则"关了加密"名不副实
  await local.remove(KEYS.dekWrapRecovery);
  return vault;
}

/**
 * 忘密码后：用恢复码解封，立刻换新密码 + 换新恢复码。
 * 旧恢复码随之作废 —— 它已经出现在屏幕上过，不该继续长期有效。
 */
export async function resetPasswordWithRecovery(
  code: string,
  newPassword: string,
): Promise<{ recoveryCode: string }> {
  await unlockWithRecovery(code);
  const dek = requireDek();
  const result = await applyPassword(dek, newPassword);
  await forgetDek();
  return result;
}

// ---------------------------------------------------------------- 保存与备份

function requireDek(): Uint8Array {
  if (!cached) throw new CryptoError('wrong-key', 'vault not unlocked');
  return cached.dek;
}

export async function saveVault(vault: Vault): Promise<void> {
  const dek = requireDek();
  await local.set(KEYS.vault, await encryptJson(dek, vault));
}

export async function lock(_reason: LockReason = 'manual'): Promise<void> {
  await forgetDek();
}

export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const MAX_BACKUPS = 7;

/** 快照的存储前缀。只在本模块出现，别处一律走 `backupKey()` */
const BACKUP_PREFIX = '2fa:backup:';

async function snapshotKeys(): Promise<string[]> {
  return (await local.keys()).filter((key) => key.startsWith(BACKUP_PREFIX)).sort();
}

/** 解一份快照。解不开就返回 null —— 换过 DEK 之后旧快照本来就是废的，不该让界面报错 */
async function readSnapshot(key: string): Promise<Vault | null> {
  const blob = await local.get<SealedBlob>(key);
  if (!blob) return null;
  try {
    const raw = await decryptJson<unknown>(requireDek(), blob);
    return normalizeVault(raw).vault;
  } catch {
    return null;
  }
}

/** 判重身份：同一个服务上的同一个账号，换个 id 也还是同一条。
 *  口径与 `backup.ts` 的 `labelKey` 保持一致：trim + 小写，避免「Google」和
 *  「google」被当成两条。分隔符用 `\0`，因为 issuer/account 里不会出现它。 */
const identityOf = (account: Account): string =>
  `${account.issuer.trim().toLowerCase()}\u0000${account.account.trim().toLowerCase()}`;

export interface BackupSnapshot {
  /** `YYYY-MM-DD` */
  date: string;
  /** 这份快照里有多少个账户 */
  accounts: number;
}

/**
 * 备份的概要：几份、最新是哪天。
 *
 * 只数 key、不解密 —— 设置页要的只是"备份在写"这个事实，为一句
 * 「已存 N 份」把 7 份快照全解开（每份都跑一遍 PBKDF2）纯属浪费。
 * 解不开的旧快照（换过 DEK）照常计数：它还在，只是这次读不动。
 */
export async function backupStatus(): Promise<{ count: number; latest: string | null }> {
  const keys = await snapshotKeys();
  if (keys.length === 0) return { count: 0, latest: null };
  const latest = keys[keys.length - 1]!.slice(BACKUP_PREFIX.length);
  return { count: keys.length, latest };
}

/**
 * 最近一份**非空**备份。
 *
 * 只在空态（列表里一条都没有）用到：横幅要说的是"本机还有你的账户躺着"，
 * 这时候只解最新一份就够 —— 为了一个数字把 7 份全解开，代价和收益不成比例。
 * 最新的那份恰好是空的（用户删空之后又改过一次设置），就往前退一份。
 */
export async function latestBackup(): Promise<BackupSnapshot | null> {
  if (!cached) return null;
  const keys = await snapshotKeys();
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index]!;
    const vault = await readSnapshot(key);
    if (vault && vault.accounts.length > 0) {
      return { date: key.slice(BACKUP_PREFIX.length), accounts: vault.accounts.length };
    }
  }
  return null;
}

/**
 * 把最近一份非空备份里缺的账户补回来。
 *
 * 只做加法，按 `issuer + account` 判重，已有的一条都不动 ——
 * 恢复发生在"我把东西弄丢了"之后，任何覆盖都会把一次事故变成两次。
 * 成功时返回新的 vault，调用方直接拿去替换内存里的状态；
 * 备份里没有可补的（null）就什么都不发生。
 *
 * 边界（刻意不做）：快照恢复**不覆盖「彻底删除」**。「彻底删除」是用户主动、
 * 明确的永久动作，快照恢复只救「误删」，不去复活一个被主动抹掉的东西。
 * 软删账户（还在「最近删除」里）也不在这里补 —— 它没真丢，去回收站捞即可。
 */
export async function restoreLatestBackup(): Promise<{
  vault: Vault;
  added: number;
  date: string;
} | null> {
  if (!cached) return null;
  const dek = cached.dek;
  const current = await decryptVault(dek);
  const keys = await snapshotKeys();

  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index]!;
    const backup = await readSnapshot(key);
    if (!backup || backup.accounts.length === 0) continue;

    const seen = new Set(current.accounts.map(identityOf));
    // 软删的账户还在「最近删除」里，不算真丢 —— 把它们也纳入判重，
    // 否则从备份恢复会把躺在回收站的账户又补回列表，造成同一密钥
    // 同时出现在列表和回收站里，违背软删除的不变量
    for (const trashed of current.trash) seen.add(identityOf(trashed));
    const missing = backup.accounts.filter((account) => !seen.has(identityOf(account)));
    if (missing.length === 0) continue;

    const next: Vault = { ...current, accounts: [...current.accounts, ...missing] };
    await local.set(KEYS.vault, await encryptJson(dek, next));
    return { vault: next, added: missing.length, date: key.slice(BACKUP_PREFIX.length) };
  }
  return null;
}

/**
 * 每天第一次改动时留一份备份，最多留 7 份。
 * 备份用同一个 DEK 加密：密钥丢了备份也打不开，但密钥本身有恢复码兜底。
 */
export async function maybeBackup(vault: Vault): Promise<boolean> {
  if (!cached) return false;
  const meta = (await local.get<VaultMeta>(KEYS.meta)) ?? {
    createdAt: Date.now(),
    lastBackupDate: null,
    schemaVersion: VAULT_VERSION,
  };
  const date = today();
  if (meta.lastBackupDate === date) return false;

  const dek = cached.dek;
  await local.set(backupKey(date), await encryptJson(dek, vault));
  await local.set(KEYS.meta, { ...meta, lastBackupDate: date });

  // 只留最近 7 份，按日期字符串排序（YYYY-MM-DD 可直接比大小）
  const all = await snapshotKeys();
  for (const stale of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) {
    await local.remove(stale);
  }
  return true;
}

/** 测试与"重来一次"用：清掉本模块所有状态 */
export async function resetAll(): Promise<void> {
  await forgetDek();
  await local.remove(KEYS.vault);
  await local.remove(KEYS.dekWrap);
  await local.remove(KEYS.dekWrapRecovery);
  await local.remove(KEYS.meta);
  for (const key of await local.keys()) {
    if (key.startsWith(BACKUP_PREFIX)) await local.remove(key);
  }
}
