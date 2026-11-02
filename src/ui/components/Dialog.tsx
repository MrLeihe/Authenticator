import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerOverlay } from '../overlay';

/**
 * 浮在当前界面之上的对话框。
 *
 * 只给「一句话 + 一两个输入框」这种短交互用（删除确认、设置密码）。
 * 比这更长的内容一律走整屏子界面：弹窗高度跟着浏览器窗口走，
 * 内容一超过窗口高度就既滚不动也裁不掉。
 */
export function Dialog({
  label,
  onClose,
  dismissible = true,
  className = 'max-w-[320px]',
  children,
}: {
  /** 读屏念的对话框名字 */
  label: string;
  onClose: () => void;
  /** 正在提交时置 false：这时点遮罩、按 Esc 都不该把它收掉 */
  dismissible?: boolean;
  /** 宽度上限：纯确认给 320，带输入框的给 340 */
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // 监听器只注册一次，最新的回调和可用状态走 ref。把 `onClose` 写进依赖数组的话，
  // 父界面每次重渲染都要摘挂一遍 window 监听器，Esc 正好落在那个空档里就没反应
  const latest = useRef({ onClose, dismissible });
  latest.current = { onClose, dismissible };

  useEffect(() => registerOverlay(), []);

  // 落焦点：外面没有 inert，全靠这一下落点和下面的 Tab 循环把键盘圈住。
  // 表单里已经 autoFocus 的输入框优先 —— 打开就能直接打字，不该先停在容器上
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) root.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { onClose: close, dismissible: canDismiss } = latest.current;
      if (event.key === 'Escape') {
        if (!canDismiss) return;
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = rootRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 挂到 body 上而不是就地渲染：卡片带 overflow-hidden，整屏子界面入场时还带着
  // transform —— 这两样都会让 fixed 定位跟着祖先走，弹窗会被裁一刀或者整个错位
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`w-full rounded-[16px] bg-surface p-5 shadow-xl ring-1 ring-black/[0.04] outline-none focus-visible:ring-0 dark:ring-white/10 ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
