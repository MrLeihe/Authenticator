/**
 * 出图：弹窗截图 + 下载页素材。一条命令跑完，不手工截屏。
 *
 *   pnpm shots          # 抓弹窗 → docs/images/ 与 scripts/shots/raw/ → 渲染 store/
 *   pnpm shots --raw    # 只抓弹窗，不渲染排版稿
 *
 * 为什么不用 Puppeteer：为几张图装一整棵依赖树不值得。这里直接说 CDP，
 * Node 22 自带 WebSocket，零依赖；Chrome 用系统装的那个。
 *
 * 前置：`pnpm dev` 已在 5173 跑着（`?demo` 只在 dev 构建生效）。
 *
 * 几个刻意的细节：
 *   - 视口锁 400 宽、deviceScaleFactor 2，输出 800px 宽的视网膜图；
 *     README 按 300px 显示、排版稿按 250px 显示都依然清晰
 *   - 高度按「最后一行完整可见的底部」裁，不按整页 —— 否则会切出半行；
 *     上限 600 是 Chrome 弹窗的真实高度上限，再高就不是用户看到的样子了
 *   - 截图前关掉「还没设密码」提示条：留着会让首图像在报警
 *   - 深色是真去点那个主题按钮，不是往 <html> 上贴 class，走的是产品路径
 *   - 排版稿按 640×400 排版、2 倍密度截屏 → 正好 1280×800，不缩放
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const OUT_DOCS = join(ROOT, 'docs/images');
const OUT_RAW = join(HERE, 'raw');
const OUT_STORE = join(ROOT, 'store');
const PORT = 9333;
const PROFILE = '/tmp/authenticator-shots-profile';
const PAGE = 'http://localhost:5173/src/popup/index.html';
const BOARD = 'http://localhost:5173/scripts/shots/board.html';

const POPUP_WIDTH = 400;
const POPUP_VIEWPORT = 720;
/** Chrome 扩展弹窗的高度上限，超过就不是用户看到的样子了 */
const POPUP_MAX_HEIGHT = 600;

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome');

const rawOnly = process.argv.includes('--raw');

for (const dir of [OUT_DOCS, OUT_RAW, OUT_STORE]) mkdirSync(dir, { recursive: true });
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
  throw new Error('Chrome 调试端口没起来。检查 CHROME_PATH，以及 dev server 是否在 5173。');
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

const click = (selector) =>
  evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('找不到 ' + ${JSON.stringify(selector)});
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
async function open(url) {
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
    const dismiss = document.querySelector('button[aria-label="关闭这条提示"]');
    if (dismiss) dismiss.click();
    return !!dismiss;
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
async function shoot(name) {
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
  writeFileSync(join(OUT_RAW, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`  弹窗 ${name}.png  ${POPUP_WIDTH * 2}×${height * 2}`);
}

console.log('① 抓弹窗');

await viewport(POPUP_WIDTH, POPUP_VIEWPORT);

await open(`${PAGE}?demo`);
await waitForFreshTick();
await shoot('1-list');

await click('button[aria-label="切换到深色"]');
await sleep(700);
await waitForFreshTick();
await shoot('2-dark');

await open(`${PAGE}?demo`);
await click('button[aria-label="添加账户"]');
await sleep(500);
await clickText('二维码');
await sleep(600);
await shoot('3-scan');

await open(`${PAGE}?demo`);
await click('button[aria-label="设置"]');
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

if (!rawOnly) {
  console.log('② 渲染排版稿');
  const boards = [
    { query: 'shot=1', out: 'screenshot-1-list.png', width: 640, height: 400 },
    { query: 'shot=2', out: 'screenshot-2-dark.png', width: 640, height: 400 },
    { query: 'shot=3', out: 'screenshot-3-scan.png', width: 640, height: 400 },
    { query: 'shot=4', out: 'screenshot-4-backup.png', width: 640, height: 400 },
    { query: 'board=promo', out: 'promo-440x280.png', width: 220, height: 140 },
  ];
  for (const board of boards) {
    await viewport(board.width, board.height);
    await send('Page.navigate', { url: `${BOARD}?${board.query}` });
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
    writeFileSync(join(OUT_STORE, board.out), Buffer.from(shot.data, 'base64'));
    console.log(`  ${board.out}  ${board.width * 2}×${board.height * 2}`);
  }
}

ws.close();
chrome.kill('SIGKILL');
rmSync(PROFILE, { recursive: true, force: true });
console.log('完成');
