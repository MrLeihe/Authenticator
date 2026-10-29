import { useEffect } from 'react';
import { autoLockIfExpired, touchUnlocked } from '@/platform/vault-service';
import { useAppStore } from '../store';

/** 巡检间隔。5 秒足够细，又不至于让定时器本身变成负担 */
const CHECK_MS = 5000;
/** 刷新解锁时间点的节流窗口：用户一直在动，也不必每次都写存储 */
const ACTIVITY_THROTTLE_MS = 20_000;

/**
 * 自动锁。只在解锁状态下生效。
 *
 * 时间基准是 `chrome.storage.session` 里的 `unlockedAt`，不是 React 里的某个变量：
 * 关掉弹窗再打开时进程都换了，只有存储里的时间戳还作数。
 */
export function useAutoLock(active: boolean) {
  const autoLockMinutes = useAppStore((s) => s.vault?.settings.autoLockMinutes ?? 0);
  const lockSilently = useAppStore((s) => s.lockSilently);

  // 有动作就算"还在用"
  useEffect(() => {
    if (!active || autoLockMinutes <= 0) return;
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < ACTIVITY_THROTTLE_MS) return;
      last = now;
      void touchUnlocked();
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel'];
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, onActivity);
    };
  }, [active, autoLockMinutes]);

  // 定时巡检。服务层负责真正清掉会话，这里只把界面切回锁屏。
  useEffect(() => {
    if (!active || autoLockMinutes <= 0) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void autoLockIfExpired(autoLockMinutes).then((locked) => {
        if (locked && !cancelled) lockSilently();
      });
    }, CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, autoLockMinutes, lockSilently]);
}
