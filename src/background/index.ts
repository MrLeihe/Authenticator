/**
 * Service Worker。
 *
 * 纪律：**不持有任何状态、不做计时**。
 * MV3 的 SW 会在空闲约 30 秒后被回收，任何内存状态都会静默丢失。
 * 这里只注册事件监听，真正的计算和倒计时都在 UI 层。
 *
 * 后续阶段会在这里挂：
 *   P3    chrome.alarms  —— 每日自动备份
 *   V1.1  contextMenus   —— 右键「插入验证码」
 */
import { onInstalled } from './lifecycle';

chrome.runtime.onInstalled.addListener(onInstalled);
