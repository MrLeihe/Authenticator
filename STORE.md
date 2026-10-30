# Chrome Web Store 上架材料

本文件是"照着填就能提交"的清单。所有素材都在仓库里，路径见每节。

- 名称：**Sixring - 两步验证器** / **Sixring - TOTP Authenticator**（`public/_locales/`）
- 版本：`1.0.0`
- 类目：生产力工具（Productivity）
- 语言：中文（简体）、English

> ⚠️ **上架前必须自己再做一次重名与商标检索**（Chrome Web Store 内搜索 `Sixring`、USPTO/EUIPO 商标库、`sixring.com` 之类域名）。本仓库里的名字是候选，检索结论以你查到的为准。

---

## 1. 单一用途（Single purpose）

> 生成基于时间的两步验证码（TOTP）。

就这一句，不要写"还能备份、还能导入、还能右键插入"。备份与导入是"保管你自己已经有的验证码"的必要延伸，属于同一用途；**不要**在描述里出现密码管理、书签、标签页整理这类词。

## 2. 权限理由（每个权限一行，后台表单逐条填）

| 权限 | 后台填写的说明（中文） | English |
| --- | --- | --- |
| `storage` | 保存加密后的账户密钥、设置与自动备份。数据只在本机，不上传。 | Stores the encrypted account secrets, settings and automatic backups on this device only. Nothing is uploaded. |

V1.1 若加上右键插入，再补 `contextMenus` / `scripting` / `activeTab` 三行；**现在一条都不申请**。

- 无 `host_permissions`（这是过审的关键差异点，可以在备注里主动写明）
- 无远程代码、无 `eval`、无 CDN
- 无 `alarms`：备份由写入路径触发，不需要定时唤醒 service worker

## 3. 商店描述

### 中文（简体）

**短描述（≤132 字符）**

> 在本机生成两步验证码。不联网、无账号、无内购。密钥加密保存在你自己的浏览器里。

**详细描述**

> **它能做什么**
>
> - 粘贴 `otpauth://` 地址、扫二维码截图，或从别的验证器导入，把你的两步验证账户搬进来
> - 一屏看完所有验证码，点一下就复制，倒计时环告诉你还剩几秒
> - 两种视图：正常、紧凑（一屏放更多）；顶部一个按钮就能切明暗主题
> - 搜索、置顶、拖拽排序
>
> **数据只在你手里**
>
> - 不联网、无账号、无遥测、无内购。扩展只申请了 `storage` 一个权限，没有网站访问权限
> - 密钥始终以密文（AES-256-GCM）保存；可以设置主密码，也可以不设
> - 忘记主密码时用恢复码找回；每天自动留一份加密备份（最多 7 份）
> - 导出加密备份，或导出明文文本搬到别的验证器
>
> **它不做什么**
>
> 不做密码管理，不同步到云端，不读取你的浏览记录，也不知道你登录了哪些网站。这是一个老实的两步验证码工具。

### English

**Short description (≤132 chars)**

> Generates two-factor codes on your device. No network, no account, no in-app purchases. Secrets stay encrypted in your browser.

**Detailed description**

> **What it does**
>
> - Bring your accounts in by pasting an `otpauth://` URI, scanning a QR screenshot, or importing from another authenticator
> - See every code at a glance, click to copy, and watch the countdown ring for what is left
> - Two views: normal and compact (more accounts per screen); one button in the header flips light/dark
> - Search, pin and drag to reorder
>
> **Your data stays with you**
>
> - No network, no account, no telemetry, no in-app purchases. The only permission requested is `storage`; there is no access to any website
> - Secrets are always stored encrypted (AES-256-GCM). Password protection is optional
> - A recovery code gets you back in if you forget the password; an encrypted backup is kept daily (up to 7 copies)
> - Export an encrypted backup, or plaintext URIs to move to another authenticator
>
> **What it does not do**
>
> It is not a password manager. It does not sync to a cloud, read your browsing history, or know which sites you sign in to. It generates two-factor codes, and that is all.

## 4. 图片素材

| 素材 | 规格 | 文件 |
| --- | --- | --- |
| 商店图标 | 128×128 PNG | `public/icons/128.png` |
| 截图 1 · 列表 | 1280×800 PNG | `store/screenshot-1-list.png` |
| 截图 2 · 暗色 | 1280×800 PNG | `store/screenshot-2-dark.png` |
| 截图 3 · 扫码 | 1280×800 PNG | `store/screenshot-3-scan.png` |
| 截图 4 · 加密引导 | 1280×800 PNG | `store/screenshot-4-lock.png` |
| 小宣传图 | 440×280 PNG | `store/promo-440x280.png` |

重新生成：

1. 图标：`python3 scripts/make_icons.py`（纯标准库，手写 PNG，无外部依赖）
2. 截图：`pnpm dev` 起本地服务，把 `scripts/shots/raw/` 里的弹窗原图放进同一路径，再用浏览器打开 `scripts/shots/board.html?shot=1..4` 和 `?board=promo`，按浏览器 2 倍密度截整屏 —— 排版稿是按成品的一半尺寸写的（640×400 / 220×140），所以出来的 PNG 正好是 1280×800 和 440×280。`scripts/shots/raw/` 是中间产物，不进仓库。

截图里的账户名全部是 `example.com` 之类的合成数据，密钥由固定种子生成，**没有一条真实账户**；列表里的验证码在生成截图时也看不出真实密钥（截图为静态图片，码早已过期）。

倒计时环在剩余 ≤4 秒时会变橙并加粗描边 —— 素材里出现一片橙色看起来像在报警。出图前等一次翻页（剩余 25 秒以上）再截；截图链路本身有十几秒的固定开销，想稳住颜色可以在页面里临时把 `Date.now` 钉在一个刚翻页的时刻，截完再恢复。

## 5. 隐私与合规

| 项 | 位置 / 状态 |
| --- | --- |
| 隐私政策 URL | https://github.com/MrLeihe/Authenticator/blob/main/PRIVACY.md （建议后续托管到自己的域名或 GitHub Pages，商店后台要求可公开访问） |
| 隐私实践表单 | "不收集任何用户数据"；仅 `storage` 权限；不使用远程代码 |
| 第三方许可 | `THIRD_PARTY_LICENSES.md`（jsQR，Apache-2.0） |
| 开源许可 | `LICENSE`（MIT） |
| 数据披露 | 必须在隐私政策里主动写明 `chrome.storage.session` 的内存态前提（`PRIVACY.md` §3 已写） |

## 6. 审核备注（Reviewer notes，可填一段）

> This extension has no host permissions and makes no network requests. All code is bundled; there is no remote script and no `eval`. The only permission is `storage`, used for the encrypted vault, settings and local backups. To try it: click the toolbar icon, choose "先不用密码，直接开始" (skip the password) to create an unencrypted vault, then add an account by pasting any `otpauth://` URI. No sign-in or test account is required.

## 7. 提交前自查

- [x] `pnpm test && pnpm typecheck && pnpm build` 全绿（207 断言 / 10 个测试文件）
- [x] 产物里没有 `localhost` 残留（`grep -r localhost dist` 为空）
- [x] `pnpm zip` 产出 `sixring-1.0.0.zip`（约 170 KB，已剔除 `.map`，19 个文件），上传的就是这个包
- [x] `manifest.json` 里只有 `storage` 一个权限，无 `host_permissions`
- [x] 素材尺寸核对：截图 4 张均 1280×800、宣传图 440×280、图标 128×128
- [x] 商店图标与工具栏图标是同一套几何
- [x] 隐私政策可公开访问
- [x] 截图与描述里不出现"密码管理""自动填充""同步"这类会被判成多用途的词
