import { useState } from 'react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
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

  // 要删的是谁，必须一眼看得见 —— 点错行的时候，这是最后一道拦截
  const targetLabel = account
    ? account.account
      ? t('name.with-issuer', { issuer: account.issuer, account: account.account })
      : account.issuer || t('delete.this-account')
    : '';

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
    <Dialog label={t('delete.title')} onClose={closeSheet} dismissible={!busy}>
      <h2 className="text-center text-[16px] font-semibold tracking-tight">{t('delete.title')}</h2>

      <p className="mt-3 text-center text-[13px] leading-relaxed">{t('delete.confirm')}</p>

      {targetLabel && (
        <p className="mt-2 rounded-[8px] bg-surface-alt/60 px-3 py-2 text-center text-[13px] font-medium text-fg break-words">
          {targetLabel}
        </p>
      )}

      <p className="mt-2 text-center text-[12px] leading-relaxed text-fg-muted">{t('delete.body')}</p>

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
    </Dialog>
  );
}
