import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * 三个按钮形态，全站只用这三个，避免每个界面各写一套高度和圆角。
 * 高度 42px / 圆角 10px 与列表页「添加账户」保持一致。
 */

export type ButtonVariant = 'primary' | 'secondary' | 'text';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
};

const BASE =
  'flex items-center justify-center gap-1.5 font-medium transition-colors duration-150 disabled:cursor-not-allowed';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'h-[42px] w-full rounded-[10px] bg-accent text-[13px] text-white hover:bg-accent-press disabled:bg-surface-alt disabled:text-fg-muted',
  // 次要动作：描边，不抢主按钮的注意力
  secondary:
    'h-[42px] w-full rounded-[10px] border border-separator bg-surface text-[13px] text-fg hover:bg-surface-alt disabled:opacity-50',
  // 文字按钮：用于「忘记密码」「取消」这类不该有按钮重量级的动作
  text: 'rounded-[6px] px-1 py-1 text-[12px] text-accent hover:text-accent-press disabled:opacity-50',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function PrimaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button variant="primary" {...props} />;
}

export function SecondaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button variant="secondary" {...props} />;
}

export function TextButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button variant="text" {...props} />;
}
