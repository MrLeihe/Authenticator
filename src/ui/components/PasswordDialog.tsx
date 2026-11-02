import { useState } from 'react';
import { checkPassword } from '@/core/crypto';
import { describeError, describePasswordIssue, useMessage } from '../errors';
import type { Message } from '../errors';
import { listSeparator, useLang, useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { useAppStore } from '../store';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { PasswordInput } from './PasswordInput';

/** 密码保护上的三个动作。三者只差「要不要当前密码」「有没有新密码」 */
export type PasswordAction = 'set' | 'change' | 'disable';

const TITLES: Record<PasswordAction, MessageKey> = {
  set: 'settings.password.set',
  change: 'settings.password.change',
  disable: 'settings.password.disable',
};

const SUBMITS: Record<PasswordAction, MessageKey> = {
  set: 'settings.password-submit',
  change: 'settings.password.change',
  disable: 'settings.disable-submit',
};

/**
 * 设置 / 修改 / 关闭密码。
 *
 * 三个动作共用一张表单：校验规则（长度、重复字符、两次一致）只写一遍。
 * 分开写的话，"改密码"那条路迟早会漏掉"改完要重新解锁"这句提醒。
 *
 * 做成浮层而不是在设置卡片里展开：展开会把下面所有分组顶下去，
 * 用户点「修改密码」之后既看不到自己改的是哪一项，也看不到改完还剩什么。
 */
export function PasswordDialog({
  action,
  onClose,
}: {
  action: PasswordAction;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const message = useMessage();
  const setPassword = useAppStore((s) => s.setPassword);
  const changePassword = useAppStore((s) => s.changePassword);
  const clearPassword = useAppStore((s) => s.clearPassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);

  const needsCurrent = action !== 'set';
  const needsNext = action !== 'disable';
  const strength = checkPassword(next);
  const problems = strength.issues.map((issue) => message(describePasswordIssue(issue)));
  const mismatch = confirm.length > 0 && confirm !== next;
  const blocked =
    busy ||
    (needsCurrent && current.length === 0) ||
    (needsNext && (!strength.ok || confirm !== next));

  const submit = async () => {
    if (blocked) return;
    setError(null);
    setBusy(true);
    try {
      if (action === 'set') await setPassword(next);
      else if (action === 'change') await changePassword(current, next);
      else await clearPassword(current);
      // 设密码/改密码会把库切到上锁态，这一层跟着整屏一起卸载，关不关都无所谓；
      // 关密码之后库还是解锁的，界面不会换 —— 那一次得自己收
      onClose();
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog label={t(TITLES[action])} onClose={onClose} dismissible={!busy} className="max-w-[340px]">
      <h2 className="text-center text-[16px] font-semibold tracking-tight">{t(TITLES[action])}</h2>

      {/* 三个动作各自要先说清后果，且只说这一句：设完要重新解锁一次、
          改完恢复码会换新的、关掉恢复码作废。写进输入框的 hint 会被
          「至少 8 位」占掉，只能放在标题下面 */}
      <p className="mt-2 text-center text-[12px] leading-relaxed text-fg-muted">
        {action === 'set' && t('settings.password.set-hint')}
        {action === 'change' && t('settings.password.change-hint')}
        {action === 'disable' && t('settings.password.disable-hint')}
      </p>

      <div className="mt-4 space-y-3">
        {needsCurrent && (
          <PasswordInput
            label={t('settings.current-password')}
            value={current}
            onChange={setCurrent}
            autoFocus
            disabled={busy}
            onEnter={() => void submit()}
          />
        )}
        {needsNext && (
          <>
            <PasswordInput
              label={t('settings.new-password')}
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              autoFocus={!needsCurrent}
              hint={t('password.hint-long')}
              error={next.length > 0 && !strength.ok ? problems.join(listSeparator(lang)) : null}
              disabled={busy}
              onEnter={() => void submit()}
            />
            <PasswordInput
              label={t('password.confirm')}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              error={mismatch ? t('password.mismatch') : null}
              disabled={busy}
              onEnter={() => void submit()}
            />
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-center text-[11px] leading-relaxed text-danger">
          {message(error)}
        </p>
      )}

      <div className="mt-5 space-y-2">
        <Button variant="primary" disabled={blocked} onClick={() => void submit()}>
          {busy ? t('common.busy') : t(SUBMITS[action])}
        </Button>
        <Button variant="text" className="w-full" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
