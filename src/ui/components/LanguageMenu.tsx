import { useEffect, useRef, useState } from 'react';
import type { Settings } from '@/core/types';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { registerOverlay } from '../overlay';
import { CheckIcon, ChevronDownIcon, GlobeIcon } from './Icons';

const OPTIONS: ReadonlyArray<{ value: Settings['language']; label: MessageKey }> = [
  { value: 'system', label: 'language.system' },
  { value: 'zh', label: 'language.zh' },
  { value: 'en', label: 'language.en' },
];

/**
 * 设置页标题栏右侧的「界面语言」下拉。
 *
 * 为什么从「显示」分组里挪出来、变成一个下拉：语言和主题、列表风格不一样 ——
 * 它不是"长什么样"的偏好，而是"此刻能不能读懂界面"的开关。一个人把语言切成了
 * 自己不认识的语种，最该做的事就是一眼扫到导航栏、把它切回来；埋在一页的
 * 中间靠"滚动"才能找到，等于把人关在自己看不懂的房间里还藏了钥匙。
 *
 * 交互：窄按钮（地球 + 当前语言 + 向下的箭头）点开一个贴边的小菜单，
 * 当前项打勾。点外面 / Esc / 选中任意一项都会收起。选完立刻生效，不用"保存"。
 */
export function LanguageMenu({
  value,
  onChange,
}: {
  value: Settings['language'];
  onChange: (value: Settings['language']) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // 菜单打开期间占一层浮层：Esc 归它，设置页的「退一层」不许跟着一起关掉
  useEffect(() => {
    if (!open) return;
    return registerOverlay();
  }, [open]);

  // 点外面收起。挂在 document 而不是等失焦：菜单里点完一项本就要收，
  // 用 blur 的话"点同一项两次"这种场景会漏
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0]!;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('settings.language')}
        className="flex items-center gap-1 rounded-[8px] px-2 py-1 text-[13px] text-fg transition-colors duration-150 hover:bg-surface-alt"
        onClick={() => setOpen((v) => !v)}
      >
        <GlobeIcon size={14} className="text-fg-muted" />
        <span>{t(current.label)}</span>
        <ChevronDownIcon
          size={13}
          className={`text-fg-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-[12px] border border-separator bg-surface p-1 shadow-lg"
        >
          {OPTIONS.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`flex w-full items-center justify-between gap-3 rounded-[8px] px-3 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-row-hover ${
                  active ? 'font-medium text-fg' : 'text-fg'
                }`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{t(option.label)}</span>
                {active && <CheckIcon size={14} className="text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
