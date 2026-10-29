import { useState } from 'react';
import { MIN_PASSWORD_LENGTH, checkPassword } from '@/core/crypto';
import { PasswordInput } from './PasswordInput';
import { PrimaryButton } from './Button';

function defaultDescribe(cause: unknown): string {
  return cause instanceof Error ? cause.message : '设置失败，请重试';
}

/**
 * 设置密码的表单。首次引导和"用恢复码重设密码"共用一份：
 * 两处的校验规则、提示文案必须完全一样，分开写迟早会漂。
 */
export function SetPasswordForm({
  onSubmit,
  submitLabel = '设置密码',
  busy = false,
  describeError = defaultDescribe,
}: {
  onSubmit: (password: string) => Promise<void>;
  submitLabel?: string;
  busy?: boolean;
  /** 把异常翻译成人话。默认取 message，调用方可换成更具体的说法 */
  describeError?: (cause: unknown) => string;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const strength = checkPassword(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const disabled = busy || working || !strength.ok || confirm !== password;

  const submit = async () => {
    if (disabled) return;
    setWorking(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-3">
      <PasswordInput
        label="密码"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        autoFocus
        hint={`至少 ${MIN_PASSWORD_LENGTH} 位；不需要大小写数字混搭`}
        error={password.length > 0 && !strength.ok ? strength.issues.join('；') : null}
        onEnter={() => void submit()}
      />
      <PasswordInput
        label="再输一次"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        error={mismatch ? '两次输入不一致' : null}
        onEnter={() => void submit()}
      />

      {error && <p className="text-[11px] leading-relaxed text-danger">{error}</p>}

      <PrimaryButton disabled={disabled} onClick={() => void submit()}>
        {working ? '处理中…' : submitLabel}
      </PrimaryButton>

      <p className="text-[11px] leading-relaxed text-fg-muted">
        密码只用来在本机解锁，不会被上传，也没有人能帮你重置。
      </p>
    </div>
  );
}
