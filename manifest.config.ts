import { defineManifest } from '@crxjs/vite-plugin';

/**
 * MV3 manifest。
 *
 * 权限策略：**按阶段增量申请**，不要一次性写满。
 *   P0  storage                     —— 存 vault / settings
 *   V1.1 contextMenus + scripting + activeTab + sidePanel —— 右键插入、侧边栏
 *
 * 每日备份没有申请 alarms：备份只在数据真的变了时才做，交给写入路径判断，
 * 不需要一个会唤醒 SW 的定时器。
 * 申请了却用不到的权限是商店审核的高频拒因，落功能时再加。
 */
export default defineManifest({
  manifest_version: 3,
  name: '__MSG_extName__',
  description: '__MSG_extDesc__',
  version: '0.1.0',
  default_locale: 'zh_CN',
  minimum_chrome_version: '112', // storage.session.setAccessLevel 需要 112+

  icons: {
    16: 'icons/16.png',
    32: 'icons/32.png',
    48: 'icons/48.png',
    128: 'icons/128.png',
  },

  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  permissions: ['storage'],
});
