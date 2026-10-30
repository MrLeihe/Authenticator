import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CachedCode } from '@/core/totp-cache';
import { TotpCache } from '@/core/totp-cache';
import type { Account } from '@/core/types';
import { AccountRow } from '../components/AccountRow';
import { EmptyGuide } from '../components/EmptyGuide';
import { PasswordHintBanner } from '../components/PasswordHintBanner';
import { MoonIcon, KeyIcon, PlusIcon, SearchIcon, SettingsIcon, SunIcon } from '../components/Icons';
import { useTick } from '../hooks/useTick';
import { useLang, useT } from '../i18n';
import { useResolvedDark } from '../theme';
import {
  filterAccounts,
  sortAccounts,
  useAccounts,
  useAppStore,
  useSettings,
} from '../store';

export function ListScreen() {
  const t = useT();
  const lang = useLang();
  const accounts = useAccounts();
  const settings = useSettings();
  const canRecover = useAppStore((s) => s.canRecover);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const setSettings = useAppStore((s) => s.setSettings);
  const showToast = useAppStore((s) => s.showToast);
  const openSheet = useAppStore((s) => s.openSheet);
  const reorderAccount = useAppStore((s) => s.reorderAccount);
  const dark = useResolvedDark(settings.theme);

  // 拖拽排序：只有「手动」排序且没在搜索时才允许 ——
  // 搜索状态下列表只是全集的一个子集，拖出来的位置对不上真实顺序
  const manual = settings.sortBy === 'manual' && query.trim() === '';
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  const now = useTick(250);
  const cache = useRef(new TotpCache());
  const [codes, setCodes] = useState<Map<string, CachedCode>>(new Map());

  const visible = useMemo(
    () => filterAccounts(sortAccounts(accounts, settings.sortBy, lang), query),
    [accounts, settings.sortBy, lang, query],
  );

  // 每次 tick 只让缓存重算翻页的那几个账户，其余直接命中
  useEffect(() => {
    let alive = true;
    void cache.current.refresh(visible, now).then((next) => {
      if (alive) setCodes(next);
    });
    return () => {
      alive = false;
    };
  }, [visible, now]);

  const drop = (targetId: string, after: boolean) => {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id || id === targetId) return;

    const from = visible.findIndex((account) => account.id === id);
    if (from < 0) return;
    const to = visible.findIndex((account) => account.id === targetId);
    if (to < 0) return;

    // 落点换算成「插到谁前面」；null 表示末尾
    const beforeId = after ? (visible[to + 1]?.id ?? null) : targetId;
    // 拖回原位不算改动，别白写一次盘
    if (beforeId === id || visible[from + 1]?.id === beforeId) return;

    // 落盘失败的具体原因（配额、权限）对用户没用，能做的只有"再拖一次"；
    // 与其把底层报错摊出来，不如直说这次顺序没存上
    void reorderAccount(id, beforeId).catch(() => {
      showToast('toast.reorder-failed', { tone: 'danger' });
    });
  };

  // 主题切换是"点一下立刻生效"，存盘失败要当场说一句，不能静默掉
  const switchTheme = (theme: 'light' | 'dark') => {
    void setSettings({ theme }).catch(() => {
      showToast('toast.settings-failed', { tone: 'danger' });
    });
  };

  const remainingOf = (account: Account): number => {
    const period = codes.get(account.id)?.period ?? account.period ?? 30;
    const seconds = Math.floor(now / 1000);
    return period - (seconds % period);
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      {/* 底部一根分割线：header 是 sticky + 半透明毛玻璃的，列表往上滚时
          内容会从它下面"透"过去。毛玻璃本身只够糊掉对比度，糊不掉"这里有一行字"，
          一条 hairline 才能把标题栏和信息区切开，滚起来也不会糊成一片 */}
      <header className="sticky top-0 z-10 border-b border-separator bg-bg/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          {/* 图标 + 标题：参考实现的标题栏是有牌面的，
              一个纯文字标题在 400px 的弹窗里会显得像"页签"而不是"应用" */}
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-accent text-white"
          >
            <KeyIcon size={16} />
          </span>
          <h1 className="text-[17px] font-semibold tracking-tight">{t('app.name')}</h1>

          <div className="ml-auto flex items-center gap-1">
            {/* 三个都是同样的幽灵按钮：右上角一排里有一个是实心方块时，
                那一排就永远对不齐视觉重量。强调动作靠颜色（accent）而不是填充 */}
            <HeaderButton label={t('list.add')} onClick={() => openSheet({ kind: 'add' })} accent>
              <PlusIcon size={19} />
            </HeaderButton>
            {/* 画的是"点下去会变成什么"：现在是浅色就画月亮 */}
            <HeaderButton
              label={dark ? t('list.theme-to-light') : t('list.theme-to-dark')}
              onClick={() => switchTheme(dark ? 'light' : 'dark')}
            >
              {dark ? <SunIcon size={19} /> : <MoonIcon size={19} />}
            </HeaderButton>
            <HeaderButton
              label={t('settings.title')}
              onClick={() => openSheet({ kind: 'settings' })}
            >
              <SettingsIcon size={19} />
            </HeaderButton>
          </div>
        </div>

        {/* 搜索框通栏。视图切换（正常/紧凑）挪到设置里 ——
            它和搜索框挤在同一行时，搜索框只剩 ~250px，
            而"换个视图"一个月也用不了一次，不值得长期占着首页最好的一块横向空间。
            一条账户都没有时不画：空列表搜不出东西，那一条横向空间该让给引导区 */}
        {accounts.length > 0 && (
          <div className="relative mt-2.5">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-muted"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('list.search')}
              className="h-11 w-full rounded-[14px] bg-surface-alt pl-10 pr-3 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
            />
          </div>
        )}
      </header>

      {/* 没设密码时提醒一句。已经有账户才提醒 —— 一个还没装任何码的列表，
          提醒"别人能看到你的验证码"只会让人紧张而不知道在说什么 */}
      {!canRecover && accounts.length > 0 && <PasswordHintBanner />}

      <main
        className={`flex-1 ${
          accounts.length === 0 || settings.style === 'modern' ? 'px-4 pt-2' : 'pt-1.5'
        }`}
        onDragOver={(event) => {
          if (!dragging) return;
          event.preventDefault();
        }}
        // 拖到空白处等于移到末尾，否则"想放到最后一条之后"就只能先拖到倒数第二条
        onDrop={(event) => {
          if (!dragging) return;
          event.preventDefault();
          const last = visible[visible.length - 1];
          if (last) drop(last.id, true);
        }}
      >
        {visible.length === 0 ? (
          // 两类"空"必须分开：一条都没有时给分诊引导，搜不到时只解释搜索
          accounts.length === 0 ? (
            <EmptyGuide />
          ) : (
            <NoMatchState />
          )
        ) : (
          /* 列表是一张白卡：灰底 + 白卡是 iOS 分组列表的层次基础。
             行本身不带底色，hover 时铺一层 row-hover —— 这一档必须比页面底深，
             否则 hover 行会和弹窗背景撞色，卡片像被咬掉一块。
             经典版式反过来：不留边距、不切圆角、分隔线通栏，一屏能多读一行 */
          <div
            className={
              settings.style === 'modern'
                ? 'mb-4 overflow-hidden rounded-card bg-surface'
                : 'bg-surface [--row-divider-inset:0px]'
            }
          >
            {visible.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                code={codes.get(account.id)?.code ?? ''}
                remaining={remainingOf(account)}
                view={settings.view}
                style={settings.style}
                showInitials={settings.showInitials}
                draggable={manual}
                dragging={dragging === account.id}
                dropEdge={
                  over && over.id === account.id && dragging !== account.id
                    ? over.after
                      ? 'bottom'
                      : 'top'
                    : null
                }
                onDragStart={setDragging}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onDrop={drop}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/** 顶部那一排小按钮：只有图标，标签走 aria-label / title */
function HeaderButton({
  label,
  onClick,
  accent,
  children,
}: {
  label: string;
  onClick: () => void;
  /** 主操作：靠颜色区分，不用填充色破坏这一排的视觉重量 */
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`rounded-[8px] p-1.5 transition-colors duration-150 hover:bg-surface-alt ${
        accent ? 'text-accent hover:text-accent-press' : 'text-fg-muted hover:text-fg'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * 搜不到：只是关键词没命中，和"一条账户都没有"是两件事。
 * 拿引导页去回答它，等于把"换个词试试"说成"你还没开始"。
 */
function NoMatchState() {
  const t = useT();
  const setQuery = useAppStore((s) => s.setQuery);
  return (
    <div className="flex flex-col items-center justify-center px-8 py-12 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-alt">
        <SearchIcon size={22} className="text-fg-muted" />
      </div>
      <p className="text-[14px] font-medium">{t('list.no-match.title')}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{t('list.no-match.body')}</p>
      <button
        type="button"
        className="mt-4 rounded-[10px] bg-surface px-4 py-2 text-[13px] font-medium text-accent transition-colors duration-150 hover:bg-row-hover"
        onClick={() => setQuery('')}
      >
        {t('list.no-match.clear')}
      </button>
    </div>
  );
}
