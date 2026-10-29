import { useState } from 'react';
import { SetPasswordForm } from '../components/SetPasswordForm';
import { PrimaryButton, TextButton } from '../components/Button';
import { ShieldIcon } from '../components/Icons';
import { useErrorText } from '../errors';
import { useT } from '../i18n';
import { useAppStore } from '../store';

/**
 * 首次引导。只做一件事：让用户决定要不要密码，然后建库。
 *
 * 「不要密码」也是一等选项，不是藏起来的高级设置：
 * 强制所有人设密码会让一部分人写 `12345678`，反而更不安全。
 */
export function OnboardScreen() {
  const t = useT();
  const errorText = useErrorText();
  const createVault = useAppStore((s) => s.createVault);
  const [mode, setMode] = useState<'intro' | 'password'>('intro');
  const [error, setError] = useState<string | null>(null);

  const start = async (password?: string) => {
    setError(null);
    try {
      await createVault(password);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg px-5 py-6">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-alt text-accent">
        <ShieldIcon size={22} />
      </span>
      <h1 className="text-[17px] font-semibold tracking-tight">{t('onboard.title')}</h1>
      <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">{t('onboard.body')}</p>

      {mode === 'intro' ? (
        <>
          <ul className="mt-4 space-y-2 text-[12px] leading-relaxed">
            <Point title={t('onboard.point.password.title')} body={t('onboard.point.password.body')} />
            <Point title={t('onboard.point.recovery.title')} body={t('onboard.point.recovery.body')} />
            <Point title={t('onboard.point.skip.title')} body={t('onboard.point.skip.body')} />
          </ul>

          {error && (
            <p role="alert" className="mt-3 text-[11px] text-danger">
              {error}
            </p>
          )}

          <div className="mt-auto space-y-2 pt-5">
            <PrimaryButton onClick={() => setMode('password')}>
              {t('onboard.set-password')}
            </PrimaryButton>
            <TextButton className="w-full py-1.5" onClick={() => void start()}>
              {t('onboard.skip')}
            </TextButton>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <SetPasswordForm onSubmit={(password) => start(password)} />
          <TextButton className="mt-3 w-full" onClick={() => setMode('intro')}>
            {t('common.back')}
          </TextButton>
        </div>
      )}
    </div>
  );
}

function Point({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-2">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span>
        <span className="font-medium">{title}</span>
        <span className="text-fg-muted"> — {body}</span>
      </span>
    </li>
  );
}
