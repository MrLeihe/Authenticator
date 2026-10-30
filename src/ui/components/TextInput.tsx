import { useId } from 'react';
import type { ReactNode } from 'react';

/**
 * 普通文本输入框。和 `PasswordInput` 是同一套尺寸与状态色，
 * 区别只在没有"眼睛"、可以指定等宽字体（密钥和验证码必须等宽）。
 */
export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  autoFocus,
  mono,
  maxLength,
  inputMode,
  autoComplete = 'off',
  disabled,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  autoFocus?: boolean;
  mono?: boolean;
  maxLength?: number;
  inputMode?: 'text' | 'numeric';
  autoComplete?: string;
  disabled?: boolean;
  onEnter?: () => void;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        // 密钥与验证码不能自动纠错/自动大写，浏览器把它们改掉就等于改了数据
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) onEnter();
        }}
        className={`h-[42px] w-full rounded-[8px] bg-surface-alt px-3 text-[14px] text-fg outline-none transition-shadow placeholder:text-fg-muted disabled:opacity-60 ${
          mono ? 'font-digit tracking-wide' : ''
        } ${error ? 'ring-2 ring-danger/60' : 'focus:ring-2 focus:ring-accent/40'}`}
      />
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

/**
 * 分段选择器：算法、位数、周期这类"三选一"用它，比下拉框少一次点击。
 *
 * label 可选：设置页把标题交给外层卡片行渲染，这里只出控件，
 * 否则标题会缩进到控件那一格，和同卡片里的其它行对不齐。
 * 没有可见 label 时必须传 ariaLabel，读屏仍要能报出这一组是什么。
 */
export function Segmented<T extends string | number>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label?: string;
  ariaLabel?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
}) {
  const groupLabel = label ?? ariaLabel;
  return (
    <div>
      {label && (
        <span className="mb-1.5 block text-[12px] font-medium text-fg-muted">{label}</span>
      )}
      <div
        className="flex rounded-[9px] bg-surface-alt p-[3px]"
        role="group"
        aria-label={groupLabel}
      >
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={value === option.value}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
              value === option.value
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg'
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
