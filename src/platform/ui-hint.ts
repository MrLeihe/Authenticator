import { KEYS, local } from './storage';

/**
 * 一次性提示条的"关掉过"状态。
 *
 * 只记时间戳，不记布尔值 —— 需求是「关掉之后 7 天再冒一次」，而不是「永久消失」。
 * 一个永久消失的提醒等于没写过：用户当时觉得烦关掉，三个月后换了台机器、
 * 或者本来就没注意到，就再也没有第二次机会知道"数据还没上锁"。
 */

/** 关掉之后多少天重现 */
const REPEAT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface UiHintRecord {
  passwordHintDismissedAt?: number;
}

/**
 * 该不该显示"你还没设密码"那条提示。
 *
 * 读失败时返回 `true`：提示条是纯提醒，多显示一次的代价远小于
 * "因为存储读不出来就永远不提醒用户给验证器上锁"。
 */
export async function isPasswordHintDue(now: number = Date.now()): Promise<boolean> {
  let record: UiHintRecord | undefined;
  try {
    record = await local.get<UiHintRecord>(KEYS.uiHint);
  } catch {
    return true;
  }
  const at = record?.passwordHintDismissedAt;
  if (typeof at !== 'number') return true;
  return now - at >= REPEAT_AFTER_MS;
}

/** 记下"这次关掉了"。写失败不影响界面：下一次打开会再问一遍，不是错误 */
export async function dismissPasswordHint(now: number = Date.now()): Promise<void> {
  try {
    await local.set(KEYS.uiHint, { passwordHintDismissedAt: now } satisfies UiHintRecord);
  } catch {
    // 静默：提示条已经关掉了，为一条记不住的偏好弹一个报错只会更烦
  }
}
