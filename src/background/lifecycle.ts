/**
 * 安装/升级钩子。
 * 只做一件事：记录 schemaVersion 的落点，方便 P3 起做数据迁移。
 * 不弹窗、不埋点、不发任何网络请求。
 */
export function onInstalled(details: chrome.runtime.InstalledDetails): void {
  if (details.reason === 'install') {
    void chrome.storage.local.set({
      '2fa:meta': {
        createdAt: Date.now(),
        schemaVersion: 1,
        lastBackupDate: null,
      },
    });
  }
}
