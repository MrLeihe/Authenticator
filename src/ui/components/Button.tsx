import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * 三个按钮形态，全站只用这三个，避免每个界面各写一套高度和圆角。
 * 高度 42px / 圆角 10px 与列表页「添加账户」保持一致。
 */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

const BASE =
  'flex w-full items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed';

export function PrimaryButton({ children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${BASE} h-[42px] bg-accent text-white hover:bg-accent-press disabled:bg-surface-alt disabled:text-fg-muted ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 次要动作：描边，不抢主按钮的注意力 */
export function SecondaryButton({ children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${BASE} h-[42px] border border-separator bg-surface text-fg hover:bg-surface-alt disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 文字按钮：用于「忘记密码」「返回」这类不该有按钮重量级的动作 */
export function TextButton({ children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`rounded-[6px] px-1 py-1 text-[12px] font-medium text-accent transition-colors duration-150 hover:text-accent-press disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
