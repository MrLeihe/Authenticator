import { useEffect, useMemo, useRef, useState } from 'react';
import type { CachedCode } from '@/core/totp-cache';
import { TotpCache } from '@/core/totp-cache';
import type { Account } from '@/core/types';
import { AccountRow } from '../components/AccountRow';
import { PlusIcon, SearchIcon, SettingsIcon } from '../components/Icons';
import { Toast } from '../components/Toast';
import { useTick } from '../hooks/useTick';
import { filterAccounts, sortAccounts, useAppStore, type ViewMode } from '../store';

const VIEWS: Array<{ value: ViewMode; label: string }> = [
  { value: 'normal', label: '正常' },
  { value: 'compact', label: '紧凑' },
  { value: 'masked', label: '隐藏' },
];

export function ListScreen() {
  const accounts = useAppStore((s) => s.accounts);
  const settings = useAppStore((s) => s.settings);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const setView = useAppStore((s) => s.setView);
  const revealedId = useAppStore((s) => s.revealedId);
  const reveal = useAppStore((s) => s.reveal);
  const showToast = useAppStore((s) => s.showToast);

  const now = useTick(250);
  const cache = useRef(new TotpCache());
  const [codes, setCodes] = useState<Map<string, CachedCode>>(new Map());

  const visible = useMemo(
    () => filterAccounts(sortAccounts(accounts, settings.sortBy), query),
    [accounts, settings.sortBy, query],
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

  const remainingOf = (account: Account): number => {
    const period = codes.get(account.id)?.period ?? account.period ?? 30;
    const seconds = Math.floor(now / 1000);
    return period - (seconds % period);
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      <header className="sticky top-0 z-10 bg-bg/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <h1 className="text-[18px] font-semibold tracking-tight">验证码</h1>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="flex rounded-[8px] bg-surface-alt p-0.5" role="group" aria-label="显示方式">
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
                  {v.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-label="设置"
              className="rounded-[8px] p-1.5 text-fg-muted transition-colors duration-150 hover:bg-surface-alt hover:text-fg"
              onClick={() => showToast('设置在 P4 接入')}
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
            placeholder="搜索账户"
            className="h-[38px] w-full rounded-[8px] bg-surface-alt pl-8 pr-3 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
          />
        </div>
      </header>

      <main className="flex-1">
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
            />
          ))
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-separator bg-bg/95 px-4 py-2 backdrop-blur">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-accent py-2.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-accent-press"
          onClick={() => showToast('添加账户在 P4 接入')}
        >
          <PlusIcon size={15} />
          添加账户
        </button>
      </footer>

      <Toast />
    </div>
  );
}

/** 空态：必须说清"为什么会这样 + 下一步点哪"，不能只留一片白 */
function EmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-14 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-alt">
        <SearchIcon size={22} className="text-fg-muted" />
      </div>
      <p className="text-[14px] font-medium">
        {searching ? '没有匹配的账户' : '还没有添加任何账户'}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
        {searching
          ? '换个关键词试试，或者清空搜索框看全部账户'
          : '点下面的「添加账户」，扫码或手动输入密钥都能加进来'}
      </p>
    </div>
  );
}
