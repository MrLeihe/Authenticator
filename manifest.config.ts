import { defineManifest } from '@crxjs/vite-plugin';

/**
 * MV3 manifest。
 *
 * 权限策略：**按阶段增量申请**，不要一次性写满。
 *   P0  storage                     —— 存 vault / settings
 *   V1.0 activeTab                  —— 「扫描此页面上的二维码」：用户点扩展图标那一刻
 *                                      授予、只对当时那个标签页有效，读不到别的页面。
 *                                      没有它就只能让用户自己截图再粘贴回来
 *   V1.1 contextMenus + scripting + sidePanel —— 右键插入、侧边栏
 *
 * 每日备份没有申请 alarms：备份只在数据真的变了时才做，交给写入路径判断，
 * 不需要一个会唤醒 SW 的定时器。
 * 申请了却用不到的权限是商店审核的高频拒因，落功能时再加。
 */
export default defineManifest({
  manifest_version: 3,
  name: '__MSG_extName__',
  description: '__MSG_extDesc__',
  version: '1.0.0',
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

  permissions: ['storage', 'activeTab'],
});
