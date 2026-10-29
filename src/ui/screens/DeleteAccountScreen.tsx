import { useState } from 'react';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { describeError, useMessage } from '../errors';
import type { Message } from '../errors';
import { useT } from '../i18n';
import { useAccounts, useAppStore } from '../store';

/**
 * 删除确认。
 *
 * 不做成"输入账户名才能删"那种重仪式：这里删掉的东西本地还有 7 份备份，
 * 而仪式越重，用户越容易养成"闭眼点确认"的习惯 —— 那才是真正的危险。
 * 但按钮上必须写清**要删的是谁**，让人有机会发现点错了行。
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
  const label = account
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
    <div className="flex min-h-[280px] flex-col bg-bg">
      <ScreenHeader title={t('delete.title')} onBack={closeSheet} />
      <div className="flex flex-1 flex-col px-4 py-4">
        <p className="text-[13px] leading-relaxed">{t('delete.confirm')}</p>
        {label && (
          <p className="mt-1.5 rounded-[8px] bg-surface-alt/60 px-3 py-2 text-[13px] font-medium text-fg break-words">
            {label}
          </p>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">{t('delete.body')}</p>

        {error && (
          <p role="alert" className="mt-3 text-[11px] text-danger">
            {message(error)}
          </p>
        )}

        <div className="mt-auto space-y-2 pt-5">
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
