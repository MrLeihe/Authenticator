import { useState } from 'react';
import { PasswordInput } from '../components/PasswordInput';
import { PrimaryButton, TextButton } from '../components/Button';
import { SetPasswordForm } from '../components/SetPasswordForm';
import { KeyIcon, LockIcon } from '../components/Icons';
import { useErrorText } from '../errors';
import { useT } from '../i18n';
import { useAppStore } from '../store';

/**
 * 解锁页。两条路：密码、恢复码。
 *
 * 恢复码这条路要顺手把密码换掉：用户走到这里必然是因为密码想不起来了，
 * 不换的话下次还得再用一次恢复码。换掉之后新的恢复码立刻展示一次。
 */
export function LockScreen() {
  const t = useT();
  const errorText = useErrorText();
  const canRecover = useAppStore((s) => s.canRecover);
  const notice = useAppStore((s) => s.notice);
  const unlock = useAppStore((s) => s.unlockWithPassword);
  const recover = useAppStore((s) => s.recoverWithCode);

  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitPassword = async () => {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (cause) {
      setError(errorText(cause));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg px-5 py-7">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-alt text-accent">
        {mode === 'password' ? <LockIcon size={22} /> : <KeyIcon size={22} />}
      </span>

      <h1 className="text-[17px] font-semibold tracking-tight">
        {mode === 'password' ? t('lock.title') : t('lock.recovery.title')}
      </h1>
      <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
        {mode === 'password' ? t('lock.body') : t('lock.recovery.body')}
      </p>

      {notice && mode === 'password' && (
        <p className="mt-3 border-l-2 border-accent/50 pl-2.5 text-[11px] leading-relaxed text-fg-muted">
          {t(notice)}
        </p>
      )}

      <div className="mt-5">
        {mode === 'password' ? (
          <>
            <PasswordInput
              label={t('lock.password')}
              value={password}
              onChange={setPassword}
              autoFocus
              disabled={busy}
              error={error}
              onEnter={() => void submitPassword()}
            />
            <PrimaryButton
              className="mt-3"
              disabled={busy || password.length === 0}
              onClick={() => void submitPassword()}
            >
              {busy ? t('lock.unlocking') : t('lock.unlock')}
            </PrimaryButton>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="recovery-code"
                className="mb-1.5 block text-[12px] font-medium text-fg-muted"
              >
                {t('lock.recovery.label')}
              </label>
              <input
                id="recovery-code"
                value={code}
                onChange={(event) => setCode(formatRecoveryInput(event.target.value))}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="XXXX-XXXX-XXXX-XXXX-…"
                className="font-digit h-[42px] w-full rounded-[8px] bg-surface-alt px-3 text-[13px] tracking-wider text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
                style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
              />
            </div>

            <SetPasswordForm
              submitKey="lock.recovery.submit"
              busy={busy}
              onSubmit={async (newPassword) => {
                setBusy(true);
                try {
                  await recover(code, newPassword);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        )}
      </div>

      <div className="mt-auto pt-4">
        {canRecover ? (
          <TextButton
            className="w-full"
            onClick={() => {
              setMode(mode === 'password' ? 'recovery' : 'password');
              setError(null);
            }}
          >
            {mode === 'password' ? t('lock.forgot') : t('lock.back-to-password')}
          </TextButton>
        ) : (
          <p className="text-center text-[11px] leading-relaxed text-fg-muted">
            {t('lock.no-recovery')}
          </p>
        )}
      </div>
    </div>
  );
}

/** 边输边分组：既好看，也顺手挡掉粘贴进来的空格与多余横线 */
function formatRecoveryInput(raw: string): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 32);
  return (cleaned.match(/.{1,4}/g) ?? []).join('-');
}
