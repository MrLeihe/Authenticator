import { useState } from 'react';
import { copyText } from '@/platform/clipboard';
import { useT } from '../i18n';
import { CheckIcon, CopyIcon, KeyIcon } from './Icons';
import { PrimaryButton } from './Button';

/**
 * 恢复码展示页。
 *
 * 三条硬规矩：
 * 1. **没有关闭按钮**。恢复码只在这里出现这一次，误关就永久丢了 ——
 *    所以唯一的出口是"我已经存好了"。
 * 2. 勾选才能继续，不是一个可以点掉的提示条。用户得真的做一次动作。
 * 3. **走正常文档流，不用 fixed 遮罩**。弹窗高度由内容决定，
 *    固定定位的浮层一旦高于弹窗就会被裁掉且无法滚动 ——
 *    底部那个"继续"按钮会直接摸不到。所以它是整屏替换，不是覆盖。
 */
export function RecoveryCodeSheet({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const groups = code.split('-');

  const handleCopy = async () => {
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      // 复制成功不等于存好了，不替用户勾选，只给一个确认反馈
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg px-5 pb-5 pt-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-alt text-accent">
          <KeyIcon size={16} />
        </span>
        <h2 className="text-[16px] font-semibold tracking-tight">{t('recovery.title')}</h2>
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-fg-muted">{t('recovery.subtitle')}</p>

      <div className="rounded-[12px] border border-separator bg-surface p-3">
        <div className="grid grid-cols-4 gap-x-3 gap-y-2">
          {groups.map((group, index) => (
            <span
              key={index}
              className="font-digit text-[15px] tracking-wider text-fg"
              style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
            >
              {group}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[8px] bg-surface-alt py-2 text-[12px] font-medium text-fg transition-colors duration-150 hover:bg-separator"
          onClick={() => void handleCopy()}
        >
          {copied ? <CheckIcon size={14} className="text-success" /> : <CopyIcon size={14} />}
          {copied ? t('recovery.copied') : t('recovery.copy')}
        </button>
      </div>

      <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-fg-muted">
        <li>· {t('recovery.tip.once')}</li>
        <li>· {t('recovery.tip.store')}</li>
        <li>· {t('recovery.tip.anyone')}</li>
      </ul>

      <div className="mt-auto pt-4">
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-[12px] text-fg">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            className="h-4 w-4 accent-[rgb(var(--accent))]"
          />
          {t('recovery.saved')}
        </label>
        <PrimaryButton disabled={!saved} onClick={onDone}>
          {t('common.continue')}
        </PrimaryButton>
      </div>
    </div>
  );
}
