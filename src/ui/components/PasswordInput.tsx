import { useId, useState } from 'react';
import { EyeIcon, EyeOffIcon } from './Icons';

/**
 * 密码输入框。刻意不引 UI 库：需要的只是"眼睛图标切换明文"这一件事，
 * 而 `type="password"` 的浏览器自动填充行为必须保留，所以 input 本身不做任何包装。
 */
export function PasswordInput({
  label,
  value,
  onChange,
  hint,
  error,
  autoFocus,
  autoComplete = 'current-password',
  disabled,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  autoFocus?: boolean;
  autoComplete?: 'current-password' | 'new-password';
  disabled?: boolean;
  onEnter?: () => void;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-fg-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onEnter) onEnter();
          }}
          className={`h-[42px] w-full rounded-[8px] bg-surface-alt pl-3 pr-10 text-[14px] text-fg outline-none transition-shadow placeholder:text-fg-muted disabled:opacity-60 ${
            error ? 'ring-2 ring-danger/60' : 'focus:ring-2 focus:ring-accent/40'
          }`}
        />
        <button
          type="button"
          // 眼睛按钮不进 Tab 序列：键盘用户按 Enter 就该提交，不该先撞上一个装饰性按钮
          tabIndex={-1}
          aria-label={visible ? '隐藏密码' : '显示密码'}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[6px] p-2 text-fg-muted transition-colors duration-150 hover:text-fg"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
        </button>
      </div>
      {(error || hint) && (
        <p
          id={`${id}-note`}
          className={`mt-1.5 text-[11px] leading-relaxed ${error ? 'text-danger' : 'text-fg-muted'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
