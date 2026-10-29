import jsQR from 'jsqr';

/**
 * 图片 → 二维码文本。
 *
 * 为什么不用摄像头：扩展弹窗只要失去焦点就会关闭（点一下页面别处就没了），
 * 而 `getUserMedia` 的授权提示本身就发生在弹窗外。想在弹窗里持续取流，
 * 用户会看到"授权框一弹，弹窗已经关了"的死循环。摄像头扫描要等 V1.1
 * 有独立窗口/侧边栏之后再做，这里先把**截图/拖放/粘贴**这条路走通 ——
 * 它其实更常用：大多数站点在电脑上显示二维码，截个图就完事。
 */

export class QrError extends Error {
  constructor(readonly reason: 'not-image' | 'no-code', message: string) {
    super(message);
    this.name = 'QrError';
  }
}

/** 太大就先缩到这个尺寸再解码：一张 4000px 的手机截图逐像素扫要几百毫秒 */
const MAX_EDGE = 1200;

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

/**
 * 解码一张图片里的二维码。
 *
 * 先按原尺寸扫一次（截图类输入基本一次命中），没找到再缩到 1200px 试一次 ——
 * 手机拍屏幕的照片分辨率很高，缩放反而能把噪声抹平。两步都失败才报错。
 */
export async function decodeQrImage(blob: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new QrError('not-image', 'not a readable image');
  }

  try {
    const direct = decode(toCanvas(bitmap, bitmap.width, bitmap.height));
    if (direct) return direct;

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale < 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const scaled = decode(toCanvas(bitmap, width, height));
      if (scaled) return scaled;
    }
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
