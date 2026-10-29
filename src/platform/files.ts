/**
 * 文件下载。
 *
 * 故意不用 `chrome.downloads`：那要额外申请一个权限，而一个"导出备份"按钮
 * 完全可以用 `<a download>` 走通。商店审核对"申请了却只在角落用一次"的权限
 * 很敏感，少一个是一个。
 */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  // 必须挂到 DOM 上再点：Firefox 对游离节点不触发下载，Chrome 偶尔也会静默忽略
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立刻 revoke 会让浏览器还没接手的数据流断掉，给几秒缓冲
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `authenticator-2026-10-29`：用本地时区，因为用户看的是自己的日历 */
export function exportFileName(extension: string, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `authenticator-${stamp}.${extension}`;
}
