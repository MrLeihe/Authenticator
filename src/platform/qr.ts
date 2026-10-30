import jsQR from 'jsqr';

/**
 * 图片 → 二维码文本。
 *
 * 为什么不用摄像头：扩展弹窗只要失去焦点就会关闭（点一下页面别处就没了），
 * 而 `getUserMedia` 的授权提示本身就发生在弹窗外。想在弹窗里持续取流，
 * 用户会看到"授权框一弹，弹窗已经关了"的死循环。摄像头扫描要等 V1.1
 * 有独立窗口/侧边栏之后再做，这里先把**截图/拖放/粘贴**这条路走通 ——
 * 它其实更常用：大多数站点在电脑上显示二维码，截个图就完事。
 *
 * ## 两条解码路径，平台优先
 *
 * `BarcodeDetector` 是浏览器内置的识别器（Chrome 桌面走系统框架，移动端走
 * 系统服务）。它比 jsQR 强得远：实测一张手机截图里每模块只有 1.9px 的
 * 二维码它也能认出来，而 jsQR 要每模块 6px 以上才开始有戏。耗时也更低
 * （同图 15~50ms，jsQR 140~400ms）。所以主路径走它。
 *
 * jsQR 留作兜底：Linux 桌面 Chrome 目前没有 `BarcodeDetector`，有它也不
 * 保证支持 `qr_code`（要查 `getSupportedFormats()`）。走到兜底时识别的
 * 目标已经不是"快"，而是"尽量别放弃"。
 */

export class QrError extends Error {
  constructor(readonly reason: 'not-image' | 'no-code', message: string) {
    super(message);
    this.name = 'QrError';
  }
}

/** 平台识别器的最小接口。TS 的 DOM lib 还没收录它，自己声明少一层依赖 */
interface PlatformBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}

interface PlatformBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): PlatformBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

/**
 * 只构造一次。构造失败（平台不支持 `qr_code`）也要记住这个结果，
 * 否则每解一张图都会白跑一次 `getSupportedFormats()`。
 */
let detector: Promise<PlatformBarcodeDetector | null> | null = null;

function requestDetector(): Promise<PlatformBarcodeDetector | null> {
  detector ??= (async () => {
    const ctor = (globalThis as { BarcodeDetector?: PlatformBarcodeDetectorCtor }).BarcodeDetector;
    if (typeof ctor !== 'function') return null;
    try {
      const formats = await ctor.getSupportedFormats?.();
      // 有这个 API 不等于支持二维码：Windows / Linux 上常见"能构造、不支持"
      if (formats && !formats.includes('qr_code')) return null;
      return new ctor({ formats: ['qr_code'] });
    } catch {
      return null;
    }
  })();
  return detector;
}

async function detectWithPlatform(bitmap: ImageBitmap): Promise<string | null> {
  const found = await requestDetector();
  if (!found) return null;
  try {
    const results = await found.detect(bitmap);
    return results[0]?.rawValue ?? null;
  } catch {
    // 识别器内部报错（图像过大、平台服务不可用）不该让整个流程失败，
    // 交给下面的 jsQR 再试一次
    return null;
  }
}

/**
 * jsQR 兜底时依次尝试的最长边。
 *
 * 这里穷举而不是只缩一次，是因为 jsQR 对重采样尺度敏感得反常 —— 同一张
 * 二维码（v22，105 模块）在 1600px 能解、在 1400 / 1800 / 原尺寸都解不出。
 * 它的定位模块检测依赖 8px 块二值化，块网格与模块边界的相位一变就失手。
 * 与其去猜哪一档对，不如把几档都试一遍：单档 40~200ms，命中即停。
 */
const JSQR_TARGETS = [1200, 1600, 2000];

function toCanvas(source: ImageBitmap, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new QrError('not-image', 'canvas 2d context unavailable');
  // 白底：带透明通道的截图直接铺在画布上会变成黑底，二维码会扫不出来
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function decode(imageData: ImageData): string | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    // 只找回字形二维码：反色二维码（白码黑底）真实存在，但优先正色
    inversionAttempts: 'attemptBoth',
  });
  return result?.data ?? null;
}

function decodeWithJsQr(bitmap: ImageBitmap): string | null {
  const direct = decode(toCanvas(bitmap, bitmap.width, bitmap.height));
  if (direct) return direct;

  const longest = Math.max(bitmap.width, bitmap.height);
  for (const target of JSQR_TARGETS) {
    // 与当前尺寸几乎一样就没必要再扫一遍
    if (Math.abs(target - longest) / longest < 0.08) continue;
    const scale = target / longest;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (width * height > 8_000_000) continue;
    const found = decode(toCanvas(bitmap, width, height));
    if (found) return found;
  }
  return null;
}

/**
 * 解码一张图片里的二维码。
 *
 * 平台识别器一次就够；它不可用时退到 jsQR，按几档尺寸挨个试。
 */
export async function decodeQrImage(blob: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new QrError('not-image', 'not a readable image');
  }

  try {
    const fromPlatform = await detectWithPlatform(bitmap);
    if (fromPlatform) return fromPlatform;

    const fromJsQr = decodeWithJsQr(bitmap);
    if (fromJsQr) return fromJsQr;
  } finally {
    bitmap.close();
  }

  throw new QrError('no-code', 'no qr code found in image');
}

/** 文件选择框与拖放都给的是 File，转一层只是为了把"不是图片"的错误说清楚 */
export async function decodeQrFile(file: File): Promise<string> {
  if (file.size === 0) throw new QrError('not-image', 'empty file');
  if (file.size > 20 * 1024 * 1024) throw new QrError('not-image', 'image larger than 20MB');
  return decodeQrImage(file);
}

/** 仅供测试：重置一次性的识别器缓存 */
export function resetQrDetectorForTests(): void {
  detector = null;
}
