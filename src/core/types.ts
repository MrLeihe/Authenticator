/** 支持的 HMAC 摘要算法。TOTP 只做这三种，不做 MD5。 */
export type Algorithm = 'SHA1' | 'SHA256' | 'SHA512';

/** 一个账户。`secret` 是 base32 大写无填充，只存在于解密后的内存里。 */
export interface Account {
  id: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: Algorithm;
  digits: 6 | 8;
  period: number;
  /** 稀疏排序值，间隔 1024，见 SPEC §3.4 */
  order: number;
  pinned: boolean;
  groupId: string | null;
  createdAt: number;
}

export interface Group {
  id: string;
  name: string;
  order: number;
}

export type ClipboardClear = 0 | 15 | 30 | 60;

export interface Settings {
  autoLockMinutes: 0 | 5 | 30 | 120;
  clipboardClearSeconds: ClipboardClear;
  theme: 'system' | 'light' | 'dark';
  /** `system` 跟随浏览器语言，写盘时收敛成 `zh` / `en` */
  language: 'system' | 'zh' | 'en';
  sortBy: 'manual' | 'issuer' | 'name';
  view: 'normal' | 'compact';
  showInitials: boolean;
  openMode: 'popup' | 'window' | 'sidepanel';
  popupSize: 'sm' | 'md' | 'lg';
  autoBackup: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 30,
  clipboardClearSeconds: 30,
  theme: 'system',
  language: 'system',
  sortBy: 'manual',
  view: 'normal',
  showInitials: true,
  openMode: 'popup',
  popupSize: 'md',
  autoBackup: true,
};

export interface Vault {
  version: 1;
  accounts: Account[];
  groups: Group[];
  settings: Settings;
}

export const emptyVault = (): Vault => ({
  version: 1,
  accounts: [],
  groups: [],
  settings: { ...DEFAULT_SETTINGS },
});
