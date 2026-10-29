import { create } from 'zustand';
import { parseOtpauth } from '@/core/otpauth';
import type { OtpAuthParams } from '@/core/otpauth';
import type { Account, Settings, Vault } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types';
import {
  addAccount as addAccountToVault,
  removeAccount as removeAccountFromVault,
  reorderAccount as reorderInVault,
  setPinned as setPinnedInVault,
  updateAccount as updateAccountInVault,
} from '@/core/vault';
import {
  changePassword as changePasswordInVault,
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
// 只借类型：值导出会形成 store → i18n → store 的运行时环。`verbatimModuleSyntax`
// 保证这行被整句擦掉，编译产物里不会留下 require。
import type { MessageKey, Vars } from './i18n';

export type ViewMode = 'normal' | 'compact' | 'masked';

/** 顶层路由只看这一个状态 */
export type Phase = 'loading' | 'empty' | 'locked' | 'unlocked';

/**
 * 覆盖在列表之上的那些界面。
 *
 * 它们都是**整屏替换**而不是浮层：弹窗高度跟着内容走，`fixed` 浮层一旦比
 * 内容高就会被裁掉且无法滚动（P3 恢复码页踩过这个坑）。
 */
export type Sheet =
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'settings' }
  // 导出入是从设置里进来的：返回时回到设置，而不是直接掉回列表
  | { kind: 'export'; from?: 'settings' }
  | { kind: 'import'; from?: 'settings' };

/** 表单最终要落成的一次写入；新增和编辑只差一个 id */
export type AccountDraft = OtpAuthParams;

/**
 * 提示条只带**键**，不带成句的文案。
 *
 * 原因很实在：一次 toast 会活过若干次渲染和一次语言切换，
 * 存成字符串的话它就是"发出那一刻"的语言，切成英文之后还挂在那儿。
 */
export interface Toast {
  id: number;
  message: MessageKey;
  vars: Vars | undefined;
  tone: 'normal' | 'danger';
}

export interface ToastOptions {
  vars?: Vars | undefined;
  tone?: 'normal' | 'danger' | undefined;
}

interface AppState {
  phase: Phase;
  vault: Vault | null;
  /** 锁屏上有没有"恢复码"这条路可走 */
  canRecover: boolean;
  /** 锁屏上的一句提示，例如「刚设置的密码，请再输一次确认」 */
  notice: MessageKey | null;
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
  /** 当前打开的整屏子界面；null 表示在列表上 */
  sheet: Sheet | null;

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

  openSheet: (sheet: Sheet) => void;
  closeSheet: () => void;
  /**
   * 退一层。头部的返回箭头和 Esc 都走这里 —— 两条路由同一个动作，
   * 就不会出现"键盘按 Esc 掉回列表、点按钮却回设置"这种分叉。
   */
  back: () => void;
  addAccount: (draft: AccountDraft) => Promise<void>;
  /** 从 `otpauth://` 地址添加；解析失败会抛 OtpAuthError */
  addAccountFromUri: (uri: string, known?: OtpAuthParams) => Promise<void>;
  saveAccount: (id: string, draft: AccountDraft) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  /** 拖拽排序：插到 `beforeId` 之前，null 表示末尾 */
  reorderAccount: (id: string, beforeId: string | null) => Promise<void>;
  /** 已解锁时换密码，返回新恢复码（需当场展示） */
  changePassword: (current: string, next: string) => Promise<string>;
  /** 导入：只做加法，返回真正新增的条数 */
  importAccounts: (drafts: readonly OtpAuthParams[]) => Promise<number>;

  setQuery: (query: string) => void;
  setView: (view: ViewMode) => void;
  reveal: (id: string | null) => void;
  showToast: (message: MessageKey, options?: ToastOptions) => void;
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
  sheet: null,

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
            notice: 'notice.confirm-new-password',
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
      notice: 'notice.password-reset',
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
      notice: 'notice.password-set',
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

  // 上锁 = 回到起点：连打开着的子界面一起收掉。
  // 留着的话，解锁后会落在一个"上一次正在做的事"上，可能已经过期了
  lockSilently: () => set({ phase: 'locked', vault: null, notice: null, sheet: null }),


  lockNow: async () => {
    await lockVault('manual');
    set({ phase: 'locked', vault: null, canRecover: get().canRecover, notice: null, sheet: null });
  },

  mutate: async (fn) => {
    const current = get().vault;
    if (!current) throw new Error('vault is locked');
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

  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),

  back: () => {
    const sheet = get().sheet;
    if (!sheet) return;
    // 导入/导出是从设置里进来的：返回时回到设置，而不是直接掉回列表
    if ((sheet.kind === 'export' || sheet.kind === 'import') && sheet.from === 'settings') {
      set({ sheet: { kind: 'settings' } });
      return;
    }
    set({ sheet: null });
  },

  addAccount: async (draft) => {
    await get().mutate((vault) => addAccountToVault(vault, draft));
    set({ sheet: null });
    get().showToast('toast.added');
  },

  addAccountFromUri: async (uri, known) => {
    // 解析放在这里（而不是调用方）：扫码、粘贴、导入三条路都走同一个入口
    const draft = known ?? parseOtpauth(uri);
    await get().addAccount(draft);
  },

  saveAccount: async (id, draft) => {
    await get().mutate((vault) =>
      updateAccountInVault(vault, id, {
        issuer: draft.issuer.trim(),
        account: draft.account.trim(),
        secret: draft.secret,
        algorithm: draft.algorithm,
        digits: draft.digits,
        period: draft.period,
      }),
    );
    set({ sheet: null });
    get().showToast('toast.saved');
  },

  deleteAccount: async (id) => {
    await get().mutate((vault) => removeAccountFromVault(vault, id));
    // 删掉的正好是临时揭示的那一行时，别留一个指向空行的状态
    set((state) => ({ sheet: null, revealedId: state.revealedId === id ? null : state.revealedId }));
    get().showToast('toast.deleted');
  },

  togglePin: async (id) => {
    const current = get().vault?.accounts.find((account) => account.id === id);
    if (!current) return;
    await get().mutate((vault) => setPinnedInVault(vault, id, !current.pinned));
  },

  reorderAccount: async (id, beforeId) => {
    await get().mutate((vault) => reorderInVault(vault, id, beforeId));
  },

  importAccounts: async (drafts) => {
    if (drafts.length === 0) return 0;
    // 整批一次落盘：中途抛错时 fn 还没返回，界面与存储都不会落到半截状态
    await get().mutate((vault) =>
      drafts.reduce((acc, draft) => addAccountToVault(acc, draft), vault),
    );
    set({ sheet: null });
    get().showToast('toast.imported', { vars: { count: drafts.length } });
    return drafts.length;
  },

  changePassword: async (current, next) => {
    const { recoveryCode } = await changePasswordInVault(current, next);
    await lockVault('manual');
    set({
      phase: 'locked',
      vault: null,
      sheet: null,
      canRecover: true,
      notice: 'notice.password-updated',
      pendingRecovery: recoveryCode,
    });
    return recoveryCode;
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

  showToast: (message, options) => {
    toastSeq += 1;
    set({ toast: { id: toastSeq, message, vars: options?.vars, tone: options?.tone ?? 'normal' } });
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

/**
 * 排序：置顶优先，其次按设置里的排序方式。
 *
 * 排序语言跟着界面语言走：英文界面里 `Zulip` 应该排在 `apple` 后面，
 * 而中文的拼音序会把两者排反。这条只影响「按网站 / 按账户」两种。
 */
export function sortAccounts(
  accounts: readonly Account[],
  sortBy: Settings['sortBy'],
  lang: 'zh' | 'en' = 'zh',
): Account[] {
  const locale = lang === 'zh' ? 'zh-Hans-CN' : 'en';
  const list = [...accounts];
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortBy === 'issuer') {
      const byIssuer = a.issuer.localeCompare(b.issuer, locale);
      if (byIssuer !== 0) return byIssuer;
    } else if (sortBy === 'name') {
      const byName = a.account.localeCompare(b.account, locale);
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
