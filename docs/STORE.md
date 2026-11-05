# Chrome Web Store 上架材料

本文件是"照着填就能提交"的清单。所有素材都在仓库里，路径见每节。

- 名称：**身份验证器 - 本地两步验证** / **Authenticator - Local TOTP**（`public/_locales/`）
- 版本：`1.0.0`
- 类目：生产力工具（Productivity）
- 语言：中文（简体）、English

> ⚠️ **上架前必须自己再做一次重名与商标检索**（Chrome Web Store 内搜索 `身份验证器` / `Authenticator`、USPTO/EUIPO 商标库、`authenticator` 相关域名）。通用名撞名的概率不低，检索结论以你查到的为准。

---

## 1. 单一用途（Single purpose）

> 生成基于时间的两步验证码（TOTP）。

就这一句，不要写"还能备份、还能导入、还能右键插入"。备份与导入是"保管你自己已经有的验证码"的必要延伸，属于同一用途；**不要**在描述里出现密码管理、书签、标签页整理这类词。

## 2. 权限理由（每个权限一行，后台表单逐条填）

| 权限 | 后台填写的说明（中文） | English |
| --- | --- | --- |
| `storage` | 保存加密后的账户密钥、设置与自动备份。数据只在本机，不上传。 | Stores the encrypted account secrets, settings and automatic backups on this device only. Nothing is uploaded. |
| `activeTab` | 仅用于「扫描此页面上的二维码」：用户点开扩展、并主动按下该按钮时，截取当前标签页的一张画面用于本地识别二维码。授权不常驻，只对当前标签页、且只在打开扩展的这一次有效；不按按钮不截任何东西，截图只在内存中解码，不写盘、不上传。 | Only for "Scan this page": when the user opens the extension and presses that button, one frame of the current tab is captured and decoded locally. The grant is not persistent — it covers that single tab, only from the moment the extension was opened. Nothing is captured unless the button is pressed, and the frame is decoded in memory, never written to disk or uploaded. |

V1.1 若加上右键插入，再补 `contextMenus` / `scripting`；**`activeTab` 已经在 V1.0 就申请了**，别把它当成 V1.1 的待办。

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
> - 不联网、无账号、无遥测、无内购。只申请 `storage` 和 `activeTab` 两个权限，没有网站访问权限（`activeTab` 只在你点开扩展并按下「扫描此页面」时对当前标签页生效一次）
> - 密钥始终以密文（AES-256-GCM）保存；可以设置主密码，也可以不设
> - 忘记主密码时用恢复码找回；每天自动留一份加密备份（最多 7 份），账户删光了还能从备份一键恢复
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
> - No network, no account, no telemetry, no in-app purchases. Two permissions only: `storage` for the encrypted vault, and `activeTab` for the single-frame capture behind "Scan this page" — no host permissions, so no access to any site by default
> - Secrets are always stored encrypted (AES-256-GCM). Password protection is optional
> - A recovery code gets you back in if you forget the password; an encrypted backup is kept daily (up to 7 copies)
> - Export an encrypted backup, or plaintext URIs to move to another authenticator
>
> **What it does not do**
>
> It is not a password manager. It does not sync to a cloud, read your browsing history, or know which sites you sign in to. It generates two-factor codes, and that is all.

## 4. 图片素材

| 素材 | 规格 | 中文版 | 英文版 |
| --- | --- | --- | --- |
| 商店图标 | 128×128 PNG | `public/icons/128.png` | 同左（图标不分语言） |
| 截图 1 · 列表 | 1280×800 PNG | `store/screenshot-1-list.png` | `store/en/screenshot-1-list.png` |
| 截图 2 · 暗色 | 1280×800 PNG | `store/screenshot-2-dark.png` | `store/en/screenshot-2-dark.png` |
| 截图 3 · 扫码 | 1280×800 PNG | `store/screenshot-3-scan.png` | `store/en/screenshot-3-scan.png` |
| 截图 4 · 备份与恢复 | 1280×800 PNG | `store/screenshot-4-backup.png` | `store/en/screenshot-4-backup.png` |
| 小宣传图 | 440×280 PNG | `store/promo-440x280.png` | `store/en/promo-440x280.png` |

后台对应位置：

- `zh-CN` 语言版本 → 用中文那套
- `en` 语言版本 → 用英文那套
- **全球通用的屏幕截图**（必填）→ 用英文那套：除中文外所有语种的界面都是英文（`resolveLang` 只认 `zh`），中文图在这批用户眼里和实际界面对不上

重新生成：

1. 图标：`python3 scripts/make_icons.py`（纯标准库，手写 PNG，无外部依赖）
2. 截图与宣传图：`pnpm dev` 起本地服务后跑 `pnpm shots`。脚本会用 CDP 驱动本机 Chrome 抓四张弹窗原图（`scripts/shots/raw/`，不进仓库），复制一份给 README 用（`docs/images/`），再按 `scripts/shots/board.html` 渲染出 `store/` 里的 1280×800 与 440×280 —— 排版稿按成品一半尺寸写（640×400 / 220×140），2 倍密度截屏，所以不需要任何缩放。
3. 英文套是同一趟跑出来的：脚本先在设置页把界面语言切成 English，再靠返回键在应用内走完四屏。**不能重开页面**——语言偏好存在加密保险库里，`?demo` 重载会重新播种，偏好跟着丢。dev server 不在 5173 时用 `SHOTS_BASE=http://localhost:5273 pnpm shots` 覆盖。

界面每改一次就该重跑一次 `pnpm shots`：`store/` 里的图、`store/en/` 里的图和两版 README 里的图是同一批原图，界面动了却只更新其中一边，就会出现「商店图还是老界面」这种打回理由。

截图里的账户名全部是 `example.com` 之类的合成数据，密钥由固定种子生成，**没有一条真实账户**；列表里的验证码在生成截图时也看不出真实密钥（截图为静态图片，码早已过期）。

倒计时环在剩余 ≤4 秒时会变橙并加粗描边 —— 素材里出现一片橙色看起来像在报警。脚本里已经等过一次翻页（`waitForFreshTick`，剩余 ≥10 秒才截），不需要手工干预。

## 5. 隐私与合规

| 项 | 位置 / 状态 |
| --- | --- |
| 隐私政策 URL | https://github.com/MrLeihe/Authenticator/blob/main/docs/PRIVACY.md （后台该项对所有商品都是必填，与是否收集数据无关；用 `blob` 视图而非 `raw`，raw 是纯文本无页面样式，容易被判成打不开。后续可托管到自己的域名或 GitHub Pages，仓库若转私有会立刻失效） |
| 隐私实践表单 | "不收集任何用户数据"；`storage` + `activeTab` 权限；不使用远程代码 |
| 第三方许可 | `docs/THIRD_PARTY_LICENSES.md`（jsQR，Apache-2.0），`pnpm zip` 会把它和 `LICENSE` 一并放进分发包 |
| 开源许可 | `LICENSE`（MIT），同样随包分发 |
| 数据披露 | 必须在隐私政策里主动写明 `chrome.storage.session` 的内存态前提（`docs/PRIVACY.md` §3 已写） |

### 5.1 「隐私权规范」标签页逐字段填法

点「提请审核」时如果弹出「无法发布」，列出的是**这一页**的必填项，和商品详情页填得全不全无关。逐条对应：

| 后台提示 | 填哪里 | 填什么 |
| --- | --- | --- |
| 必须提供对单一用途的说明 | 单一用途说明 | 见下方「单一用途」 |
| 必须提供需使用远程代码的理由 | 远程代码 → 是否使用远程代码 | 先选**否**；改了仍报才需要写说明 |
| 必须提供需使用 activeTab 权限的理由 | 权限理由 → `activeTab` | 见下方「activeTab 权限理由」 |
| 必须提供需使用 storage 权限的理由 | 权限理由 → `storage` | 见下方「storage 权限理由」 |
| 须确认数据使用情况符合开发者计划政策 | 数据使用：上方 9 类数据 + 下方 3 项承诺 | 9 类数据**全部不勾**，下方 3 项承诺**全部勾选** |

**单一用途**

```
在本机生成基于时间的两步验证码（TOTP）。所有密钥以 AES-256-GCM 密文保存在浏览器本地存储中，扩展不联网、无账号、无遥测。备份与导入导出是"保管用户已有的验证码"的必要延伸，不构成第二用途。
```

**storage 权限理由**

```
保存加密后的账户密钥（TOTP 密钥、账户名、发行方）、用户设置（主题、视图密度、锁定超时）与每日自动备份。数据仅写入 chrome.storage.local，不上传任何服务器，扩展本身不发起网络请求。
```

**activeTab 权限理由**

```
仅用于"扫描此页面上的二维码"这一个功能。用户点开扩展并主动按下该按钮时，才截取当前标签页的一张画面，用于在本机识别二维码；截图只在内存中解码，不写盘、不上传，识别结束即丢弃。该授权不常驻，只覆盖当前标签页、且只在打开扩展的这一次有效。不申请 host_permissions，因此没有对任何网站的常驻访问权。
```

**远程代码（仅当选了否仍要求填写时的说明文字）**

```
本扩展不使用远程代码。所有 JavaScript 均打包在安装包内（含二维码解码库 jsQR，以本地独立 chunk 形式分发），运行时不加载任何远程脚本、不执行 eval、不通过 CDN 引入资源。manifest 中没有配置指向外部地址的 content_security_policy。
```

两点最容易踩：

- 弹窗点「确定」只是关提示，**不会保存**。填完先「保存草稿」，再「提请审核」，否则同样的提示会再出现一次。
- 隐私政策网址是这一页的字段，不是商品详情页的。这 5 条消掉后如果冒出第 6 条，就是它没填。必须用 `blob` 地址（`/blob/main/docs/PRIVACY.md`），`raw` 是纯文本、没有页面样式，审核容易判成无法访问。

**数据使用怎么勾（容易勾错的一项）**

「身份验证信息（密码、凭证、安全问题或个人识别码）」看起来很贴切，但**不要勾**。Chrome 对「收集」的定义是数据被传输到开发者服务器或第三方；只在本机存储、不外传，不算收集。本扩展没有网络权限（manifest 只有 `storage` + `activeTab`），审核员查 manifest 就能确认这个声明属实。勾了反而和隐私政策 §1「我们不收集任何数据」自相矛盾，会引出「传输给谁、用途是什么」的追问。

所以：**9 类数据一列全不勾**，详情页会自动显示「不收集用户数据」；下方 3 项承诺全勾（页面明确要求 3 个都勾）。

后续如果真加了云同步或多端共享，必须回来勾「身份验证信息」，同时改隐私政策——两者不一致是打回的高频原因。

## 6. 审核备注（Reviewer notes，可填一段）

> This extension has no host permissions and makes no network requests. All code is bundled; there is no remote script and no `eval`. It requests two permissions: `storage` for the encrypted vault, settings and local backups, and `activeTab` solely for the "Scan this page" button — one capture of the current tab, decoded in memory, never written to disk or uploaded. To try it: click the toolbar icon (no password is required to start), then add an account by pasting any `otpauth://` URI, uploading a QR screenshot, or pressing "Scan this page" on any site showing a QR code. No sign-in or test account is required.

## 7. 提交前自查

账号侧（任意一项没做，前台填得再全也提交不了）：

- [ ] 开发者账号已付一次性 $5 注册费
- [ ] 发布用的 Google 账号**已开启两步验证**（2SV），否则上传 zip 会直接失败
- [ ] 后台「账号」页填了联系邮箱并**完成验证**（没验证时提交按钮会被拦下，并提示去「账号」标签页）
- [ ] 交易者声明选**非交易者（non-trader）**：选交易者会把联系地址公开在商品详情页
- [ ] 隐私实务页最底部三项承诺（不出售数据 / 不用于无关用途 / 不用于信贷评估）全部勾选
- [ ] 数据使用 9 类数据（含「身份验证信息」）**全部不勾**——本扩展不外传数据，勾了会与隐私政策冲突（理由见 §5.1）
- [ ] 「隐私权规范」标签页 5 个必填项逐条填完（见 §5.1），其中「是否使用远程代码」选**否**。空任何一项，点「提请审核」都会弹「无法发布」
- [ ] 填写后先点「保存草稿」再点「提请审核」——提示框的「确定」只关闭弹窗，不保存

产品侧：

- [x] `pnpm test && pnpm typecheck && pnpm build` 全绿（244 断言 / 13 个测试文件）
- [x] 产物里没有 `localhost` 残留（`grep -r localhost dist` 为空）
- [x] `pnpm zip` 产出 `authenticator-<package.json 里的版本>.zip`（约 185 KB，已剔除 `.map`，并附带 `LICENSE` 与 `THIRD_PARTY_LICENSES.md`），上传的就是这个包
- [x] `manifest.json` 里只有 `storage` + `activeTab` 两个权限，无 `host_permissions`
- [x] 素材尺寸核对：截图 4 张均 1280×800、宣传图 440×280、图标 128×128
- [x] 商店图标与工具栏图标是同一套几何
- [x] 隐私政策可公开访问
- [x] 截图与描述里不出现"密码管理""自动填充""同步"这类会被判成多用途的词
