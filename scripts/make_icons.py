#!/usr/bin/env python3
"""生成扩展图标（16/32/48/128）：正方形白底 + 蓝色圆 + 白色挂锁。

挂锁是纯几何、圆角白底，锁梁是圆头倒 U 环、两腿插入锁体（与方案墙/页面内
AppMark 同款）。工具栏这一版把锁整体缩小约 20%，让锁在蓝圆里更居中、留白更多。

关键点：每个尺寸都用 Chrome 直接按目标像素栅格化，而不是画 512px 再用 sips
缩图。sips 的高质量缩放会把 16px 里那条 1.6px 的锁梁缝隙抗锯齿糊掉；直接渲染
让浏览器在 16px 栅格上做抗锯齿，缝隙才保得住。

依赖：Chrome（本机有）。页面内 AppMark（src/ui/components/Icons.tsx）是同一
几何的「蓝圆占满、无白底」版本，比例一致。

  python3 scripts/make_icons.py
"""

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'icons'

CHROME = shutil.which('google-chrome') or shutil.which(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
) or '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# viewBox 固定 100×100，尺寸由 width/height 决定，栅格化交给浏览器。
# SIZE 是占位符（避免和 HTML 里 CSS 的花括号在 .format 下冲突，用 replace 替换）。
# 白底是圆角矩形（rx=22）：Chrome 工具栏图标惯例是圆角白底，直角会显得"贴边"。
# 挂锁用「插入式」：圆头锁梁两腿插入锁体，和方案墙/页面内 AppMark 同款，但整体缩小约 20%
# （锁体 44→34 宽、锁梁 stroke 10→8），让锁在蓝圆里留出更多呼吸空间。
SVG = """<svg width="SIZE" height="SIZE" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" rx="22" fill="#fff"/>
  <circle cx="50" cy="50" r="42" fill="#007AFF"/>
  <path d="M38 48 v-7 a12 12 0 0 1 24 0 v7" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
  <rect x="33" y="48" width="34" height="24" rx="7" fill="#fff"/>
</svg>"""

HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;padding:0;background:transparent}
svg{display:block}
</style>
</head>
<body>{svg}</body>
</html>
"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        svg = SVG.replace('SIZE', str(size))
        tmp = Path(f'/tmp/authenticator-icon-{size}.html')
        tmp.write_text(HTML.replace('{svg}', svg))
        out = OUT / f'{size}.png'
        subprocess.run(
            [
                CHROME,
                '--headless=new',
                '--no-sandbox',
                '--disable-gpu',
                '--hide-scrollbars',
                '--force-device-scale-factor=1',
                '--default-background-color=00000000',
                f'--window-size={size},{size}',
                '--virtual-time-budget=3000',
                f'--screenshot={out}',
                f'file://{tmp}',
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print(f'icons/{size}.png')


if __name__ == '__main__':
    main()
