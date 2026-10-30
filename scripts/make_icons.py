#!/usr/bin/env python3
"""生成扩展图标（16/32/48/128）。

不引第三方图形库：形状用有符号距离场算覆盖率，超采样代替抗锯齿，
再手工拼 PNG（zlib + CRC）。这样图标永远可以按同一份几何重画，
也不会在仓库里留下一个只能靠设计软件改的二进制。

默认图案是二维码：白色圆角磁贴上三块定位图案 + 一组数据模块，四色取自
Google —— 左上蓝、右上红、左下绿，数据模块黄。

  python3 scripts/make_icons.py               # 二维码版
  python3 scripts/make_icons.py --scheme=star # 四色六臂星版

网格按尺寸退化，否则小图标会糊成一团色点：

  48 / 128  15×15 单元，定位图案 7 单元（1:1:3:1:1 的真实 QR 比例）
  32        11×11 单元，定位图案 5 单元，环更厚
  16         7×7  单元，定位图案 3 单元，实心方块（再细化只剩像素噪点）
"""

import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'icons'

# Google 四色
BLUE = (0x42, 0x85, 0xF4)
RED = (0xEA, 0x43, 0x35)
YELLOW = (0xFB, 0xBC, 0x05)
GREEN = (0x34, 0xA8, 0x53)

TILE_TOP = (0xFF, 0xFF, 0xFF)
TILE_BOTTOM = (0xEC, 0xF1, 0xF8)

# 三块定位图案的左上角格子与配色（col, row, color）
FINDERS = (
    (0, 0, BLUE),
    (None, 0, RED),   # None = 贴右边缘，格子由网格宽度算
    (0, None, GREEN),  # None = 贴下边缘
)

# 数据模块：右下那块空区里散落的格子，坐标是 (col, row)。
# 手工挑的，密度参考真实 QR 的数据区 —— 太规则会像棋盘，太稀会显得空。
DATA_MODULES = {
    15: (
        (8, 8), (11, 8), (13, 8),
        (8, 9), (10, 9), (14, 9),
        (9, 10), (12, 10), (13, 10), (14, 10),
        (8, 11), (11, 11), (14, 11),
        (8, 12), (9, 12), (10, 12), (13, 12),
        (8, 13), (10, 13), (12, 13), (14, 13),
        (9, 14), (11, 14), (13, 14),
    ),
    11: (
        (6, 6), (8, 6), (10, 6),
        (7, 7), (9, 7),
        (6, 8), (8, 8), (10, 8),
        (7, 9), (9, 9),
        (6, 10), (8, 10), (10, 10),
    ),
    7: (
        (4, 4), (5, 4),   # 两个相邻点合成一条黄块：16px 上比散点干净
    ),
}


def clamp(value, low=0.0, high=1.0):
    return low if value < low else high if value > high else value


def mix(c1, c2, t):
    t = clamp(t)
    return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))


def sd_round_rect(x, y, half, radius):
    """中心在原点的圆角正方形（SDF）。"""
    qx = abs(x) - (half - radius)
    qy = abs(y) - (half - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def qr_metrics(size):
    """按尺寸选网格与定位图案大小，返回 (单元数, 定位图案单元数)。"""
    if size >= 48:
        return 15, 7
    if size > 24:
        return 11, 5
    return 7, 3


def qr_inner(size):
    """图案区半宽 / 磁贴半宽。四周留白让图标不像铺满的截图，但小图标没有
    多余像素可浪费，留白要一路收窄。"""
    if size <= 24:
        return 0.78
    if size <= 40:
        return 0.70
    return 0.655


def render_qr(size, ss=4, data_scale=0.47):
    """白色磁贴 + 三块定位图案 + 数据模块。"""
    n = size
    half = n / 2.0
    tile_radius = half * 0.235
    grid, pat = qr_metrics(n)

    inner = half * qr_inner(n)
    unit = 2.0 * inner / grid

    # 定位图案：外框、镂空、中心块的半宽
    outer = pat / 2.0 * unit
    if pat == 3:
        ring_half = 0.0
        center_half = 0.0
    elif pat == 7:
        ring_half = outer - 1.0 * unit
        center_half = 1.5 * unit
    else:
        ring_half = outer - 0.95 * unit
        center_half = 0.86 * unit
    r_outer = unit * 0.40
    r_ring = unit * 0.14
    r_center = unit * 0.28

    edge = grid - pat
    finders = []
    for col0, row0, color in FINDERS:
        col0 = edge if col0 is None else col0
        row0 = edge if row0 is None else row0
        cx = -inner + (col0 + pat / 2.0) * unit
        cy = -inner + (row0 + pat / 2.0) * unit
        finders.append((cx, cy, color))

    data = set(DATA_MODULES[grid])
    if n <= 24:
        data_scale = max(data_scale, 0.62)   # 工具栏上点太小就看不见了
    data_half = unit * data_scale
    data_radius = unit * 0.15

    inv_ss = 1.0 / (ss * ss)
    step = 1.0 / ss
    rows = bytearray()
    for py in range(n):
        row = bytearray()
        for px in range(n):
            sr = sg = sb = sa = 0.0
            for sy in range(ss):
                y = (py * ss + sy + 0.5) * step - half
                for sx in range(ss):
                    x = (px * ss + sx + 0.5) * step - half
                    if sd_round_rect(x, y, half, tile_radius) > 0:
                        continue
                    color = mix(TILE_TOP, TILE_BOTTOM, clamp((y + half) / n))

                    for cx, cy, pcolor in finders:
                        dx, dy = x - cx, y - cy
                        d = sd_round_rect(dx, dy, outer, r_outer)
                        if ring_half:
                            d = max(d, -sd_round_rect(dx, dy, ring_half, r_ring))
                        if d <= 0 or (center_half and sd_round_rect(dx, dy, center_half, r_center) <= 0):
                            color = pcolor
                            break
                    else:
                        if data:
                            col = int((x + inner) / unit)
                            rw = int((y + inner) / unit)
                            if (col, rw) in data:
                                cx = -inner + (col + 0.5) * unit
                                cy = -inner + (rw + 0.5) * unit
                                if sd_round_rect(x - cx, y - cy, data_half, data_radius) <= 0:
                                    color = YELLOW

                    sr += color[0]
                    sg += color[1]
                    sb += color[2]
                    sa += 1.0
            if sa:
                row += bytes(
                    (
                        round(clamp(sr / sa / 255) * 255),
                        round(clamp(sg / sa / 255) * 255),
                        round(clamp(sb / sa / 255) * 255),
                        round(sa * inv_ss * 255),
                    )
                )
            else:
                row += b'\x00\x00\x00\x00'
        rows += b'\x00' + row
    return bytes(rows)


# ---------------------------------------------------------------- 备选：六臂星

# (正方向角度, 正半色, 负半色)
BARS = (
    (270.0, BLUE, RED),
    (330.0, GREEN, YELLOW),
    (30.0, YELLOW, GREEN),
)


def star_metrics(size):
    """按尺寸给几何参数：小图标要更粗更满，否则工具栏上只剩几粒色点。"""
    n = size
    if n <= 24:
        return n * 0.072, n * 0.288
    if n <= 40:
        return n * 0.064, n * 0.280
    return n * 0.058, n * 0.272


def render_star(size, ss=4):
    """三根圆角条在中心交叠成六臂星。"""
    n = size
    half = n / 2.0
    radius = half * 0.235
    bar_r, arm_len = star_metrics(size)

    bars = []
    for deg, pos_color, neg_color in BARS:
        rad = math.radians(deg)
        bars.append((math.cos(rad) * arm_len, math.sin(rad) * arm_len, pos_color, neg_color))

    inv_ss = 1.0 / (ss * ss)
    step = 1.0 / ss
    rows = bytearray()
    for py in range(n):
        row = bytearray()
        for px in range(n):
            sr = sg = sb = sa = 0.0
            for sy in range(ss):
                y = (py * ss + sy + 0.5) * step - half
                for sx in range(ss):
                    x = (px * ss + sx + 0.5) * step - half
                    if sd_round_rect(x, y, half, radius) > 0:
                        continue
                    color = mix(TILE_TOP, TILE_BOTTOM, clamp((y + half) / n))
                    best = 1e9
                    bar_color = None
                    for dx, dy, pos_color, neg_color in bars:
                        # t 落在 [-1, 1] 是条上，超出就是两端的圆头之外
                        t = (x * dx + y * dy) / (dx * dx + dy * dy)
                        tc = -1.0 if t < -1.0 else (1.0 if t > 1.0 else t)
                        d = math.hypot(x - dx * tc, y - dy * tc) - bar_r
                        if d < best:
                            best = d
                            bar_color = pos_color if t >= 0 else neg_color
                    if best <= 0:
                        color = bar_color
                    sr += color[0]
                    sg += color[1]
                    sb += color[2]
                    sa += 1.0
            if sa:
                row += bytes(
                    (
                        round(clamp(sr / sa / 255) * 255),
                        round(clamp(sg / sa / 255) * 255),
                        round(clamp(sb / sa / 255) * 255),
                        round(sa * inv_ss * 255),
                    )
                )
            else:
                row += b'\x00\x00\x00\x00'
        rows += b'\x00' + row
    return bytes(rows)


SCHEMES = {'qr': render_qr, 'star': render_star}


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
    scheme = 'qr'
    for arg in sys.argv[1:]:
        if arg.startswith('--scheme='):
            scheme = arg.split('=', 1)[1]
    if scheme not in SCHEMES:
        raise SystemExit(f'unknown scheme: {scheme}（可选 {" / ".join(SCHEMES)}）')

    render = SCHEMES[scheme]
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(OUT / f'{size}.png', size, render(size))
        print(f'icons/{size}.png')


if __name__ == '__main__':
    main()
