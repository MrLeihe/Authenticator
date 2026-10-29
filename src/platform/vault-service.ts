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
import type { Vault } from '@/core/types';
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
  if (!blob) throw new CryptoError('malformed', '找不到保险库密文');
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
    if (dek.length !== DEK_BYTES) throw new CryptoError('malformed', '明文 DEK 长度不对');
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
  cached = { dek };
  return { vault, recoveryCode: null };
}

/** 用密码包一层，并额外生成恢复码包装。两条包装指向同一个 DEK。 */
async function applyPassword(
  dek: Uint8Array,
  password: string,
): Promise<{ recoveryCode: string }> {
  const check = checkPassword(password);
  if (!check.ok) throw new CryptoError('malformed', check.issues.join('；'));

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
  if (!wrap) throw new CryptoError('malformed', '还没有保险库');
  if (wrap.kind === 'none') throw new CryptoError('malformed', '未开启密码保护');
  if (wrap.kind === 'recovery') {
    throw new CryptoError('malformed', '主包装是恢复码，无法用密码解锁');
  }

  const kek = await deriveKek(password, base64ToBytes(wrap.salt), wrap.iter);
  const dek = await unwrapDek({ v: 1, iv: wrap.iv, ct: wrap.ct }, kek);
  const vault = await decryptVault(dek);
  await rememberDek(dek);
  return vault;
}

export async function unlockWithRecovery(code: string): Promise<Vault> {
  const { recovery } = await readStatusRaw();
  if (!recovery) throw new CryptoError('malformed', '没有保存恢复码包装');
  if (recovery.kind !== 'recovery') {
    throw new CryptoError('malformed', '恢复码包装的形态不对');
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
  if (!cached) throw new CryptoError('wrong-key', '当前未解锁');
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
  const all = (await local.keys()).filter((key) => key.startsWith('2fa:backup:')).sort();
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
    if (key.startsWith('2fa:backup:')) await local.remove(key);
  }
}
