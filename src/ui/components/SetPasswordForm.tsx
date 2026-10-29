import { useState } from 'react';
import { MIN_PASSWORD_LENGTH, checkPassword } from '@/core/crypto';
import { describePasswordIssue, useErrorText, useMessage } from '../errors';
import { listSeparator, useLang, useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { PasswordInput } from './PasswordInput';
import { PrimaryButton } from './Button';

/**
 * 设置密码的表单。首次引导和"用恢复码重设密码"共用一份：
 * 两处的校验规则、提示文案必须完全一样，分开写迟早会漂。
 */
export function SetPasswordForm({
  onSubmit,
  submitKey = 'password.submit-default',
  busy = false,
}: {
  onSubmit: (password: string) => Promise<void>;
  submitKey?: MessageKey;
  busy?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const message = useMessage();
  const errorText = useErrorText();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const strength = checkPassword(password);
  const problems = strength.issues.map((issue) => message(describePasswordIssue(issue)));
  const mismatch = confirm.length > 0 && confirm !== password;
  const disabled = busy || working || !strength.ok || confirm !== password;

  const submit = async () => {
    if (disabled) return;
    setWorking(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-3">
      <PasswordInput
        label={t('password.title')}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        autoFocus
        hint={t('password.hint', { min: MIN_PASSWORD_LENGTH })}
        error={password.length > 0 && !strength.ok ? problems.join(listSeparator(lang)) : null}
        onEnter={() => void submit()}
      />
      <PasswordInput
        label={t('password.confirm')}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        error={mismatch ? t('password.mismatch') : null}
        onEnter={() => void submit()}
      />

      {error && (
        <p role="alert" className="text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      <PrimaryButton disabled={disabled} onClick={() => void submit()}>
        {working ? t('common.busy') : t(submitKey)}
      </PrimaryButton>

      <p className="text-[11px] leading-relaxed text-fg-muted">{t('password.note')}</p>
    </div>
  );
}
