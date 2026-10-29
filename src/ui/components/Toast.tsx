import { useEffect } from 'react';
import { useT } from '../i18n';
import { useAppStore } from '../store';

const DURATION = 1800;

/** 底部浮层提示。同一时刻只显示一条，新的直接顶掉旧的。 */
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
    <div
      className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div
        className={`animate-fade-in rounded-full px-3.5 py-1.5 text-[12px] font-medium shadow-lg backdrop-blur ${
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
