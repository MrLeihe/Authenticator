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
  /**
   * 所属分组。**V1.0 没有任何界面入口**，写入时一律为 `null`。
   *
   * 字段与下面的 `Vault.groups` 是给 V1.1 的分组功能预留的：schema 一旦发出去
   * 就只能加不能改，等有界面时再补字段，老数据的迁移成本会比现在留一个空字段高。
   * 所以 `normalizeVault` 仍然替它维护"指向不存在的分组就清空"这条不变量 ——
   * 这不是死代码在收税，而是**为了将来能安全落地的定金**。
   */
  groupId: string | null;
  createdAt: number;
  /**
   * 进入「最近删除」的时间戳（毫秒）。只在 trash 里的账户上有值。
   * 软删除不真删，靠这个字段算 30 天清理期限 —— 见 SPEC「最近删除」。
   */
  archivedAt?: number;
}

export interface Group {
  id: string;
  name: string;
  order: number;
}

export type ClipboardClear = 0 | 15 | 30 | 60;

/** 列表版式：`modern` 卡片化大环，`classic` 贴边通铺小环 */
export type UiStyle = 'classic' | 'modern';

export interface Settings {
  autoLockMinutes: 0 | 5 | 30 | 120;
  clipboardClearSeconds: ClipboardClear;
  theme: 'system' | 'light' | 'dark';
  /** `system` 跟随浏览器语言，写盘时收敛成 `zh` / `en` */
  language: 'system' | 'zh' | 'en';
  sortBy: 'manual' | 'issuer' | 'name';
  /**
   * 列表的版式风格。
   * - `modern`：白卡浮在灰底上、行更高、环更大 —— 默认，也是"更精致"的那一版
   * - `classic`：贴边通铺、行更紧、环更小，一屏能多塞两三个账户
   */
  style: UiStyle;
  view: 'normal' | 'compact';
  /**
   * 账户名前的首字母色块。
   * 默认关闭：那枚色块占掉 24px 宽度，而它承载的信息（来自 issuer 的首字母）
   * 账户名本身已经写了。开着是"更好看"，不是"更好用"，所以让人自己开。
   */
  showInitials: boolean;
  autoBackup: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 30,
  clipboardClearSeconds: 30,
  // 默认浅色，不跟系统。这个产品的第一印象是"像 iOS 设置页"，
  // 浅色下那套 systemGray 层次才是设计想让人看到的样子；深色留给用户自己选。
  // 只影响新建的库 —— 用户选过的值存在加密的 vault 里，不会被这一行覆盖
  theme: 'light',
  language: 'system',
  sortBy: 'manual',
  // 默认现代：卡片 + 大环那一版是设计想让人看到的样子，经典版留给"就想一屏看完"的老用户
  style: 'modern',
  view: 'normal',
  showInitials: false,
  autoBackup: true,
};

export interface Vault {
  version: 1;
  accounts: Account[];
  /** 「最近删除」：软删除的账户，30 天后惰性清除。与 accounts 物理隔离 */
  trash: Account[];
  /** 分组。**V1.0 恒为空数组**，没有界面入口 —— 保留原因见 `Account.groupId` */
  groups: Group[];
  settings: Settings;
}
