import { useState } from 'react';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAccounts, useAppStore } from '../store';

/**
 * 删除确认。
 *
 * 不做成"输入账户名才能删"那种重仪式：这里删掉的东西本地还有 7 份备份，
 * 而仪式越重，用户越容易养成"闭眼点确认"的习惯 —— 那才是真正的危险。
 * 但按钮上必须写清**要删的是谁**，让人有机会发现点错了行。
 */
export function DeleteAccountScreen({ id }: { id: string }) {
  const closeSheet = useAppStore((s) => s.closeSheet);
  const deleteAccount = useAppStore((s) => s.deleteAccount);
  const account = useAccounts().find((item) => item.id === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = account
    ? account.account
      ? `${account.issuer}：${account.account}`
      : account.issuer || '这个账户'
    : '';

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      <ScreenHeader title="删除账户" onBack={closeSheet} />
      <div className="flex flex-1 flex-col px-4 py-4">
        <p className="text-[13px] leading-relaxed">
          确定要删除 <span className="font-medium text-fg">{title}</span> 吗？
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">
          删除后这个账户就不会再生成验证码了。如果只是暂时不想看到，可以把它置顶。
        </p>

        {error && <p className="mt-3 text-[11px] text-danger">{error}</p>}

        <div className="mt-auto space-y-2 pt-5">
          <Button
            variant="primary"
            className="!bg-danger hover:!bg-danger/90"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? '删除中…' : '删除'}
          </Button>
          <Button variant="text" className="w-full" onClick={closeSheet} disabled={busy}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
