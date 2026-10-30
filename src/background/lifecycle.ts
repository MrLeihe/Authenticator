/**
 * 安装/升级钩子。
 * 只做一件事：记录 schemaVersion 的落点，方便 P3 起做数据迁移。
 * 不弹窗、不埋点、不发任何网络请求。
 *
 * 写存储的动作交给 platform/vault-service：后台不直接碰 `chrome.storage`，
 * 也就不必知道存储键和 meta 的结构。
 */
import { initializeMeta } from '@/platform/vault-service';

export function onInstalled(details: chrome.runtime.InstalledDetails): void {
  if (details.reason === 'install') {
    void initializeMeta();
  }
}
