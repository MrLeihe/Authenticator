# 隐私政策 · Privacy Policy

**Sixring - 两步验证器**（Chrome 扩展，以下简称"本扩展"）

最后更新：2026-10-30

---

## 一句话

本扩展不联网、不收集、不上报。你的密钥只存在你自己的浏览器里。

## 1. 我们不收集任何数据

本扩展没有服务器，没有分析、埋点、崩溃上报或任何形式的遥测。它不申请网络相关的权限，也不存在第三方 SDK。代码全部打包在扩展内，不加载任何远程代码，没有 `eval`。

## 2. 数据存在哪里

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 账户（名称、站点、密钥、算法、位数、周期） | `chrome.storage.local` | 始终以密文形式保存（AES-256-GCM） |
| 保险库密钥（DEK） | `chrome.storage.local`，被密码 / 恢复码包住 | 开启密码保护后，没有密码无法解开 |
| 解锁后的会话密钥 | `chrome.storage.session` | 只对扩展自身页面可读，关闭浏览器即消失 |
| 每日自动备份（最多 7 份） | `chrome.storage.local` | 同样是密文 |

**不存的东西**：不存你的 Google 账号、不存你登录了哪些网站、不读取任何标签页内容（§4 里那一张临时截图除外，它只经过内存）、不记录剪贴板历史。

## 3. 需要主动披露的一件事

开启密码保护后，解锁状态与解密后的密钥会短暂保存在 `chrome.storage.session` 里，这样关闭再打开弹窗不必每次输密码。这是**内存态**：会话密钥在浏览器重启后消失；闲置到设定的时间（默认 5 分钟）且窗口关闭后自动上锁，密钥从内存中清除。

也就是说：**只要浏览器进程还在运行且保险库处于解锁状态，能运行扩展页面的人就能读到解密后的密钥。** 这是所有本地验证器的共同前提，我们选择把它写在明面上，而不是藏在文档角落。

## 4. 权限与用途

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存加密后的保险库、设置与自动备份。 |
| `activeTab` | 只用于「扫描此页面上的二维码」：你在某个网页上点开扩展、并主动按下这个按钮时，扩展会截取当前标签页的一张画面，在本机识别其中的二维码。它**不会常驻**：授权只在你点开扩展的那一刻对当前这一个标签页有效，扩展读不到其他标签页、也读不到浏览历史。 |

截图只存在于内存中，用于本地解码，**不写入磁盘、不上传、识别结束即丢弃**。不按那个按钮就不会截任何东西。

本扩展不申请 `host_permissions`，因此没有对任何网站的常驻访问权，也不会知道你平时在访问什么。

## 5. 剪贴板

点击账户行会把当前验证码写入剪贴板。按设置可以在若干秒后自动清空剪贴板（默认开启）。是否写入剪贴板完全由你的点击触发，扩展不会读取剪贴板内容。

## 6. 导出与导入

导出功能由你主动触发，文件通过浏览器的普通下载保存到你选择的目录。加密导出使用你当场输入的导出密码；明文导出会在界面上明确警告。**扩展不会把任何数据发送出去**——导出的文件在你自己手里，请像对待密码一样对待它。

## 7. 儿童隐私

本扩展不收集任何人的信息，自然也不收集儿童的信息。

## 8. 政策变更

本政策若变更，会同步更新本文档顶部的"最后更新"日期，并在仓库的提交记录里留下痕迹。

## 9. 联系方式

通过 [GitHub 仓库](https://github.com/MrLeihe/Authenticator) 的 Issues 反馈。请勿在 Issue 里粘贴任何真实的密钥或验证码。

---

# Privacy Policy (English)

**Sixring - TOTP Authenticator** (the Chrome extension, "the extension")

Last updated: 2026-10-30

## The short version

No network. No collection. No reporting. Your secrets stay in your own browser.

## 1. We collect nothing

There is no server, no analytics, no crash reporting and no telemetry of any kind, and no third-party SDKs. All code ships inside the package; nothing is fetched remotely, and there is no `eval`.

## 2. Where data lives

| Data | Location | Notes |
| --- | --- | --- |
| Accounts (label, issuer, secret, algorithm, digits, period) | `chrome.storage.local` | Always stored encrypted (AES-256-GCM) |
| Vault key (DEK) | `chrome.storage.local`, wrapped by your password / recovery code | With password protection on, nothing opens it without the password |
| Unlocked session key | `chrome.storage.session` | Readable only by the extension's own pages; gone when the browser closes |
| Daily automatic backups (up to 7) | `chrome.storage.local` | Also encrypted |

**Not stored**: your Google account, which sites you sign in to, the contents of any tab, or your clipboard history. The one screen capture described in §4 never touches disk.

## 3. One thing we disclose up front

With password protection on, the unlock state and the unwrapped key are kept briefly in `chrome.storage.session` so reopening the popup does not ask for the password every time. This is memory-only state: it disappears when the browser exits, and the vault re-locks (wiping the key from memory) after the idle timeout you configure (5 minutes by default) once the window is closed.

In other words: **while the browser process is running and the vault is unlocked, anyone who can run the extension's pages can read the decrypted secrets.** Every local authenticator has this property. We would rather say it plainly than bury it.

## 4. Permissions and why

| Permission | Why |
| --- | --- |
| `storage` | To save the encrypted vault, settings and automatic backups. |
| `activeTab` | Only for "Scan this page": when you open the extension on a web page and press that button, it captures one frame of the current tab and reads the QR code in it locally. The grant is **not persistent** — it applies to that single tab, only from the moment you opened the extension. The extension cannot read other tabs or your browsing history. |

The capture stays in memory for decoding only: **never written to disk, never uploaded, discarded as soon as decoding finishes.** Nothing is captured unless you press that button.

No `host_permissions` are requested, so the extension has no standing access to any website, and never learns what you visit.

## 5. Clipboard

Clicking an account row copies the current code to the clipboard. Depending on your setting, the clipboard is cleared again a few seconds later (on by default). Clipboard writes happen only when you click; the extension never reads clipboard contents.

## 6. Export and import

Exports are started by you and saved through the browser's normal download flow into a folder you choose. Encrypted exports use the export password you type at that moment; plaintext export is explicitly labelled as such in the UI. **The extension never sends your data anywhere** — the exported file is in your hands, so treat it like a password.

## 7. Children's privacy

The extension collects nobody's data, including children's.

## 8. Changes

If this policy changes, the date above is updated and the change is visible in the repository's commit history.

## 9. Contact

Use the Issues tab of the [GitHub repository](https://github.com/MrLeihe/Authenticator). Please never paste a real secret or code into an issue.
