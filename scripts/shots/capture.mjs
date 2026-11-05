/**
 * 出图：弹窗截图 + 下载页素材。一条命令跑完，不手工截屏。
 *
 *   pnpm shots          # 中文套 + 英文套 → docs/images/ 与 scripts/shots/raw/ → store/
 *   pnpm shots --raw    # 只抓弹窗，不渲染排版稿
 *
 * 为什么不用 Puppeteer：为几张图装一整棵依赖树不值得。这里直接说 CDP，
 * Node 22 自带 WebSocket，零依赖；Chrome 用系统装的那个。
 *
 * 前置：`pnpm dev` 已在跑（`?demo` 只在 dev 构建生效）。端口不是 5173 时用
 * `SHOTS_BASE=http://localhost:5273 pnpm shots` 覆盖。
 *
 * 几个刻意的细节：
 *   - 视口锁 400 宽、deviceScaleFactor 2，输出 800px 宽的视网膜图；
 *     README 按 300px 显示、排版稿按 250px 显示都依然清晰
 *   - 高度按「最后一行完整可见的底部」裁，不按整页 —— 否则会切出半行；
 *     上限 600 是 Chrome 弹窗的真实高度上限，再高就不是用户看到的样子了
 *   - 截图前关掉「还没设密码」提示条：留着会让首图像在报警
 *   - 深色是真去点那个主题按钮，不是往 <html> 上贴 class，走的是产品路径
 *   - 排版稿按 640×400 排版、2 倍密度截屏 → 正好 1280×800，不缩放
 *   - 英文套不重开页面：界面语言存在加密保险库里，`?demo` 每次重载都会重新播种，
 *     偏好跟着丢。所以英文那套是「切一次语言，然后靠返回键在应用内走完四屏」
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const OUT_DOCS = join(ROOT, 'docs/images');
const OUT_DOCS_EN = join(OUT_DOCS, 'en');
const OUT_RAW = join(HERE, 'raw');
const OUT_RAW_EN = join(OUT_RAW, 'en');
const OUT_STORE = join(ROOT, 'store');
const OUT_STORE_EN = join(OUT_STORE, 'en');
const PORT = 9333;
const PROFILE = '/tmp/authenticator-shots-profile';
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const PAGE = `${BASE}/src/popup/index.html`;
const BOARD = `${BASE}/scripts/shots/board.html`;

const POPUP_WIDTH = 400;
const POPUP_VIEWPORT = 720;
/** Chrome 扩展弹窗的高度上限，超过就不是用户看到的样子了 */
const POPUP_MAX_HEIGHT = 600;

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome');

/**
 * 界面文案 → 选择器。按钮全靠 aria-label 定位，所以每种语言各备一份。
 * 键名是「意思」，值是各语言下产品自己写的那句话 —— 别在这里硬编码中文。
 */
const L = {
  zh: {
    dismiss: '关闭这条提示',
    dark: '切换到深色',
    light: '切换到浅色',
    add: '添加账户',
    settings: '设置',
    qr: '二维码',
    language: '界面语言',
    back: '返回',
    english: 'English',
  },
  en: {
    dismiss: 'Dismiss this reminder',
    dark: 'Switch to dark',
    light: 'Switch to light',
    add: 'Add account',
    settings: 'Settings',
    qr: 'QR code',
    language: 'Language',
    back: 'Back',
    english: 'English',
  },
};

const rawOnly = process.argv.includes('--raw');

for (const dir of [OUT_DOCS, OUT_DOCS_EN, OUT_RAW, OUT_RAW_EN, OUT_STORE, OUT_STORE_EN]) {
  mkdirSync(dir, { recursive: true });
}
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox', // 容器 / 受限环境里 zygote 起不来
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  `--window-size=${POPUP_WIDTH},${POPUP_VIEWPORT}`,
  `${PAGE}?demo`,
]);

/** 等调试端口起来，返回页面的 ws 地址 */
async function pageSocket() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // 还没起来
    }
    await sleep(250);
  }
  throw new Error(`Chrome 调试端口没起来。检查 CHROME_PATH，以及 dev server 是否在 ${BASE}。`);
}

const ws = new WebSocket(await pageSocket());
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}');
  const handlers = msg.id && pending.get(msg.id);
  if (!handlers) return;
  pending.delete(msg.id);
  if (msg.error) handlers.reject(new Error(JSON.stringify(msg.error)));
  else handlers.resolve(msg.result);
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`CDP 超时：${method}`));
    }, 15000);
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
}

const click = (label) =>
  evaluate(`(() => {
    const el = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
    if (!el) throw new Error('找不到按钮 ' + ${JSON.stringify(label)});
    el.click();
    return true;
  })()`);

const clickText = (text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button')]
      .find((b) => (b.textContent || '').trim() === ${JSON.stringify(text)});
    if (!el) throw new Error('找不到按钮 ' + ${JSON.stringify(text)});
    el.click();
    return true;
  })()`);

async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  });
}

await send('Page.enable');
await send('Runtime.enable');

/** 打开弹窗 → 等列表渲染出验证码 → 关掉提示条 → 等动画稳定 */
async function open(url, lang) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 80; i += 1) {
    await sleep(150);
    const ready = await evaluate(`!!document.querySelector('[data-account-id]')`).catch(
      () => false,
    );
    if (ready) break;
  }
  await sleep(800);
  await evaluate(`(() => {
    const b = document.querySelector('button[aria-label=${JSON.stringify(L[lang].dismiss)}]');
    if (b) b.click();
    return !!b;
  })()`).catch(() => false);
  await sleep(350);
}

/** 倒计时环在剩余 ≤4 秒时会变橙加粗，看起来像在报警 —— 等一次翻页再截 */
async function waitForFreshTick() {
  for (let i = 0; i < 40; i += 1) {
    const left = await evaluate(`(() => {
      const el = document.querySelector('[data-account-id] .tnum');
      return el ? Number(el.textContent.trim()) : null;
    })()`).catch(() => null);
    if (left !== null && Number.isFinite(left) && left >= 10) return;
    await sleep(500);
  }
}

/** 抓一整屏弹窗，高度按最后一行完整可见的底部裁 */
async function shoot(name, dir = OUT_RAW) {
  const height = await evaluate(`(() => {
    const max = ${POPUP_MAX_HEIGHT};
    let bottom = 0;
    for (const row of document.querySelectorAll('[data-account-id]')) {
      const edge = row.getBoundingClientRect().bottom;
      if (edge <= max) bottom = edge;
    }
    if (bottom) return Math.round(bottom + 12);
    return Math.min(max, Math.ceil(document.body.getBoundingClientRect().height));
  })()`);
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: POPUP_WIDTH, height, scale: 1 },
  });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`  弹窗 ${name}.png  ${POPUP_WIDTH * 2}×${height * 2}  → ${dir.replace(ROOT, '.')}`);
}

console.log('① 抓弹窗（中文）');

await viewport(POPUP_WIDTH, POPUP_VIEWPORT);

await open(`${PAGE}?demo`, 'zh');
await waitForFreshTick();
await shoot('1-list');

await click(L.zh.dark);
await sleep(700);
await waitForFreshTick();
await shoot('2-dark');

await open(`${PAGE}?demo`, 'zh');
await click(L.zh.add);
await sleep(500);
await clickText(L.zh.qr);
await sleep(600);
await shoot('3-scan');

await open(`${PAGE}?demo`, 'zh');
await click(L.zh.settings);
await sleep(700);
await shoot('4-backup');

// README 用的是同样四张，只是文件名说人话
const README_NAMES = {
  '1-list': 'popup-1-list',
  '2-dark': 'popup-2-dark',
  '3-scan': 'popup-3-add',
  '4-backup': 'popup-4-settings',
};
for (const [raw, doc] of Object.entries(README_NAMES)) {
  copyFileSync(join(OUT_RAW, `${raw}.png`), join(OUT_DOCS, `${doc}.png`));
}
console.log(`  → ${OUT_DOCS}`);

console.log('② 抓弹窗（英文）');

/**
 * 英文这套不能重开页面：语言偏好存进加密保险柜，`?demo` 重载会重新播种，
 * 偏好跟着丢。所以先走产品路径把语言切成英文，之后全程用返回键在应用内移动。
 */
await open(`${PAGE}?demo`, 'zh');
await click(L.zh.settings);
await sleep(700);
await click(L.zh.language);
await sleep(400);
await clickText(L.zh.english);
await sleep(800);

// 切完语言就停在设置页 —— 正好是第 4 张
await shoot('4-backup', OUT_RAW_EN);

await click(L.en.back);
await sleep(700);
await waitForFreshTick();
await shoot('1-list', OUT_RAW_EN);

await click(L.en.dark);
await sleep(700);
await waitForFreshTick();
await shoot('2-dark', OUT_RAW_EN);

await click(L.en.light);
await sleep(700);
await click(L.en.add);
await sleep(500);
await clickText(L.en.qr);
await sleep(600);
await shoot('3-scan', OUT_RAW_EN);

for (const [raw, doc] of Object.entries(README_NAMES)) {
  copyFileSync(join(OUT_RAW_EN, `${raw}.png`), join(OUT_DOCS_EN, `${doc}.png`));
}
console.log(`  → ${OUT_DOCS_EN}`);

if (!rawOnly) {
  console.log('③ 渲染排版稿');
  const boards = [
    { query: 'shot=1', out: 'screenshot-1-list.png', width: 640, height: 400 },
    { query: 'shot=2', out: 'screenshot-2-dark.png', width: 640, height: 400 },
    { query: 'shot=3', out: 'screenshot-3-scan.png', width: 640, height: 400 },
    { query: 'shot=4', out: 'screenshot-4-backup.png', width: 640, height: 400 },
    { query: 'board=promo', out: 'promo-440x280.png', width: 220, height: 140 },
  ];
  const runs = [
    { lang: 'zh', dir: OUT_STORE },
    { lang: 'en', dir: OUT_STORE_EN },
  ];
  for (const run of runs) {
    for (const board of boards) {
      await viewport(board.width, board.height);
      await send('Page.navigate', {
        url: `${BOARD}?${board.query}&lang=${run.lang}`,
      });
      // 等所有 <img>（弹窗原图 + 图标）真正解码完，否则会截到空白框
      for (let i = 0; i < 60; i += 1) {
        await sleep(150);
        const done = await evaluate(
          `[...document.images].every((img) => img.complete && img.naturalWidth > 0)`,
        ).catch(() => false);
        if (done) break;
      }
      await sleep(400);
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: board.width, height: board.height, scale: 1 },
      });
      writeFileSync(join(run.dir, board.out), Buffer.from(shot.data, 'base64'));
      console.log(
        `  ${board.out}  ${board.width * 2}×${board.height * 2}  → ${run.dir.replace(ROOT, '.')}`,
      );
    }
  }
}

ws.close();
chrome.kill('SIGKILL');
// 等 Chrome 真的退出再删 profile：刚 kill 时它还在写 Default/，rmSync 会撞 ENOTEMPTY
await sleep(400);
try {
  rmSync(PROFILE, { recursive: true, force: true });
} catch {
  // 临时目录，删不掉也不影响产物
}
console.log('完成');
