import { useEffect, useRef, useState } from 'react';
import { CryptoError } from '@/core/crypto';
import { clearLockout, readLockout, recordFailure, remainingMs } from '@/platform/lockout';
import { PasswordInput } from '../components/PasswordInput';
import { PrimaryButton, TextButton } from '../components/Button';
import { SetPasswordForm } from '../components/SetPasswordForm';
import { KeyIcon, LockIcon } from '../components/Icons';
import { describeError, useMessage } from '../errors';
import type { Message } from '../errors';
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
  const message = useMessage();
  const canRecover = useAppStore((s) => s.canRecover);
  const notice = useAppStore((s) => s.notice);
  const unlock = useAppStore((s) => s.unlockWithPassword);
  const recover = useAppStore((s) => s.recoverWithCode);

  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const passwordBoxRef = useRef<HTMLDivElement>(null);
  const locked = lockedUntil !== null;

  // 失败计数与锁定到期时间存在会话级存储里，不跟着组件走：
  // 弹窗一关 JS 环境就销毁，只放 state 的话"关掉再打开"就把计数清零了，
  // 那这条减速带等于不存在。原因看 platform/lockout.ts 里的注释
  useEffect(() => {
    let cancelled = false;
    void readLockout().then((state) => {
      if (cancelled) return;
      const left = remainingMs(state);
      setRemaining(Math.ceil(left / 1000));
      setLockedUntil(left > 0 ? state.until : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 锁定倒计时。每 500ms 刷一次，界面上的秒数不会跳格
  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setLockedUntil(null);
        // 到期就把记录抹掉：否则下次打开还会看到"已锁定 0 秒"的空壳
        void clearLockout();
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  // 先摘类再强制重排，同一段动画才能连续重播；减少动效偏好由全局 CSS 关掉
  const shakePassword = () => {
    const node = passwordBoxRef.current;
    if (!node) return;
    node.classList.remove('animate-shake');
    void node.offsetWidth;
    node.classList.add('animate-shake');
  };

  const submitPassword = async () => {
    if (busy || locked || password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      // 解锁成功就把失败记录清零，别让上一次的进度留到下一次上锁之后
      await clearLockout();
    } catch (cause) {
      setError(describeError(cause));
      setPassword('');
      // 只有"密码不对"才计入锁定；存储损坏之类的错误不该锁住用户
      if (cause instanceof CryptoError && cause.reason === 'wrong-key') {
        const next = await recordFailure();
        if (next.until > 0) {
          setRemaining(Math.ceil(remainingMs(next) / 1000));
          setLockedUntil(next.until);
        }
        shakePassword();
      }
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
            <div ref={passwordBoxRef}>
              <PasswordInput
                label={t('lock.password')}
                value={password}
                onChange={setPassword}
                autoFocus
                disabled={busy || locked}
                error={error ? message(error) : null}
                onEnter={() => void submitPassword()}
              />
            </div>
            {locked && (
              <p className="mt-2 text-[11px] leading-relaxed text-warn" role="alert">
                {t('lock.locked', { seconds: remaining })}
              </p>
            )}
            <PrimaryButton
              className="mt-3"
              disabled={busy || locked || password.length === 0}
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
                  // 恢复码也是"证明了身份"，同样该把失败计数清零
                  await clearLockout();
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
