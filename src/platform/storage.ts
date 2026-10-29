/**
 * 唯一允许直接调用 `chrome.storage.*` 的地方。
 *
 * 两个区，用途截然不同（见 SPEC §3.6）：
 * - `local`  ：落盘。只放密文、非敏感设置、元信息。
 * - `session`：Chrome 保存在内存里，浏览器关闭即清，内容脚本默认读不到。
 *              已解锁的 DEK 只放这里，绝不放 `local`。
 *
 * 在普通标签页里预览（vite dev，没有扩展 API）时退化成内存 Map，
 * 并在控制台明确提示一次 —— 静默退化会让人误以为"数据已经存下来了"。
 */

export type StorageAreaName = 'local' | 'session';

export interface StorageAdapter {
  readonly name: StorageAreaName;
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const KEYS = {
  vault: '2fa:vault',
  /** 主包装：none / password */
  dekWrap: '2fa:dekWrap',
  /** 恢复码包装：与主包装并存，只有 kind:'password' 时才有 */
  dekWrapRecovery: '2fa:dekWrapRecovery',
  meta: '2fa:meta',
  /** session 区 */
  dek: '2fa:dek',
  unlockedAt: '2fa:unlockedAt',
} as const;

export function backupKey(date: string): string {
  return `2fa:backup:${date}`;
}

function hasChromeStorage(area: StorageAreaName): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.[area]);
}

/** 没有扩展 API 时的内存实现，仅供 vite dev 预览 */
function memoryAdapter(name: StorageAreaName): StorageAdapter {
  const map = new Map<string, unknown>();
  return {
    name,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

function chromeAdapter(name: StorageAreaName): StorageAdapter {
  const area = chrome.storage[name];
  return {
    name,
    async get<T>(key: string) {
      const result = await area.get(key);
      return result[key] as T | undefined;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
    async keys() {
      return Object.keys(await area.get(null));
    },
  };
}

let warned = false;

function create(name: StorageAreaName): StorageAdapter {
  if (hasChromeStorage(name)) return chromeAdapter(name);
  if (!warned) {
    warned = true;
    console.warn(
      `[storage] 当前不在扩展环境里，chrome.storage.${name} 不可用，` +
        '已退化为内存存储：刷新页面数据就没了。这是 dev 预览路径，不是线上行为。',
    );
  }
  return memoryAdapter(name);
}

export const local = create('local');
export const session = create('session');

/**
 * 会话区默认对"不受信任的上下文"（页面里的内容脚本、注入的 frame）也开放，
 * 而解锁后的 DEK 就放在里面。用之前先收紧到只有扩展自己的页面能读 ——
 * 放在这里而不是后台，是因为后台可能还没被唤醒，而这里两个上下文都会加载。
 *
 * 失败只警告不阻断：拿不到这一步也不该让用户打不开自己的验证码，
 * 但不静默 —— 收紧失败意味着密钥对不受信任的上下文可见。
 */
if (hasChromeStorage('session')) {
  void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch((error) => {
    console.warn('[storage] 收紧 session 访问级别失败：', error);
  });
}
