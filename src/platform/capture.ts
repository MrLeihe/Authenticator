import { decodeQrImage } from './qr';

/**
 * 截当前标签页 → 二维码文本。
 *
 * 为什么值得单开一条路：这个扩展被打工位打开的典型时刻，是"某个网站的
 * 登录页正把二维码摆在屏幕上"。答案就在那儿，让用户先截图、再回来粘贴，
 * 中间多出两个念头（图存哪了、要不要先存成文件）；直接截一次就完事。
 *
 * 代价是多要一个 `activeTab` 权限。它只在用户点扩展图标那一刻授予、
 * 只对当时那个标签页有效，读不到别的页面，也不需要 `<all_urls>` ——
 * 想读页面内容的能力里，这是最轻的一档。
 */

export class CaptureError extends Error {
  constructor(
    /** `unavailable`：不在扩展环境里；`blocked`：浏览器拒绝截这个页面 */
    readonly reason: 'unavailable' | 'blocked',
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** `data:image/png;base64,...` → Blob。不用 `fetch(dataUrl)`：扩展页的 CSP 没必要为此放宽 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new CaptureError('blocked', 'capture returned a malformed data url');
  const mime = /^data:([^;]+)/.exec(dataUrl.slice(0, comma))?.[1] ?? 'image/png';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

/**
 * 截当前标签页并解出其中的二维码。
 *
 * 抛 `CaptureError`：截不到（chrome://、应用商店、PDF 阅读器这类页面
 * 浏览器一律拒绝）；抛 `QrError`：截到了但没有二维码（或者图不可读）。
 * 界面按这两类分别说话 —— "换个页面试试"和"这张图里没有码"是两条不同的下一步。
 */
export async function capturePageQr(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
    throw new CaptureError('unavailable', 'chrome.tabs.captureVisibleTab is unavailable');
  }

  let dataUrl: string;
  try {
    // 不传 windowId：popup 打开时当前窗口就是用户的窗口，
    // 传 `chrome.windows.WINDOW_ID_CURRENT` 反而要多一次 windows API 调用
    dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  } catch (cause) {
    throw new CaptureError('blocked', cause instanceof Error ? cause.message : 'capture failed');
  }

  return decodeQrImage(dataUrlToBlob(dataUrl));
}
