import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { BackIcon } from './Icons';

/**
 * 子界面的标题栏。
 *
 * 返回按钮是**唯一**的出口，所以它必须一直在左上角、一直可点 ——
 * 这些界面是整屏替换，用户按不到浏览器的「后退」。
 */
export function ScreenHeader({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack: () => void;
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-separator bg-bg/95 px-3 py-2.5 backdrop-blur">
      <button
        type="button"
        aria-label={t('common.back')}
        className="-ml-1 rounded-[8px] p-1.5 text-fg-muted transition-colors duration-150 hover:bg-surface-alt hover:text-fg"
        onClick={onBack}
      >
        <BackIcon size={17} />
      </button>
      <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
      {action && <div className="ml-auto">{action}</div>}
    </header>
  );
}
