import { useState } from 'react';
import type { Account } from '@/core/types';
import { TRASH_RETENTION_MS } from '@/core/vault';
import { TextButton } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../i18n';
import { useAppStore, useTrash } from '../store';

/**
 * 「最近删除」。
 *
 * 删除不是真删，而是进这里躺 30 天 —— 和 iOS 相册的「最近删除」同一个心智。
 * 这里能做两件事：恢复（移回列表）、彻底删除（现在就从本机抹掉）。
 * 每条都写明「还剩几天」，让人知道这不是无限期的后悔药。
 */
export function TrashScreen() {
  const t = useT();
  const back = useAppStore((s) => s.back);
  const trash = useTrash();

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-6">
      <ScreenHeader title={t('trash.title')} onBack={back} />

      {trash.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] leading-relaxed text-fg-muted">
          {t('trash.empty')}
        </p>
      ) : (
        <div className="pt-4">
          <p className="mb-2 px-6 text-[12px] leading-relaxed text-fg-muted">
            {t('trash.hint')}
          </p>
          <div className="card-divide mx-4 overflow-hidden rounded-card bg-surface">
            {trash.map((account) => (
              <TrashRow key={account.id} account={account} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrashRow({ account }: { account: Account }) {
  const t = useT();
  const restoreTrashed = useAppStore((s) => s.restoreTrashed);
  const purgeTrashed = useAppStore((s) => s.purgeTrashed);
  const showToast = useAppStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);

  const label = account.account
    ? t('name.with-issuer', { issuer: account.issuer, account: account.account })
    : account.issuer || t('delete.this-account');

  const daysLeft = account.archivedAt
    ? Math.max(1, Math.ceil((account.archivedAt + TRASH_RETENTION_MS - Date.now()) / 86_400_000))
    : null;

  const restore = async () => {
    setBusy(true);
    try {
      // store 内部已处理「恢复成功 / 同名冲突」两种提示，这里只管失败兜底
      await restoreTrashed(account.id);
    } catch {
      showToast('toast.restore-failed', { tone: 'danger' });
      setBusy(false);
    }
  };

  const purge = async () => {
    setBusy(true);
    try {
      await purgeTrashed(account.id);
    } catch {
      showToast('toast.purge-failed', { tone: 'danger' });
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-fg">{label}</p>
          {daysLeft !== null && (
            <p className="mt-0.5 text-[12px] text-fg-muted">
              {t('trash.days-left', { days: daysLeft })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <TextButton onClick={() => void restore()} disabled={busy}>
            {t('trash.restore')}
          </TextButton>
          <TextButton onClick={() => void purge()} disabled={busy} className="!text-danger">
            {t('trash.purge')}
          </TextButton>
        </div>
      </div>
    </div>
  );
}
