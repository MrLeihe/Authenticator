# 设计说明

> 这是 README 的深水区：写给要改这份代码的人。想知道「能做什么」看 [README](../README.md)，想知道「为什么这么做」看这里。

## 目录结构与分层

```
src/
├── core/                    # 纯 TS：零 DOM、零 chrome.*、100% 可单测
│   ├── types.ts
│   ├── base32.ts
│   ├── otpauth.ts           # otpauth:// URI 的解析与生成
│   ├── migration.ts         # otpauth-migration:// 迁移码（手写 protobuf 读取）
│   ├── totp.ts
│   ├── totp-cache.ts        # 按 counter 缓存验证码，避免每 tick 全量重算
│   ├── crypto.ts            # PBKDF2 + AES-GCM 原语
│   ├── vault.ts             # 保险库结构与 schemaVersion 迁移骨架
│   ├── backup.ts            # 导出封装 / 导入解析 / 合并计划
│   ├── diagnostics.ts       # 面向界面的诊断原因码（不含任何用户数据）
│   └── __tests__/           # 8 个测试文件
├── platform/                # 唯一允许碰 chrome.* 的一层，便于 mock
│   ├── env.ts
│   ├── storage.ts           # local / session 两个区 + 无 chrome 时的内存降级
│   ├── clipboard.ts
│   ├── lockout.ts           # 解锁失败计数与锁定截止时间（session 区，跨弹窗开关保留）
│   ├── qr.ts                # 图片 → 二维码文本：BarcodeDetector 优先，jsQR 动态兜底
│   ├── capture.ts           # activeTab + captureVisibleTab，截当前标签页
│   ├── files.ts             # Blob + <a download> 触发下载，不申请 chrome.downloads
│   ├── ui-hint.ts           # 跨界面的一次性提示（复制成功的 toast 之类）
│   ├── vault-service.ts     # 冷启动状态机、解锁、开关密码、自动锁、备份
│   └── __tests__/           # 3 个测试文件
├── background/              # MV3 service worker：只注册事件，不持有状态、不做计时
│   ├── index.ts
│   └── lifecycle.ts
├── popup/                   # 弹窗入口
│   ├── index.html
│   ├── main.tsx
│   └── App.tsx
└── ui/                      # React 组件与界面
    ├── components/          # 19 个组件：AccountRow / AccountForm / Countdown / TextInput / Dialog …
    ├── screens/             # 11 个界面：List / Add / Edit / Delete / Trash / Export / Import /
    │                        #            Onboard / Lock / Settings / Privacy
    ├── hooks/               # useTick（rAF 时钟）、useAutoLock
    ├── fixtures/demo.ts     # `?demo` 时用的合成假数据
    ├── styles/globals.css   # CSS 变量与基础样式
    ├── i18n.ts              # 中英字典与 translate()：界面文案的唯一出处
    ├── errors.ts            # 错误对象 → 文案键（core 的错误在这里才变成人话）
    ├── overlay.ts           # 覆盖层的焦点与层级管理
    ├── theme.ts             # 把 system / light / dark 落到 <html class="dark">
    └── store.ts             # zustand：界面状态与路由
scripts/
├── make_icons.py            # 纯标准库手写 PNG，出 16 / 32 / 48 / 128 四档图标
└── shots/
    ├── capture.mjs          # 用 CDP 抓弹窗截图（中英各一套）→ docs/images/，需要 dev server 在跑
    ├── board.html           # 下载页用的排版稿（按成品一半尺寸排，2 倍密度截屏，?lang=en 出英文版）
    └── raw/                 # 截屏中间产物，不进仓库；英文套在 raw/en/
store/                       # 已出图的素材：4 张 1280×800 截图 + 440×280 宣传图
└── en/                      # 同一套版式的英文版，给 en 语言版本与「全球通用」位置用
public/
├── icons/                   # 扩展图标，四档尺寸同一套几何
└── _locales/                # manifest 的 name / description 本地化
docs/                        # 本目录：设计说明、隐私政策、许可、截图
├── DESIGN.md
├── PRIVACY.md
├── THIRD_PARTY_LICENSES.md
└── images/                  # README 用的弹窗截图（pnpm shots 产出）；en/ 是英文界面那套
```

三条纪律：

1. **`core/` 不认识 `chrome`，也不认识 React。** 算法和数据变换全部在这里，测试不需要任何浏览器环境。
2. **只有 `platform/` 能调用 `chrome.*`。** 其余代码通过它间接访问存储与运行时。
3. **计时只在 UI 层。** MV3 的 service worker 约 30 秒空闲就会被回收，任何依赖定时器的状态放进 SW 都会静默失效。

## 本地构建与 dev 陷阱

<a id="local-build-traps"></a>

<a id="local-build-traps"></a><a name="local-build-traps"></a>

`manifest.json` 是构建期由 `manifest.config.ts` 生成的，仓库根目录故意没有这个文件——在 `chrome://extensions` 里选根目录会报「清单文件缺失或不可读取」，要指向 `dist/`。crxjs 会在你改代码后自动刷新。

`pnpm dev` 运行期间会持续改写 `dist/`，此时 `dist/service-worker-loader.js` 里写的是 `http://localhost:5173/...` 的 HMR 地址（`dist/src/popup/index.html` 会成为一张写着 `CRXJS DEV MODE` 的占位页）。这版装进浏览器只有在 dev server 活着时才能用，好处是改代码自动刷新；**要装正式版先停掉 dev server，`rm -rf dist` 后重新 `pnpm build`**，否则装进去会白屏或跳到 localhost。正确的产物里这一行是 `import './assets/index.ts-xxx.js';`。

想调样式又不想反复重载扩展，可以直接在浏览器打开 `http://localhost:5173/src/popup/index.html`，非扩展环境下版本号会显示为「开发预览」。

dev 预览下加 `?demo` 会塞 20 个合成账户（密钥由固定种子生成，不含任何真实账户），方便调样式。fixtures 是动态 import 的，生产构建里连代码带字符串一起被剔除（`import.meta.env.DEV` 恒为 false，整个 chunk 不产出）；账户数据本身早已从假数据换成真正落盘的加密保险库。

## TOTP 实现

WebCrypto 的 HMAC 只有异步接口（`crypto.subtle.sign`），没有同步版本，所以整条链路是 `async` 的。

动态截断的偏移量取 **MAC 的最后一个字节的低 4 位**——不能写死 `mac[19]`，那只在 SHA1 下成立。

计数器用 `BigInt` 写入 8 字节大端，避免 2^32 之后溢出。

## 主题

颜色全部以 CSS 变量声明，`tailwind.config.ts` 映射成语义名（`bg` / `surface` / `fg` / `accent` / `warn` …），组件里不出现十六进制色值。

暗色不是简单反色：卡片、背景、分隔线和强调色都单独取过值。

## 文案：错误只是原因码

`core/` 与 `platform/` 不产出任何面向用户的句子，只报原因码（`Diagnostic` / `PasswordIssue` / `ImportNote` / `SkipReason` / `RepairNote`）；翻译只发生在 `ui/i18n.ts`。

这样同一份错误能在两种语言界面里都说对，不需要在每个 `throw` 旁边写两遍文案。顺带还有第二个结果——错误对象里一个用户数据都没有，它被日志或崩溃报告带走时不会连带把密钥送出去。

字典测试盯着类型看不见的三件事：空串、漏翻（英文表里出现汉字）、以及两种语言占位符对不上。

## 键盘与焦点

子界面都是整屏替换，所以焦点管理集中在外壳上：打开时记下焦点从哪来，卸载时只有在那个节点还在文档里才还回去（列表已经重渲染掉时不去抢焦点）。

Esc 和头部的返回箭头走同一个 `store.back()`，不会出现「按 Esc 掉回列表、点按钮却回设置」这种分叉。

开启子界面时外壳会把焦点落到容器上，但界面自己已经落了焦点（表单的 `autoFocus`）就不抢。

## 加密

数据永远用一把随机 32 字节的 DEK 走 AES-256-GCM。密码只是用来包住这把 DEK（PBKDF2-SHA256 / 600k / 16 字节盐），恢复码同理（20 字节随机量直接做 KEK，不再多跑一次 PBKDF2）。

三种状态（不设密码 / 密码 / 恢复码）共用同一段解密代码，靠 AAD 区分用途，所以三段密文互相搬不动。

所有解密失败都折叠成同一个错误，界面不会泄露到底是密码错、密文被改还是参数不对。

连续输错 5 次要等 60 秒。计数与截止时间写在 `chrome.storage.session` 而不是组件的 state 里：弹窗一关 JS 环境就销毁，只放内存的话「关掉再打开」就把计数清零了，这条减速带等于不存在。放 session 区刚好——弹窗开关之间它还在，浏览器一关就没了。它挡不住能直接读存储、离线爆破的人，只是让人手输猜密码变慢，不要当成安全边界。

## 备份与迁移

导出文件用「导出密码」单独派生一把密钥（自己的随机盐 + PBKDF2-SHA256 / 600k），**不碰保险库的 DEK**——备份必须能在 DEK 已经不存在的机器上打开，否则重装一次就等于没有备份。

两种密文靠 AAD 分域，把保险库密文塞进导出文件会当场解密失败，而不是一路解到底再抛个 JSON 解析错。

导入只做加法，判定**先密钥后名字**：同一把密钥就是同一条凭据（改过名字也跳过），同名但密钥不同说明用户重新绑定了这个站点，两条都可能有效，所以提示后新增，绝不覆盖。

Google 的迁移码是 protobuf，自己写了一百来行的读取器，没有为主流程的一个分支拖进一个 protobuf 运行库；分批导出的多张码会明确告诉用户「这是第 2/3 张」，而不是让后几张静默丢失。

下载用 `Blob` + `<a download>` 触发，不为它申请 `chrome.downloads`。

明文导出是显式选择，界面在按钮上方就把后果写明：拿到这个文件的人可以直接生成你的验证码。

## 权限最小化

`manifest.json` 申请 `storage` 和 `activeTab` 两个。

`activeTab` 只为一件事：在用户点扩展图标的那一刻截一张当前标签页，用来识别屏幕上那个二维码——它不常驻、不读别的标签页、读不到历史，比任何 `<all_urls>` 方案都窄。

`contextMenus`、`scripting` 这些等到真正用到的功能落地时再加：用不到却申请的权限，用户无从判断该不该信它。

全程不申请 `host_permissions`。每日备份也没有申请 `alarms`：备份只在数据真的变了时才做，交给写入路径判断，不需要一个会唤醒 service worker 的定时器。

## 性能余量

验证码按 `accountId → counter` 缓存，每 250ms 只重算即将翻页的那几个账户，不是每 tick 全量重算。

20 个账户实测：

| 场景 | 耗时 |
| --- | --- |
| 冷启动全量 | 0.8ms |
| 同窗口内的 tick 摊销 | 0.008ms |
| 跨窗口翻页那一次 | 0.5ms |

倒计时的环靠 CSS `transition` 走针，JS 每秒只改一次目标值。

## 录入：扫码

扫码走的是 `<input type="file">` 加拖放、粘贴，图片在本地解出来——不申请摄像头权限，也就不必为一个「偶尔用一次」的功能去向用户解释摄像头。

也可以直接扫当前页面：`activeTab` + `chrome.tabs.captureVisibleTab` 截一张当前标签页，同样在本地解。

解码**先问浏览器内置的 `BarcodeDetector`**，它不存在才退到自己带的 jsQR。这不是为了省体积，是因为 jsQR 认不出高版本的密集二维码：拿一张 Google Authenticator 的迁移码截图（v22，105 模块，每模块 6.9px）实测，十档重采样里只有三档能解，而 `BarcodeDetector` 四种喂法全部一次命中，还快一个数量级。两条路都在本地跑，图不出内存。

jsQR 是动态 `import()` 的，单独打成一个 chunk：它是包里最重的一块（gzip 后约 47 kB），而绝大多数图片走不到这条兜底路径。静态 import 的话，用户每开一次弹窗都要为一条大概率用不上的路付下载和解析的钱。

解不出时会先把图铺到白底上再试，因为很多二维码截图是透明的，直接把原始像素喂进去会失败。

二维码内容交给 `core/otpauth.ts`，它对现实世界的脏数据比较宽容：协议名大小写不限、`issuer` 可以只出现在 label 里、`digits` / `period` 缺了按 6 / 30 处理，但密钥本身严格按 RFC 4648 规范解码，不做「猜」。

如果解出来的是 `otpauth-migration://`（手机导出的是一**批**账户），会转到导入页逐条预览，而不是塞进单账户表单。

## 排序

`order` 用间隔 1024 的稀疏整数，插入时取前后中点，正常使用几乎不会触发重排；真的挤到没法插了，才在同一个分组内重新编号。

`pinned` 是独立于 `order` 的第一排序键——否则「置顶」会被下一次拖拽改掉的相对位置带走。
