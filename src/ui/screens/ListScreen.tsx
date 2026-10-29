import { useEffect, useMemo, useRef, useState } from 'react';
import type { CachedCode } from '@/core/totp-cache';
import { TotpCache } from '@/core/totp-cache';
import type { Account } from '@/core/types';
import { AccountRow } from '../components/AccountRow';
import { PlusIcon, SearchIcon, SettingsIcon } from '../components/Icons';
import { Toast } from '../components/Toast';
import { useTick } from '../hooks/useTick';
import { useLang, useT } from '../i18n';
import type { MessageKey } from '../i18n';
import {
  filterAccounts,
  sortAccounts,
  useAccounts,
  useAppStore,
  useSettings,
  type ViewMode,
} from '../store';

const VIEWS: Array<{ value: ViewMode; label: MessageKey }> = [
  { value: 'normal', label: 'view.normal' },
  { value: 'compact', label: 'view.compact' },
  { value: 'masked', label: 'view.masked' },
];

export function ListScreen() {
  const t = useT();
  const lang = useLang();
  const accounts = useAccounts();
  const settings = useSettings();
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const setView = useAppStore((s) => s.setView);
  const revealedId = useAppStore((s) => s.revealedId);
  const reveal = useAppStore((s) => s.reveal);
  const showToast = useAppStore((s) => s.showToast);
  const openSheet = useAppStore((s) => s.openSheet);
  const reorderAccount = useAppStore((s) => s.reorderAccount);

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

  const remainingOf = (account: Account): number => {
    const period = codes.get(account.id)?.period ?? account.period ?? 30;
    const seconds = Math.floor(now / 1000);
    return period - (seconds % period);
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      <header className="sticky top-0 z-10 bg-bg/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <h1 className="text-[18px] font-semibold tracking-tight">{t('app.name')}</h1>

          <div className="ml-auto flex items-center gap-1.5">
            <div
              className="flex rounded-[8px] bg-surface-alt p-0.5"
              role="group"
              aria-label={t('list.view-group')}
            >
              {VIEWS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  aria-pressed={settings.view === v.value}
                  className={`rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors duration-150 ${
                    settings.view === v.value
                      ? 'bg-surface text-fg shadow-sm'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                  onClick={() => setView(v.value)}
                >
                  {t(v.label)}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-label={t('settings.title')}
              className="rounded-[8px] p-1.5 text-fg-muted transition-colors duration-150 hover:bg-surface-alt hover:text-fg"
              onClick={() => openSheet({ kind: 'settings' })}
            >
              <SettingsIcon size={17} />
            </button>
          </div>
        </div>

        <div className="relative mt-2">
          <SearchIcon
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('list.search')}
            className="h-[38px] w-full rounded-[8px] bg-surface-alt pl-8 pr-3 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
          />
        </div>
      </header>

      <main
        className="flex-1"
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
          <EmptyState searching={query.trim().length > 0} />
        ) : (
          visible.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              code={codes.get(account.id)?.code ?? ''}
              remaining={remainingOf(account)}
              view={settings.view}
              showInitials={settings.showInitials}
              revealed={revealedId === account.id}
              onReveal={reveal}
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
          ))
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-separator bg-bg/95 px-4 py-2 backdrop-blur">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-accent py-2.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-accent-press"
          onClick={() => openSheet({ kind: 'add' })}
        >
          <PlusIcon size={15} />
          {t('list.add')}
        </button>
      </footer>

      <Toast />
    </div>
  );
}

/** 空态：必须说清"为什么会这样 + 下一步点哪"，不能只留一片白 */
function EmptyState({ searching }: { searching: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center px-8 py-14 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-alt">
        <SearchIcon size={22} className="text-fg-muted" />
      </div>
      <p className="text-[14px] font-medium">
        {searching ? t('list.no-match.title') : t('list.empty.title')}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
        {searching ? t('list.no-match.body') : t('list.empty.body')}
      </p>
    </div>
  );
}
