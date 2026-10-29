import { useEffect, useState } from 'react';

/**
 * 250ms 一跳的时钟。
 *
 * 为什么不用 setInterval：MV3 popup 被打开/切走/关闭时，rAF 会被自动节流或停止，
 * 不需要手动清理；而 setInterval 在 popup 关闭后仍可能留下悬挂的闭包。
 *
 * 为什么用 rAF 而不是直接 setInterval(250)：rAF 跟着屏幕刷新走，
 * 更新和绘制在同一帧里，不会出现"倒计时跳了一格但环还没画"的撕裂。
 *
 * popup 关闭 → 文档销毁 → rAF 自然停止，不留任何后台计时。
 */
export function useTick(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let frame = 0;
    let last = Date.now();

    const loop = () => {
      const current = Date.now();
      if (current - last >= intervalMs) {
        last = current;
        setNow(current);
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [intervalMs]);

  return now;
}
