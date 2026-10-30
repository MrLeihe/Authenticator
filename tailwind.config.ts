import type { Config } from 'tailwindcss';

/**
 * 色板来自实测的 iOS systemGray 全套（见 SPEC §5.4）。
 * 所有颜色都是 `rgb(var(--x) / <alpha-value>)`，数值只写在 globals.css 里。
 * 组件中禁止出现十六进制色值 —— 便于后续整体换肤与暗色统一。
 */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 语义色（组件优先用这些）
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-alt': 'rgb(var(--surface-alt) / <alpha-value>)',
        // 账户行 hover 底。单独一档 token，就是为了能比 --bg 深：
        // 直接用 surface-alt/60 叠在白卡上会正好等于页面底色，行的轮廓会消失
        'row-hover': 'rgb(var(--row-hover) / <alpha-value>)',
        separator: 'rgb(var(--separator) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        // 分组标题用：比 fg 淡、比 fg-muted 实
        'fg-secondary': 'rgb(var(--fg-secondary) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-press': 'rgb(var(--accent-press) / <alpha-value>)',
        // 验证码正文/圆环专用：暗色下要比按钮蓝更亮，否则黑底上数字发糊
        code: 'rgb(var(--code) / <alpha-value>)',
        // 倒计时环的进度色与环心数字色（灰色，不与验证码争视线）
        tick: 'rgb(var(--tick) / <alpha-value>)',
        'tick-track': 'rgb(var(--tick-track) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        // 空态第三张卡的图标色（只有一串密钥那一路）
        violet: 'rgb(var(--violet) / <alpha-value>)',
        // 空态第四张卡的图标色（从别的应用/备份文件迁移）。
        // 四张卡要用四种色相才分得开，紫已经给了密钥，这一路只能再开一档青
        teal: 'rgb(var(--teal) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        digit: ['var(--digit-font)'],
      },
      borderRadius: {
        input: 'var(--r-input)',
        card: 'var(--r-card)',
      },
      fontSize: {
        digit: ['24px', { lineHeight: '1.2', letterSpacing: '0.6px' }],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // 空态用"淡入 + 6px 上浮"。位移只给 6px 不是随手取的：
        // 弹窗可见高度只有 300–500px，参考实现那套 100px 位移在这里
        // 占掉四分之一屏，看起来是画面在跳，不是内容浮起来。
        // 同样刻意用 transform 而不是 top —— 后者每帧触发布局。
        // 缓动沿用参考实现统一的 cubic-bezier(.2,.8,.2,1)：
        // 快进缓出，尾巴软着陆，比系统 ease-out 更跟手
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // 子页面整屏入场：参考实现是 8px 上浮（sheetIn），不是纯淡入。
        // 位移只有 8px，因为子界面是"换了一层内容"，不是内容自己冒出来，
        // 位移太大会有"整屏在跳"的错觉
        'sheet-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-6px)' },
          '75%': { transform: 'translateX(6px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        // backwards 是必须的：交错入场时，后面的卡在 delay 期间若没有 backwards
        // 会先以最终态（不透明）闪一下，delay 结束后再跳回 from 帧重播 —— 画面会抖。
        // backwards 让它们在等待期就保持 from 帧的"透明 + 上移"
        'rise-in': 'rise-in 260ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        'sheet-in': 'sheet-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        shake: 'shake 300ms ease-in-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
