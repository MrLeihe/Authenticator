import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QrError, decodeQrFile, decodeQrImage, resetQrDetectorForTests } from '../qr';

/**
 * 这些测试只验证**路由**：平台识别器能不能用、什么时候退回 jsQR、
 * 出错时抛的是哪一类 `QrError`。真正的识别能力是浏览器和 jsQR 的事，
 * 这里没有 canvas，也不该假装有。
 */

/** jsQR 兜底需要 canvas；给一个"什么码都没有"的假画布，让它老实返回 null */
function stubCanvas(): void {
  const context = {
    fillStyle: '',
    fillRect: () => {},
    drawImage: () => {},
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}

function stubBitmap(width = 400, height = 400): { width: number; height: number; close: () => void } {
  return { width, height, close: () => {} };
}

function stubDetector(options: {
  supported?: string[];
  result?: string | null;
  throws?: boolean;
}): { detect: ReturnType<typeof vi.fn> } {
  const detect = vi.fn(async () => {
    if (options.throws) throw new Error('platform detector failed');
    return options.result ? [{ rawValue: options.result }] : [];
  });
  class FakeDetector {
    static getSupportedFormats = async () => options.supported ?? ['qr_code'];
    detect = detect;
  }
  vi.stubGlobal('BarcodeDetector', FakeDetector);
  return { detect };
}

function stubNoDetector(): void {
  vi.stubGlobal('BarcodeDetector', undefined);
}

beforeEach(() => {
  resetQrDetectorForTests();
  stubCanvas();
  vi.stubGlobal('createImageBitmap', async () => stubBitmap());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetQrDetectorForTests();
});

describe('decodeQrImage 的识别路径', () => {
  it('平台识别器命中时直接返回，不再走 jsQR', async () => {
    const { detect } = stubDetector({ result: 'otpauth://totp/A?secret=ABC' });
    await expect(decodeQrImage(new Blob(['x']))).resolves.toBe('otpauth://totp/A?secret=ABC');
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('平台不支持 qr_code 时不构造识别器，直接退到 jsQR', async () => {
    const { detect } = stubDetector({ supported: ['ean_13'], result: 'should-not-be-used' });
    await expect(decodeQrImage(new Blob(['x']))).rejects.toBeInstanceOf(QrError);
    expect(detect).not.toHaveBeenCalled();
  });

  it('平台识别器报错时退到 jsQR，而不是把异常抛给界面', async () => {
    stubDetector({ throws: true });
    await expect(decodeQrImage(new Blob(['x']))).rejects.toMatchObject({ reason: 'no-code' });
  });

  it('平台识别器认不出（返回空数组）时退到 jsQR', async () => {
    stubDetector({ result: null });
    await expect(decodeQrImage(new Blob(['x']))).rejects.toMatchObject({ reason: 'no-code' });
  });

  it('完全没有 BarcodeDetector 时仍然走 jsQR', async () => {
    stubNoDetector();
    await expect(decodeQrImage(new Blob(['x']))).rejects.toMatchObject({ reason: 'no-code' });
  });

  it('图片读不出来时报 not-image 而不是 no-code', async () => {
    stubDetector({ result: null });
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('broken jpeg');
    });
    await expect(decodeQrImage(new Blob(['x']))).rejects.toMatchObject({ reason: 'not-image' });
  });
});

describe('decodeQrFile', () => {
  it('空文件直接判为不是图片', async () => {
    await expect(decodeQrFile(new File([], 'empty.png'))).rejects.toMatchObject({
      reason: 'not-image',
    });
  });

  it('超过 20MB 的文件不进入解码', async () => {
    const huge = new File([new Uint8Array(21 * 1024 * 1024)], 'huge.png');
    await expect(decodeQrFile(huge)).rejects.toMatchObject({ reason: 'not-image' });
  });
});
