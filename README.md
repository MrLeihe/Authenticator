# Authenticator

本地优先的两步验证器（TOTP）浏览器扩展。密钥只存在你自己的浏览器里——不联网、无遥测、无账号、无云端。

> `Authenticator` 是项目代号，不是产品名。正式名称与图标会在上架 Chrome Web Store 前确定。

## 状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 脚手架（Vite + React + MV3） | ✅ 完成 |
| P1 | 核心算法（base32 / HOTP / TOTP） | ✅ 完成 |
| P2 | 主界面（列表 / 倒计时 / 复制） | ✅ 完成 |
| P3 | 本地保险库 + 可选加密 | ✅ 完成 |
| P4 | 增删改账户 | ✅ 完成 |
| P5 | 导入导出（otpauth / 迁移协议） | ✅ 完成 |
| P6 | 细节打磨 | 计划中 |
| P7 | 上架准备 | 计划中 |

现在能跑的是算法层、一个可交互的列表界面、完整的上锁流程、账户的增删改，以及导入导出：

- base32 编解码，容忍小写、空格、连字符、末尾 `=`
- TOTP / HOTP，支持 SHA1 / SHA256 / SHA512，6 位与 8 位
- 200 个单元断言，其中包含 RFC 6238 六组官方向量与 RFC 4226 附录 D 十组向量
- 列表：正常 / 紧凑 / 隐藏三档视图、搜索、置顶、点击复制、环形倒计时
- 验证码缓存：20 个账户每 250ms 只重算翻页的那几个，同窗口内其余直接命中
- 保险库：首次引导设置密码（或跳过）、密码解锁、恢复码重设、空闲自动锁、每日 7 份备份
- 账户：手动添加、扫码（图片上传 / 拖放 / 粘贴）、编辑（保存前先试算一次）、删除二次确认
- 排序：稀疏 order 的拖拽排序，置顶是独立的最高优先级
- 导入导出：加密 JSON（自带独立密码）/ 明文 otpauth 文本 / Google Authenticator 迁移码，导入走"预览 → 确认"、只做加法
- 弹窗页面 + 明暗双主题

账户数据已经从假数据换成真正落盘的加密保险库。dev 预览下加 `?demo` 仍会塞 20 个合成账户（密钥由固定种子生成，不含任何真实账户），方便调样式；正式构建不会执行这段逻辑。

## 快速开始

需要 Node.js 20+ 与 pnpm。

```bash
pnpm install
pnpm test        # 单元测试
pnpm typecheck   # 两个 TS 项目都要过（src 与构建配置）
pnpm build       # 产出 dist/
```

开发时：

```bash
pnpm dev
```

然后在 `chrome://extensions` 打开开发者模式，选择「加载已解压的扩展程序」，指向 `dist/`。crxjs 会在你改代码后自动刷新。

> ⚠️ `pnpm dev` 运行期间会持续改写 `dist/`，此时 `dist/service-worker-loader.js` 里写的是 `http://localhost:5173/...` 的 HMR 地址。**打包前先停掉 dev server，或 `rm -rf dist` 后重新 `pnpm build`**，否则装进浏览器会白屏。正确的产物里这一行是 `import './assets/index.ts-xxx.js';`。

想调样式又不想反复重载扩展，可以直接在浏览器打开 `http://localhost:5173/src/popup/index.html`，非扩展环境下版本号会显示为「开发预览」。

## 目录结构与分层

```
src/
├── core/        # 纯 TS：零 DOM、零 chrome.*、100% 可单测
│   ├── types.ts
│   ├── base32.ts
│   ├── otpauth.ts        # otpauth:// URI 的解析与生成
│   ├── migration.ts      # otpauth-migration:// 迁移码（手写 protobuf 读取）
│   ├── totp.ts
│   ├── totp-cache.ts     # 按 counter 缓存验证码，避免每 tick 全量重算
│   ├── crypto.ts         # PBKDF2 + AES-GCM 原语
│   ├── vault.ts          # 保险库结构与 schemaVersion 迁移骨架
│   ├── backup.ts         # 导出封装 / 导入解析 / 合并计划
│   └── __tests__/
├── platform/    # 唯一允许碰 chrome.* 的一层，便于 mock
│   ├── env.ts
│   ├── storage.ts        # local / session 两个区 + 无 chrome 时的内存降级
│   ├── clipboard.ts
│   ├── qr.ts             # jsQR 解码（白底放大后再试一次，截图也能扫）
│   ├── files.ts          # Blob + <a download> 触发下载，不申请 chrome.downloads
│   └── vault-service.ts  # 冷启动状态机、解锁、开关密码、自动锁、备份
├── background/  # MV3 service worker：只注册事件，不持有状态、不做计时
├── popup/       # 弹窗入口
└── ui/          # React 组件、样式、hooks
    ├── components/   # AccountRow / AccountForm / Countdown / TextInput / ScreenHeader …
    ├── screens/      # List / Add / Edit / Delete / Settings / Export / Import / Onboard / Lock
    ├── hooks/        # useTick（rAF 时钟）、useAutoLock
    ├── fixtures/     # demo.ts：`?demo` 时用的合成假数据
    ├── store.ts
    └── styles/
```

三条纪律：

1. **`core/` 不认识 `chrome`，也不认识 React。** 算法和数据变换全部在这里，测试不需要任何浏览器环境。
2. **只有 `platform/` 能调用 `chrome.*`。** 其余代码通过它间接访问存储与运行时。
3. **计时只在 UI 层。** MV3 的 service worker 约 30 秒空闲就会被回收，任何依赖定时器的状态放进 SW 都会静默失效。

## 设计要点

**TOTP 实现。** WebCrypto 的 HMAC 只有异步接口（`crypto.subtle.sign`），没有同步版本，所以整条链路是 `async` 的。动态截断的偏移量取 **MAC 的最后一个字节的低 4 位**——不能写死 `mac[19]`，那只在 SHA1 下成立。计数器用 `BigInt` 写入 8 字节大端，避免 2^32 之后溢出。

**主题。** 颜色全部以 CSS 变量声明，`tailwind.config.ts` 映射成语义名（`bg` / `surface` / `fg` / `accent` / `warn` …），组件里不出现十六进制色值。暗色不是简单反色：卡片、背景、分隔线和强调色都单独取过值。

**加密。** 数据永远用一把随机 32 字节的 DEK 走 AES-256-GCM。密码只是用来包住这把 DEK（PBKDF2-SHA256 / 600k / 16 字节盐），恢复码同理（20 字节随机量直接做 KEK，不再多跑一次 PBKDF2）。三种状态（不设密码 / 密码 / 恢复码）共用同一段解密代码，靠 AAD 区分用途，所以三段密文互相搬不动。所有解密失败都折叠成同一个错误，界面不会泄露到底是密码错、密文被改还是参数不对。

**备份与迁移。** 导出文件用「导出密码」单独派生一把密钥（自己的随机盐 + PBKDF2-SHA256 / 600k），不碰保险库的 DEK——备份必须能在 DEK 已经不存在的机器上打开，否则重装一次就等于没有备份。两种密文靠 AAD 分域，把保险库密文塞进导出文件会当场解密失败，而不是一路解到底再抛个 JSON 解析错。导入只做加法，判定**先密钥后名字**：同一把密钥就是同一条凭据（改过名字也跳过），同名但密钥不同说明用户重新绑定了这个站点，两条都可能有效，所以提示后新增，绝不覆盖。Google 的迁移码是 protobuf，自己写了一百来行的读取器，没有为主流程的一个分支拖进一个 protobuf 运行库；分批导出的多张码会明确告诉用户"这是第 2/3 张"，而不是让后几张静默丢失。下载用 `Blob` + `<a download>` 触发，不为它申请 `chrome.downloads`。明文导出是显式选择，界面在按钮上方就把后果写明：拿到这个文件的人可以直接生成你的验证码。

**权限最小化。** 当前 `manifest.json` 只申请 `storage`。`contextMenus`、`scripting` 这些等到真正用到的功能落地时再加——用不到却申请是商店审核最常见的打回原因。全程不申请 `host_permissions`。每日备份也没有申请 `alarms`：备份只在数据真的变了时才做，交给写入路径判断，不需要一个会唤醒 service worker 的定时器。

**性能余量。** 验证码按 `accountId → counter` 缓存，每 250ms 只重算即将翻页的那几个账户，不是每 tick 全量重算。20 个账户实测：冷启动全量 0.8ms，同窗口内的 tick 摊销 0.008ms，跨窗口翻页那一次 0.5ms。倒计时的环靠 CSS `transition` 走针，JS 每秒只改一次目标值。

**录入。** 扫码走的是 `<input type="file">` 加拖放、粘贴，图片在本地用 jsQR 解出来——不申请 `camera`，也就不必为一个"偶尔用一次"的功能去向用户解释摄像头权限。解不出时会先把图铺到白底上放大重试一次，因为很多二维码截图是透明的，直接把原始像素喂进去会失败。二维码解析交给 `core/otpauth.ts`，它对现实世界的脏数据比较宽容：协议名大小写不限、`issuer` 可以只出现在 label 里、`digits` / `period` 缺了按 6 / 30 处理，但密钥本身严格按 RFC 4648 规范解码，不做"猜"。

**排序。** `order` 用间隔 1024 的稀疏整数，插入时取前后中点，正常使用几乎不会触发重排；真的挤到没法插了，才在同一个分组内重新编号。`pinned` 是独立于 `order` 的第一排序键——否则「置顶」会被下一次拖拽改掉的相对位置带走。

## 隐私

- 不发起任何网络请求，没有 CDN、没有远程代码、没有 eval
- 不收集数据，不埋点，不识别用户
- 密钥（`secret`）只以密文形式落盘；开启加密后，未解锁时内存里也不存在明文
- 解锁后的密钥只放在 `chrome.storage.session`，且收紧到只有扩展自己的页面可读；关浏览器即消失
- 复制验证码后按设置自动清空剪贴板
- 不读取标签页内容，不判断你登录了哪些网站

## 参与开发

- 提交前跑 `pnpm test && pnpm typecheck`
- 界面文案用简体中文
- 测试只用 RFC 公开向量或合成的假数据，**提交里不能出现任何真实密钥**
- 算法改动必须同时补 RFC 向量断言，否则不如不改
- 不引入 UI 组件库：组件都是手写的，为的是精确控制行高、字距这类细节

## 参考

算法遵循 RFC 4226（HOTP）与 RFC 6238（TOTP），base32 遵循 RFC 4648。

视觉与交互参考了若干现有验证器产品的公开界面。只取色值、字号、行高、间距这类事实性设计数据自行实现，不复制任何第三方代码与文案；代码层面的思路参考了 MIT 协议的 [Authenticator-Extension](https://github.com/Authenticator-Extension/Authenticator)。

## License

[MIT](LICENSE) © 2026 MrLeihe

产物里原样打入了 [jsQR](https://github.com/cozmo/jsQR)（Apache-2.0）用于解码二维码图片，未作修改。第三方许可全文见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
