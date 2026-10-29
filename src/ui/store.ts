import { create } from 'zustand';
import type { Account, Settings } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types';
import { DEMO_ACCOUNTS } from './fixtures/demo';

export type ViewMode = 'normal' | 'compact' | 'masked';

export interface Toast {
  id: number;
  text: string;
  tone: 'normal' | 'danger';
}

interface AppState {
  accounts: Account[];
  settings: Settings;
  query: string;
  toast: Toast | null;
  /** 打码模式下临时揭示的那一行 */
  revealedId: string | null;

  setQuery: (query: string) => void;
  setView: (view: ViewMode) => void;
  reveal: (id: string | null) => void;
  showToast: (text: string, tone?: 'normal' | 'danger') => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;
let revealTimer: ReturnType<typeof setTimeout> | null = null;

/** 打码模式下临时揭示后自动收回的时长 */
export const REVEAL_MS = 5000;

export const useAppStore = create<AppState>((set) => ({
  // P2 阶段先用内存假数据，P3 换成从 vault 读
  accounts: DEMO_ACCOUNTS,
  settings: { ...DEFAULT_SETTINGS },
  query: '',
  toast: null,
  revealedId: null,

  setQuery: (query) => set({ query }),
  setView: (view) => set((s) => ({ settings: { ...s.settings, view } })),

  // 自动收回放在 store 里，不放在行组件里：谁触发揭示都只有这一个定时器，
  // 也就不会出现"组件卸载后仍残留一个 5 秒回调"的情况
  reveal: (revealedId) => {
    if (revealTimer !== null) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    set({ revealedId });
    if (revealedId !== null) {
      revealTimer = setTimeout(() => {
        revealTimer = null;
        set({ revealedId: null });
      }, REVEAL_MS);
    }
  },

  showToast: (text, tone = 'normal') => {
    toastSeq += 1;
    set({ toast: { id: toastSeq, text, tone } });
  },
  dismissToast: (id) =>
    set((s) => (s.toast && s.toast.id === id ? { toast: null } : s)),
}));

/** 排序：置顶优先，其次按设置里的排序方式 */
export function sortAccounts(accounts: readonly Account[], sortBy: Settings['sortBy']): Account[] {
  const list = [...accounts];
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortBy === 'issuer') {
      const byIssuer = a.issuer.localeCompare(b.issuer, 'zh-Hans-CN');
      if (byIssuer !== 0) return byIssuer;
    } else if (sortBy === 'name') {
      const byName = a.account.localeCompare(b.account, 'zh-Hans-CN');
      if (byName !== 0) return byName;
    }
    return a.order - b.order;
  });
  return list;
}

/** 搜索：issuer 与 account 都参与匹配，忽略大小写和空格 */
export function filterAccounts(accounts: readonly Account[], query: string): Account[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...accounts];
  return accounts.filter(
    (a) =>
      a.issuer.toLowerCase().includes(q) ||
      a.account.toLowerCase().includes(q),
  );
}
