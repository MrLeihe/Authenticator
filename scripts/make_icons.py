#!/usr/bin/env python3
"""生成扩展图标（16/32/48/128 + 商店用的 128）。

不引第三方图形库：形状用有符号距离场算覆盖率，等于免费的抗锯齿，
再手工拼 PNG（zlib + CRC）。这样图标永远可以按同一份几何重画，
也不会在仓库里留下一个只能靠设计软件改的二进制。

标记：环形缺口（倒计时）+ 钥匙孔。缺口开在右上方，看着像秒针刚走过。
"""

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'icons'

INK_TOP = (0x1B, 0x3A, 0x8A)      # 深蓝
INK_BOTTOM = (0x0C, 0x14, 0x2E)   # 近黑深蓝
MARK = (0xFF, 0xFF, 0xFF)


def clamp(value, low=0.0, high=1.0):
    return low if value < low else high if value > high else value


def coverage(distance, feather):
    """距离 → 覆盖率。feather 是 1 像素宽过渡带的一半。"""
    return clamp(0.5 - distance / (2 * feather))


def sd_round_rect(x, y, half, radius):
    """中心在原点的圆角正方形（SDF）。"""
    qx = abs(x) - (half - radius)
    qy = abs(y) - (half - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def blend(base, color, alpha):
    return tuple(base[i] + (color[i] - base[i]) * alpha for i in range(3))


def render(size):
    """画一张 size×size 的图标，返回 RGBA 行序列。"""
    n = size
    half = n / 2.0
    radius = half * 0.235
    feather = max(n / 48.0, 0.6)

    # 小尺寸把笔画整体加粗：16px 上原来的 1.2px 描边会糊成一片灰
    small = 1.0 if n <= 32 else 0.0
    ring_mid = half * (0.455 - 0.015 * small)
    ring_half = half * (0.078 + 0.035 * small)   # 描边宽度的一半

    hole_r = half * (0.088 + 0.02 * small)
    hole_cy = -half * 0.055           # 钥匙孔的圆略高于中心
    taper_bottom = hole_cy + half * 0.215
    taper_top_w = hole_r * 0.52
    taper_bottom_w = hole_r * 1.05

    gap_center = math.radians(58)
    gap_half = math.radians(26)

    pixels = bytearray()
    for py in range(n):
        row = bytearray()
        for px in range(n):
            x = px + 0.5 - half
            y = py + 0.5 - half
            t = clamp((y + half) / n)

            alpha = coverage(sd_round_rect(x, y, half, radius), feather)
            color = [INK_TOP[i] + (INK_BOTTOM[i] - INK_TOP[i]) * t for i in range(3)]

            dist = math.hypot(x, y)

            # 环，右上方留一个缺口：像秒针刚走过，也是"还要再过几秒"的暗示
            ring = coverage(abs(dist - ring_mid) - ring_half, feather)
            if ring > 0:
                angle = math.atan2(-y, x)
                delta = abs((angle - gap_center + math.pi) % (2 * math.pi) - math.pi)
                if delta < gap_half:
                    ring = 0.0
            if ring > 0:
                color = blend(color, MARK, ring)

            # 钥匙孔：一个圆 + 往下张开的梯形
            mark = 0.0
            if dist > 0 or True:
                mark = coverage(math.hypot(x, y - hole_cy) - hole_r, feather)
            if hole_cy <= y <= taper_bottom:
                frac = (y - hole_cy) / (taper_bottom - hole_cy)
                width = taper_top_w + (taper_bottom_w - taper_top_w) * frac
                mark = max(mark, coverage(abs(x) - width, feather))
            if mark > 0:
                color = blend(color, MARK, mark)

            row += bytes(
                (
                    round(clamp(color[0] / 255) * 255),
                    round(clamp(color[1] / 255) * 255),
                    round(clamp(color[2] / 255) * 255),
                    round(alpha * 255),
                )
            )
        pixels += b'\x00' + row
    return bytes(pixels)


def write_png(path, size, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', header)
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )
    path.write_bytes(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(OUT / f'{size}.png', size, render(size))
        print(f'icons/{size}.png')


if __name__ == '__main__':
    main()
