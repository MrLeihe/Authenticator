import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { describeError, useMessage } from '../errors';
import type { Message } from '../errors';
import { useT } from '../i18n';
import { useAccounts, useAppStore } from '../store';

/**
 * 删除确认 —— 居中弹窗，不是整屏页面。
 *
 * 做成浮在列表上的对话框：删的是哪一行，背后还看得到，用户不会"删完才想起
 * 删错了谁"。这里不搞"输入账户名才能删"的重仪式 —— 删除已经是软删除，
 * 进「最近删除」躺 30 天，随时能捞回来，所以仪式越重反而越教人闭眼点确认。
 */
export function DeleteAccountScreen({ id }: { id: string }) {
  const t = useT();
  const message = useMessage();
  const closeSheet = useAppStore((s) => s.closeSheet);
  const deleteAccount = useAppStore((s) => s.deleteAccount);
  const account = useAccounts().find((item) => item.id === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 要删的是谁，必须一眼看得见 —— 点错行的时候，这是最后一道拦截
  const label = account
    ? account.account
      ? t('name.with-issuer', { issuer: account.issuer, account: account.account })
      : account.issuer || t('delete.this-account')
    : '';

  // 浮层打开时把焦点移进来：外面被 inert 屏蔽后，不主动落焦点的话，
  // 焦点会停在已经不可交互的列表按钮上，键盘用户按 Tab 不知道自己在哪
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // 焦点循环 + Esc 关闭。只圈住弹窗里的可聚焦元素，Tab 在首尾之间打转，
  // 不逃到被 inert 的背景列表上
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
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
  }, [busy, closeSheet]);

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(id);
    } catch (cause) {
      const described = describeError(cause);
      setError(described.key === 'error.unknown' ? { key: 'delete.failed' } : described);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={busy ? undefined : closeSheet}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('delete.title')}
        tabIndex={-1}
        className="w-full max-w-[320px] rounded-[16px] bg-surface p-5 shadow-xl outline-none ring-0 focus-visible:ring-0"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-center text-[16px] font-semibold tracking-tight">
          {t('delete.title')}
        </h2>

        <p className="mt-3 text-center text-[13px] leading-relaxed">{t('delete.confirm')}</p>

        {label && (
          <p className="mt-2 rounded-[8px] bg-surface-alt/60 px-3 py-2 text-center text-[13px] font-medium text-fg break-words">
            {label}
          </p>
        )}

        <p className="mt-2 text-center text-[12px] leading-relaxed text-fg-muted">
          {t('delete.body')}
        </p>

        {error && (
          <p role="alert" className="mt-3 text-center text-[11px] text-danger">
            {message(error)}
          </p>
        )}

        <div className="mt-5 space-y-2">
          <Button
            variant="primary"
            className="!bg-danger hover:!bg-danger/90"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {t(busy ? 'delete.deleting' : 'delete.action')}
          </Button>
          <Button variant="text" className="w-full" onClick={closeSheet} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
