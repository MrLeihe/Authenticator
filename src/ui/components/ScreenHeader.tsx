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
    // 和首页标题栏同一条 hairline：两层界面都是 sticky + 半透明，
    // 只有首页有线、子页面没线的话，点进点出会觉得"框"忽有忽无
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-separator bg-bg/95 px-4 py-3 backdrop-blur">
      <button
        type="button"
        aria-label={t('common.back')}
        className="-ml-2 rounded-[8px] p-1.5 text-fg transition-colors duration-150 hover:bg-surface-alt"
        onClick={onBack}
      >
        <BackIcon size={20} />
      </button>
      {/* 18px：子界面标题和首页标题同一档，返回后不觉得"缩了一号" */}
      <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
      {action && <div className="ml-auto">{action}</div>}
    </header>
  );
}
