import { useEffect } from 'react';
import { useT } from '../i18n';
import { useAppStore } from '../store';

const DURATION = 1800;

/** 浮层提示。居中显示，同一时刻只显示一条，新的直接顶掉旧的。 */
export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const dismiss = useAppStore((s) => s.dismissToast);
  const t = useT();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismiss(toast.id), DURATION);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

  return (
    /* 居中而不是贴底：弹窗高度跟着账户数走，贴底时提示正好压在最后一行的
       验证码上，而那串码恰恰是刚复制的那个 —— 遮住用户正在核对的内容。
       居中的位置，离顶部的搜索框和底部的行尾环都远一点 */
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div
        className={`animate-fade-in rounded-full px-4 py-2 text-[13px] font-medium shadow-lg backdrop-blur ${
          toast.tone === 'danger'
            ? 'bg-danger/95 text-white'
            : 'bg-fg/90 text-bg'
        }`}
      >
        {t(toast.message, toast.vars)}
      </div>
    </div>
  );
}
