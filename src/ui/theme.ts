export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * 把主题落到 <html class="dark">。
 *
 * 只在 `<html>` 上落一个 class，颜色全部来自 `globals.css` 里的 CSS 变量 ——
 * 所以系统在运行中切到暗色时，`matchMedia` 的 change 事件一响，整屏立刻跟着变，
 * 不需要重开弹窗。`system` 时保持监听，用户选了 light / dark 就不再理会系统。
 *
 * 返回解绑函数，交给 `useEffect` 的清理阶段。
 */
export function applyTheme(mode: ThemeMode = 'system'): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const sync = () => {
    const dark = mode === 'dark' || (mode === 'system' && media.matches);
    document.documentElement.classList.toggle('dark', dark);
  };

  sync();
  media.addEventListener('change', sync);
  return () => media.removeEventListener('change', sync);
}
