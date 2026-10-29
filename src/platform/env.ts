/**
 * 扩展运行环境的判定。
 *
 * 存在两种打开方式：
 * 1. 扩展内（chrome-extension://）—— `chrome.runtime.id` 有值；
 * 2. 浏览器里直接开 `vite dev` 的页面做视觉调试 —— 此时 chrome.runtime 不存在。
 * 第二种只用于开发期调样式，任何真实数据读写都必须在第一种里发生。
 */
export function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

/** 扩展版本号；非扩展环境下退化为 'dev'，避免调试页直接白屏 */
export function getExtensionVersion(): string {
  if (!isExtensionContext()) return 'dev';
  return chrome.runtime.getManifest().version;
}
