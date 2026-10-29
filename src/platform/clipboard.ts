/**
 * 剪贴板：复制验证码 + 定时清空。
 *
 * 限制（务必清楚，不要误以为已经解决）：
 * 定时器活在 popup 的 JS 环境里，popup 一关就随之销毁。
 * 也就是说只有"复制后一直开着 popup"才会自动清空。
 * MV3 想做到弹窗关闭后仍清空，得把定时任务搬到 service worker，
 * 而 chrome.alarms 的最小粒度是 30 秒（Chrome 120 之前是 1 分钟），
 * 没法表达 15 秒这一档 —— 这条留给 P6 单独处理。
 */
let clearTimer: ReturnType<typeof setTimeout> | null = null;
let lastCopied = '';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    lastCopied = text;
    return true;
  } catch {
    // 无权限或被拒绝时退回老办法：临时 textarea + execCommand
    return fallbackCopy(text);
  }
}

function fallbackCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    if (ok) lastCopied = text;
    return ok;
  } catch {
    return false;
  }
}

/**
 * 定时清空剪贴板。只在内容仍是我们写入的那串验证码时才清，
 * 避免把用户后来复制的别的东西抹掉。
 */
export function scheduleClipboardClear(seconds: number): void {
  cancelClipboardClear();
  if (seconds <= 0) return;

  clearTimer = setTimeout(() => {
    clearTimer = null;
    void (async () => {
      try {
        // 有读权限时先核对内容，防止误清
        if (navigator.clipboard.readText) {
          const current = await navigator.clipboard.readText();
          if (current !== lastCopied && current !== normalize(lastCopied)) return;
        }
      } catch {
        // 读不到就没法核对，直接清 —— 与"验证码不该长时间留在剪贴板"一致
      }
      try {
        await navigator.clipboard.writeText('');
        lastCopied = '';
      } catch {
        /* 写失败就算了，不打扰用户 */
      }
    })();
  }, seconds * 1000);
}

export function cancelClipboardClear(): void {
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

function normalize(code: string): string {
  return code.replace(/\s/g, '');
}
