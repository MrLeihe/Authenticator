import { useMemo } from 'react';
import { create } from 'zustand';
import { parseOtpauth } from '@/core/otpauth';
import type { OtpAuthParams } from '@/core/otpauth';
import type { Account, Settings, Vault } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types';
import {
  addAccount as addAccountToVault,
  expireTrash,
  purgeTrashed,
  removeAccount as removeAccountFromVault,
  reorderAccount as reorderInVault,
  restoreTrashed as restoreTrashedInVault,
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
  restoreLatestBackup,
  saveVault,
  touchUnlocked,
  unlockWithPassword as unlockVaultWithPassword,
} from '@/platform/vault-service';
import { DEMO_ACCOUNTS } from './fixtures/demo';
// 只借类型：值导出会形成 store → i18n → store 的运行时环。`verbatimModuleSyntax`
// 保证这行被整句擦掉，编译产物里不会留下 require。
import type { MessageKey, Vars } from './i18n';

export type ViewMode = 'normal' | 'compact';

/**
 * 顶层路由只看这一个状态。
 *
 * 没有 `empty`（"还没建库"）：首次启动时 `hydrate` 直接建一个免密的库并落到
 * `unlocked`，用户打开扩展看到的就是列表（空列表有自己的引导）。少一屏
 * "先设个密码"的拦截，也少一个"建库失败卡在中间态"的入口。
 */
export type Phase = 'loading' | 'locked' | 'unlocked';

/**
 * 覆盖在列表之上的那些界面。
 *
 * 它们都是**整屏替换**而不是浮层：弹窗高度跟着内容走，`fixed` 浮层一旦比
 * 内容高就会被裁掉且无法滚动（P3 恢复码页踩过这个坑）。
 */
export type Sheet =
  /** `mode` 决定进去先落在哪一栏：从空态的三张卡进来时已经知道用户手上是什么 */
  | { kind: 'add'; mode?: 'manual' | 'scan'; autoscan?: boolean }
  | { kind: 'guide'; guide: GuideId }
  | { kind: 'edit'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'trash' }
  | { kind: 'settings' }
  // 导出入是从设置里进来的：返回时回到设置，而不是直接掉回列表
  | { kind: 'export'; from?: 'settings' }
  /**
   * `text` 是"已经拿到内容、只差让用户确认"的情况：扫码或粘贴到一份
   * Google Authenticator 迁移码时，这里带着原文跳过来，直接进预览 ——
   * 让用户重新把同一张图选一遍，等于否认他刚才做的那一步。
   */
  | { kind: 'import'; from?: 'settings'; text?: string };

/** 空态那几张卡片点进去的说明页。三页共用一套模板，见 `GuideScreen` */
export type GuideId = 'setup' | 'phone' | 'secret' | 'rescue';

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
  /** 当前打开的整屏子界面；null 表示在列表上 */
  sheet: Sheet | null;

  hydrate: () => Promise<void>;
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
  /** 从「最近删除」恢复一条账户，返回是否发生了同名冲突 */
  restoreTrashed: (id: string) => Promise<boolean>;
  /** 从「最近删除」彻底删除一条 */
  purgeTrashed: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  /** 拖拽排序：插到 `beforeId` 之前，null 表示末尾 */
  reorderAccount: (id: string, beforeId: string | null) => Promise<void>;
  /** 已解锁时换密码，返回新恢复码（需当场展示） */
  changePassword: (current: string, next: string) => Promise<string>;
  /** 导入：只做加法，返回真正新增的条数 */
  importAccounts: (drafts: readonly OtpAuthParams[]) => Promise<number>;
  /**
   * 从最近一份本机快照恢复，返回补回来的条数。
   * 0 表示备份里没有当前列表缺的账户 —— 这不是错误，只是没什么可做的
   */
  restoreBackup: () => Promise<number>;

  setQuery: (query: string) => void;
  setView: (view: ViewMode) => void;
  showToast: (message: MessageKey, options?: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

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
  sheet: null,

  hydrate: async () => {
    const status = await resolveStatus(DEFAULT_SETTINGS.autoLockMinutes);
    if (status.kind === 'empty') {
      // 首次启动：直接建一个免密的库。加密照常（DEK 存在 session 区），
      // 只是不包密码 —— 用户想要锁，去设置里开，那里本来就有完整的三态面板
      const { vault } = await initializeVault();
      set({
        phase: 'unlocked',
        vault: await maybeSeedDemo(vault),
        canRecover: false,
        notice: null,
      });
      return;
    }
    if (status.kind === 'locked') {
      set({ phase: 'locked', vault: null, canRecover: status.canRecover });
      return;
    }
    // 冷启动时顺手清理「最近删除」里过期的账户。惰性清理：不依赖后台定时器，
    // 只在这一下检查。清理通常无事发生，只有真删了才多写一次盘。
    const vault = expireTrash(status.vault);
    if (vault !== status.vault) await saveVault(vault);
    set({
      phase: 'unlocked',
      vault: await maybeSeedDemo(vault),
      canRecover: status.canRecover,
    });
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
    // 每天第一次改动顺手留一份备份（同一天不会重复）。
    // 必须真看这个开关：不看的话设置里"每天自动备份"那一项就是个点了没反应的假开关，
    // 而"我以为已经关了、它其实每天都在写盘"是最不该被误判的一类状态。
    // 关掉之后不再产新快照，已经写过的旧快照保持原样 —— 关开关不该等于删备份
    if (next.settings.autoBackup) await maybeBackup(next);
  },

  setSettings: async (patch) => {
    await get().mutate((vault) => ({ ...vault, settings: { ...vault.settings, ...patch } }));
  },

  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),

  back: () => {
    const sheet = get().sheet;
    if (!sheet) return;
    // 导入/导出/最近删除都是从设置里进来的：返回时回到设置，而不是直接掉回列表
    if (
      sheet.kind === 'trash' ||
      ((sheet.kind === 'export' || sheet.kind === 'import') && sheet.from === 'settings')
    ) {
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
    set({ sheet: null });
    get().showToast('toast.trashed');
  },

  restoreTrashed: async (id) => {
    const current = get().vault;
    if (!current) return false;
    const target = current.trash.find((account) => account.id === id);
    if (!target) return false;
    // 同名冲突：恢复回去会和列表里某条撞名（密钥不同）。不拦，只上报给界面提示。
    // 口径与 backup.ts 的 labelKey 一致：trim + 小写
    const collides = current.accounts.some(
      (account) =>
        account.issuer.trim().toLowerCase() === target.issuer.trim().toLowerCase() &&
        account.account.trim().toLowerCase() === target.account.trim().toLowerCase(),
    );
    await get().mutate((vault) => restoreTrashedInVault(vault, id));
    // 不关页：最近删除里常有多条要连续恢复，关掉会打断操作。留在原地，
    // 列表随 vault 变化自动刷新，这一条会从 trash 里消失。
    if (collides) get().showToast('toast.restored-trash-collide', { tone: 'danger' });
    else get().showToast('toast.restored-trash');
    return collides;
  },

  purgeTrashed: async (id) => {
    await get().mutate((vault) => purgeTrashed(vault, id));
    // 同样不关页，方便连续清理
    get().showToast('toast.purged');
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

  restoreBackup: async () => {
    // 不走 `mutate`：恢复写进去的是"昨天的自己"，让它顺手覆盖今天那份快照
    // 等于用旧数据顶掉新数据，真出事时反而少了一层可退的地方
    let result;
    try {
      result = await restoreLatestBackup();
    } catch {
      get().showToast('toast.restore-failed', { tone: 'danger' });
      return 0;
    }
    if (!result) {
      get().showToast('toast.restore-none');
      return 0;
    }
    set({ vault: result.vault });
    get().showToast('toast.restored', { vars: { count: result.added } });
    return result.added;
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

/**
 * 「最近删除」里的账户，按删除时间倒序（最近删的在前）。
 *
 * 必须分两步：先选出 `vault.trash` 本身（引用稳定，只在库变更时才变），
 * 再用 `useMemo` 排序。直接 `[...].sort()` 会在每次选值都造一个新数组，
 * zustand 用 `Object.is` 比较新旧选值，永远判定"变了"→ 无限重渲染
 * （设置页一打开就触发 "Maximum update depth exceeded"）。
 */
export function useTrash(): readonly Account[] {
  const trash = useAppStore((s) => s.vault?.trash ?? NO_ACCOUNTS);
  return useMemo(
    () => [...trash].sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [trash],
  );
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
