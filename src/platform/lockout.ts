import { KEYS, session } from './storage';

/**
 * 解锁失败的计数与锁定截止时间。
 *
 * 为什么放在 `chrome.storage.session` 而不是组件的 state：
 * 弹窗一关，整个 JS 环境就销毁了，state 随之清零 —— 那样"连续输错 5 次锁 60 秒"
 * 只要关掉弹窗再打开就能绕过去，跟这个机制存在的意义正好相反。
 * 放 session 区刚好：弹窗开关之间它还在，浏览器一关就没了（本来也不该跨重启记着，
 * 谁还记得上一次会话里输错过几次）。也绝不放 `local` —— 那里的东西会被备份带走。
 *
 * 这套东西挡不住有存储权限的人（他可以直接读 `2fa:dekWrap` 离线爆破），
 * 只是让人手输猜密码变慢。别把它当成安全边界。
 */

const KEY = KEYS.lockout;

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 60_000;

export interface Lockout {
  /** 连续输错次数。达到 `MAX_FAILURES` 时归零，同时写下 `until` */
  failures: number;
  /** 锁定截止时间（毫秒时间戳）。`0` 表示当前没有锁定 */
  until: number;
}

/** 非负数兜底：存储里的值可能是手改过的、旧版本留下的、或者干脆不是数字 */
function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export async function readLockout(): Promise<Lockout> {
  const raw = await session.get<{ failures?: unknown; until?: unknown }>(KEY);
  if (!raw) return { failures: 0, until: 0 };
  return {
    // 上限掐在 MAX_FAILURES - 1：到 MAX_FAILURES 就该落成"锁定"而不是"还差一次"
    failures: Math.min(readNumber(raw.failures), MAX_FAILURES - 1),
    until: readNumber(raw.until),
  };
}

/**
 * 记一次「密码不对」，返回写入后的状态（调用方据此决定要不要进锁定）。
 *
 * 上一轮锁定已经到期时从 1 重新数：`until` 过期只说明时间到了，
 * 不该让用户带着上一轮的进度继续（否则解锁成功后错一次就又被锁上）。
 */
export async function recordFailure(now: number = Date.now()): Promise<Lockout> {
  const current = await readLockout();
  // 还在锁定期内：这一发不收。界面上的按钮本来就是禁用的，但这一层不该依赖
  // 界面的自觉 —— 它要是把 until 抹掉，锁定就被一次多余的调用解除了
  if (current.until > now) return current;

  const expired = current.until !== 0 && current.until <= now;
  const failures = (expired ? 0 : current.failures) + 1;
  const next: Lockout =
    failures >= MAX_FAILURES ? { failures: 0, until: now + LOCKOUT_MS } : { failures, until: 0 };
  await session.set(KEY, next);
  return next;
}

/** 解锁成功（密码或恢复码）时清空：不清的话下一次自动上锁后错一次就又被锁住 */
export async function clearLockout(): Promise<void> {
  await session.remove(KEY);
}

/** 还剩多少毫秒。`<= 0` 表示没锁或已到期 */
export function remainingMs(lockout: Lockout, now: number = Date.now()): number {
  return lockout.until > now ? lockout.until - now : 0;
}
