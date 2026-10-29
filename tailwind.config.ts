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
        separator: 'rgb(var(--separator) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-press': 'rgb(var(--accent-press) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
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
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-6px)' },
          '75%': { transform: 'translateX(6px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        shake: 'shake 300ms ease-in-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
