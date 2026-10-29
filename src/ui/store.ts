import { create } from 'zustand';
import type { Account, Settings, Vault } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types';
import {
  disablePassword,
  enablePassword,
  initializeVault,
  lock as lockVault,
  maybeBackup,
  resetPasswordWithRecovery,
  resolveStatus,
  saveVault,
  touchUnlocked,
  unlockWithPassword as unlockVaultWithPassword,
} from '@/platform/vault-service';
import { DEMO_ACCOUNTS } from './fixtures/demo';

export type ViewMode = 'normal' | 'compact' | 'masked';

/** 顶层路由只看这一个状态 */
export type Phase = 'loading' | 'empty' | 'locked' | 'unlocked';

export interface Toast {
  id: number;
  text: string;
  tone: 'normal' | 'danger';
}

interface AppState {
  phase: Phase;
  vault: Vault | null;
  /** 锁屏上有没有"恢复码"这条路可走 */
  canRecover: boolean;
  /** 锁屏上的一句提示，例如「刚设置的密码，请再输一次确认」 */
  notice: string | null;
  /**
   * 待展示的恢复码。放在顶层而不是某个界面里：
   * 生成恢复码的同时状态已经切到"已上锁"，界面会被换掉，
   * 只有 App 这一层还活着，能把它盖在最上面。
   */
  pendingRecovery: string | null;
  clearPendingRecovery: () => void;

  query: string;
  toast: Toast | null;
  /** 打码模式下临时揭示的那一行 */
  revealedId: string | null;

  hydrate: () => Promise<void>;
  /** 首次创建；给了密码返回恢复码（需立刻展示一次） */
  createVault: (password?: string) => Promise<string | null>;
  unlockWithPassword: (password: string) => Promise<void>;
  /** 用恢复码进来并当场换掉密码，返回新恢复码 */
  recoverWithCode: (code: string, newPassword: string) => Promise<string>;
  /** 在设置里开启密码保护，返回恢复码 */
  setPassword: (password: string) => Promise<string>;
  /** 关闭密码保护，需要当前密码 */
  clearPassword: (password: string) => Promise<void>;
  lockNow: () => Promise<void>;
  /** 巡检发现超时：服务层已经清掉会话，这里只把界面切过去 */
  lockSilently: () => void;

  /** 所有数据改动都从这里走：先落盘成功，再更新界面 */
  mutate: (fn: (vault: Vault) => Vault) => Promise<void>;
  setSettings: (patch: Partial<Settings>) => Promise<void>;

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

/**
 * 没有保险库时返回的稳定空值。
 * 用同一个常量而不是每次 `[]`，否则 zustand 每次选出来的都是新数组，会一直重渲染。
 */
const NO_ACCOUNTS: readonly Account[] = [];

export const useAppStore = create<AppState>((set, get) => ({
  phase: 'loading',
  vault: null,
  canRecover: false,
  notice: null,
  pendingRecovery: null,
  query: '',
  toast: null,
  revealedId: null,

  hydrate: async () => {
    const status = await resolveStatus(DEFAULT_SETTINGS.autoLockMinutes);
    if (status.kind === 'empty') {
      set({ phase: 'empty', vault: null, canRecover: false });
      return;
    }
    if (status.kind === 'locked') {
      set({ phase: 'locked', vault: null, canRecover: status.canRecover });
      return;
    }
    set({
      phase: 'unlocked',
      vault: await maybeSeedDemo(status.vault),
      canRecover: status.canRecover,
    });
  },

  createVault: async (password) => {
    const { vault, recoveryCode } = await initializeVault(password);
    // 设了密码就必须马上再解锁一次：密码记错要当场发现，不能等下次重启
    set(
      password
        ? {
            phase: 'locked',
            vault: null,
            canRecover: true,
            notice: '请再输入一次刚设置的密码确认',
            pendingRecovery: recoveryCode,
          }
        : { phase: 'unlocked', vault: await maybeSeedDemo(vault), canRecover: false, notice: null },
    );
    return recoveryCode;
  },

  unlockWithPassword: async (password) => {
    const vault = await unlockVaultWithPassword(password);
    // 能用密码解开就说明主包装是 password，恢复码包装必然同时存在
    set({ phase: 'unlocked', vault, notice: null, canRecover: true });
  },

  recoverWithCode: async (code, newPassword) => {
    const { recoveryCode } = await resetPasswordWithRecovery(code, newPassword);
    // 重置后会话已清，让用户用新密码进来
    set({
      phase: 'locked',
      vault: null,
      canRecover: true,
      notice: '密码已重设，请用新密码解锁',
      pendingRecovery: recoveryCode,
    });
    return recoveryCode;
  },

  setPassword: async (password) => {
    const { recoveryCode } = await enablePassword(password);
    set({
      phase: 'locked',
      vault: null,
      canRecover: true,
      notice: '请用新密码解锁',
      pendingRecovery: recoveryCode,
    });
    return recoveryCode;
  },

  clearPassword: async (password) => {
    // disablePassword 内部会验密码，验过就顺势解锁，这里直接接住它的返回值
    const vault = await disablePassword(password);
    set({ phase: 'unlocked', vault, canRecover: false, notice: null });
  },

  clearPendingRecovery: () => set({ pendingRecovery: null }),

  lockSilently: () => set({ phase: 'locked', vault: null, notice: null }),


  lockNow: async () => {
    await lockVault('manual');
    set({ phase: 'locked', vault: null, canRecover: get().canRecover, notice: null });
  },

  mutate: async (fn) => {
    const current = get().vault;
    if (!current) throw new Error('还没解锁，不能改数据');
    const next = fn(current);
    set({ vault: next });
    try {
      await saveVault(next);
    } catch (error) {
      // 落盘失败就把界面退回去，别让人以为已经存下了
      set({ vault: current });
      throw error;
    }
    // 每天第一次改动顺手留一份备份（同一天不会重复）
    await maybeBackup(next);
  },

  setSettings: async (patch) => {
    await get().mutate((vault) => ({ ...vault, settings: { ...vault.settings, ...patch } }));
  },

  setQuery: (query) => set({ query }),
  setView: (view) => {
    void get().setSettings({ view });
  },

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
  dismissToast: (id) => set((s) => (s.toast && s.toast.id === id ? { toast: null } : s)),
}));

/**
 * dev 预览用的假数据：只在开发构建 + URL 带 `?demo` 时，把示例账户塞进
 * 空保险库里看一眼列表。生产构建里 `import.meta.env.DEV` 是常量 false，
 * 这段连同 fixtures 一起被摇掉，不会有一条真实数据写进用户存储。
 */
async function maybeSeedDemo(vault: Vault): Promise<Vault> {
  if (!import.meta.env.DEV) return vault;
  if (vault.accounts.length > 0) return vault;
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('demo')) {
    return vault;
  }
  const seeded: Vault = { ...vault, accounts: DEMO_ACCOUNTS.map((a) => ({ ...a })) };
  await saveVault(seeded);
  return seeded;
}

/** 界面读账户一律走这里，避免各处自己写 `vault?.accounts ?? []` */
export function useAccounts(): readonly Account[] {
  return useAppStore((s) => s.vault?.accounts ?? NO_ACCOUNTS);
}

/** 设置同理。默认值常量是稳定的，不会引起额外渲染 */
export function useSettings(): Settings {
  return useAppStore((s) => s.vault?.settings ?? DEFAULT_SETTINGS);
}

/** 把"用户有动作"翻译成"刷新解锁时间点"，由 useAutoLock 节流调用 */
export { touchUnlocked };

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
    (a) => a.issuer.toLowerCase().includes(q) || a.account.toLowerCase().includes(q),
  );
}
