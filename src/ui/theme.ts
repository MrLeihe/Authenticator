import { useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * 当前**实际**是深色还是浅色。
 *
 * 顶部的主题按钮要画「点下去会变成什么」，而不是「设置里存的是什么」：
 * 存的是 `system` 时，用户看到的是浅色，按钮就该显示月亮。
 */
export function useResolvedDark(mode: ThemeMode): boolean {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    if (mode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [mode]);

  return mode === 'dark' || (mode === 'system' && systemDark);
}

/**
 * 把主题落到 <html class="dark">。
 *
 * 只在 `<html>` 上落一个 class，颜色全部来自 `globals.css` 里的 CSS 变量 ——
 * 所以系统在运行中切到暗色时，`matchMedia` 的 change 事件一响，整屏立刻跟着变，
 * 不需要重开弹窗。`system` 时保持监听，用户选了 light / dark 就不再理会系统。
 *
 * 返回解绑函数，交给 `useEffect` 的清理阶段。
 *
 * 默认参数是 `light`（产品默认值）而不是 `system`：`main.tsx` 在 React 挂载前
 * 就会先调一次，目的是别让弹窗先白后黑闪一下。那一步发生时库还没解开，
 * 读不到用户真正选过的主题，只能按默认值猜 —— 猜成 `system` 的话，
 * 系统是深色的用户每打开一次弹窗都会先黑后白，比猜错一个用户的偏好更常见。
 */
export function applyTheme(mode: ThemeMode = 'light'): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const sync = () => {
    const dark = mode === 'dark' || (mode === 'system' && media.matches);
    document.documentElement.classList.toggle('dark', dark);
  };

  sync();
  media.addEventListener('change', sync);
  return () => media.removeEventListener('change', sync);
}
