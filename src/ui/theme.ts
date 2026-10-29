export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * 把主题落到 <html class="dark">。
 * P0 只跟随系统；P3 接入 settings.theme 后传入 'light' / 'dark' 覆盖。
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
