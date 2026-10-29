/**
 * Service Worker。
 *
 * 纪律：**不持有任何状态、不做计时**。
 * MV3 的 SW 会在空闲约 30 秒后被回收，任何内存状态都会静默丢失。
 * 这里只注册事件监听，真正的计算和倒计时都在 UI 层。
 *
 * P3 的每日备份**不用 alarms**：备份只在数据真的变了的那天做一次，
 * 没有改动就不该产出一份内容相同的快照。所以由写入路径自己判断
 * （见 vault-service.maybeBackup），SW 里不需要定时器。
 *
 * `storage.session` 的访问级别由 platform/storage.ts 在模块加载时收紧。
 *
 * 后续阶段会在这里挂：
 *   V1.1  contextMenus   —— 右键「插入验证码」
 */
import { onInstalled } from './lifecycle';

chrome.runtime.onInstalled.addListener(onInstalled);
