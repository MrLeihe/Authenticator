# Authenticator

本地优先的两步验证器（TOTP）浏览器扩展。密钥只存在你自己的浏览器里——不联网、无遥测、无账号、无云端。

> `Authenticator` 是项目代号，不是产品名。正式名称与图标会在上架 Chrome Web Store 前确定。

## 状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 脚手架（Vite + React + MV3） | ✅ 完成 |
| P1 | 核心算法（base32 / HOTP / TOTP） | ✅ 完成 |
| P2 | 主界面（列表 / 倒计时 / 复制） | ⏳ 进行中 |
| P3 | 本地保险库 + 可选加密 | 计划中 |
| P4 | 增删改账户 | 计划中 |
| P5 | 导入导出（otpauth / 迁移协议） | 计划中 |
| P6 | 细节打磨 | 计划中 |
| P7 | 上架准备 | 计划中 |

现在能跑的是算法层和一个弹窗骨架：

- base32 编解码，容忍小写、空格、连字符、末尾 `=`
- TOTP / HOTP，支持 SHA1 / SHA256 / SHA512，6 位与 8 位
- 39 个单元断言，其中包含 RFC 6238 六组官方向量与 RFC 4226 附录 D 十组向量
- 弹窗页面 + 明暗双主题

界面还是脚手架自检页，真正的列表在 P2。

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
│   ├── totp.ts
│   └── __tests__/
├── platform/    # 唯一允许碰 chrome.* 的一层，便于 mock
│   └── env.ts
├── background/  # MV3 service worker：只注册事件，不持有状态、不做计时
├── popup/       # 弹窗入口
└── ui/          # React 组件、样式、hooks
```

三条纪律：

1. **`core/` 不认识 `chrome`，也不认识 React。** 算法和数据变换全部在这里，测试不需要任何浏览器环境。
2. **只有 `platform/` 能调用 `chrome.*`。** 其余代码通过它间接访问存储与运行时。
3. **计时只在 UI 层。** MV3 的 service worker 约 30 秒空闲就会被回收，任何依赖定时器的状态放进 SW 都会静默失效。

## 设计要点

**TOTP 实现。** WebCrypto 的 HMAC 只有异步接口（`crypto.subtle.sign`），没有同步版本，所以整条链路是 `async` 的。动态截断的偏移量取 **MAC 的最后一个字节的低 4 位**——不能写死 `mac[19]`，那只在 SHA1 下成立。计数器用 `BigInt` 写入 8 字节大端，避免 2^32 之后溢出。

**主题。** 颜色全部以 CSS 变量声明，`tailwind.config.ts` 映射成语义名（`bg` / `surface` / `fg` / `accent` / `warn` …），组件里不出现十六进制色值。暗色不是简单反色：卡片、背景、分隔线和强调色都单独取过值。

**权限最小化。** 当前 `manifest.json` 只申请 `storage`。`alarms`、`contextMenus`、`scripting` 这些等到真正用到的功能落地时再加——用不到却申请是商店审核最常见的打回原因。全程不申请 `host_permissions`。

**性能余量。** 验证码每 250ms 只需重算即将翻页的那几个账户，不是每 tick 全量重算。20 个账户不该产生可感知的卡顿。

## 隐私

- 不发起任何网络请求，没有 CDN、没有远程代码、没有 eval
- 不收集数据，不埋点，不识别用户
- 密钥（`secret`）只以密文形式落盘；开启加密后，未解锁时内存里也不存在明文
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

MIT。`LICENSE` 文件会在首次公开发布前补充。
