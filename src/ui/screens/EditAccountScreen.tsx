import { AccountForm } from '../components/AccountForm';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../i18n';
import { useAccounts, useAppStore } from '../store';

/** 编辑账户。表单与新增共用，只有标题和提交文案不同。 */
export function EditAccountScreen({ id }: { id: string }) {
  const t = useT();
  const closeSheet = useAppStore((s) => s.closeSheet);
  const saveAccount = useAppStore((s) => s.saveAccount);
  const account = useAccounts().find((item) => item.id === id);

  // 极端情况：删完之后又点了编辑。直接退回列表，不留一个空表单
  if (!account) {
    return (
      <div className="flex min-h-[280px] flex-col bg-bg">
        <ScreenHeader title={t('edit.title')} onBack={closeSheet} />
        <p className="px-4 py-6 text-[12px] text-fg-muted">{t('edit.missing')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      <ScreenHeader title={t('edit.title')} onBack={closeSheet} />
      <div className="flex-1 px-4 py-3">
        <AccountForm
          initial={account}
          submitKey="edit.save"
          onSubmit={(draft) => saveAccount(account.id, draft)}
          onCancel={closeSheet}
        />
      </div>
    </div>
  );
}
