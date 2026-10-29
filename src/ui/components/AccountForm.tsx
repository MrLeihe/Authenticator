import { useEffect, useState } from 'react';
import { base32Decode } from '@/core/base32';
import { formatCode, totp } from '@/core/totp';
import type { Algorithm } from '@/core/types';
import type { OtpAuthParams } from '@/core/otpauth';
import { useTick } from '../hooks/useTick';
import { describeError, useMessage } from '../errors';
import type { Message } from '../errors';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { Button } from './Button';
import { Segmented, TextInput } from './TextInput';

/**
 * 新增与编辑共用的表单。
 *
 * 保存前必须**试算一次**：密钥抄错一个字符，验证码就会永远不对，
 * 而用户往往要等到下次登录失败才发现。这里把当前验证码直接打在表单里，
 * 能对上就是对的。
 */
export function AccountForm({
  initial,
  submitKey,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<OtpAuthParams>;
  submitKey: MessageKey;
  onSubmit: (draft: OtpAuthParams) => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useT();
  const message = useMessage();
  const [issuer, setIssuer] = useState(initial?.issuer ?? '');
  const [account, setAccount] = useState(initial?.account ?? '');
  const [secret, setSecret] = useState(initial?.secret ?? '');
  const [algorithm, setAlgorithm] = useState<Algorithm>(initial?.algorithm ?? 'SHA1');
  const [digits, setDigits] = useState<6 | 8>(initial?.digits ?? 6);
  const [period, setPeriod] = useState(String(initial?.period ?? 30));
  const [advanced, setAdvanced] = useState(false);
  // 存键不存句子：表单开着的时候用户可能切换语言，句子得跟着变
  const [error, setError] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedSecret = secret.replace(/[\s-]/g, '').toUpperCase();
  const periodNumber = Number(period);
  const periodValid = /^\d+$/.test(period) && periodNumber >= 1 && periodNumber <= 3600;

  const submit = async () => {
    setError(null);
    if (!normalizedSecret) {
      setError({ key: 'form.error.empty-secret' });
      return;
    }
    try {
      if (base32Decode(normalizedSecret).length === 0) throw new Error('empty');
    } catch {
      setError({ key: 'form.error.bad-secret' });
      return;
    }
    if (!periodValid) {
      setError({ key: 'form.error.period' });
      return;
    }

    setBusy(true);
    try {
      await onSubmit({
        issuer: issuer.trim(),
        account: account.trim(),
        secret: normalizedSecret,
        algorithm,
        digits,
        period: periodNumber,
      });
    } catch (cause) {
      // 认不出来的失败（配额满、权限被收走）统一说"再试一次"，
      // 底下那句英文报错对用户没有用
      const described = describeError(cause);
      setError(described.key === 'error.unknown' ? { key: 'form.save-failed' } : described);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <TextInput
        label={t('field.issuer')}
        value={issuer}
        onChange={setIssuer}
        placeholder={t('field.issuer.placeholder')}
        autoFocus
        onEnter={() => void submit()}
      />
      <TextInput
        label={t('field.account')}
        value={account}
        onChange={setAccount}
        placeholder={t('field.account.placeholder')}
        onEnter={() => void submit()}
      />
      <TextInput
        label={t('field.secret')}
        value={secret}
        onChange={setSecret}
        placeholder={t('field.secret.placeholder')}
        hint={t('field.secret.hint')}
        mono
        onEnter={() => void submit()}
      />

      <CodePreview
        secret={normalizedSecret}
        algorithm={algorithm}
        digits={digits}
        period={periodValid ? periodNumber : 30}
      />

      <div>
        <Button
          variant="text"
          className="w-full"
          onClick={() => setAdvanced((open) => !open)}
          aria-expanded={advanced}
        >
          {t(advanced ? 'form.advanced.close' : 'form.advanced.open')}
        </Button>
      </div>

      {advanced && (
        <div className="space-y-3 rounded-[10px] bg-surface-alt/60 p-3">
          <Segmented
            label={t('field.algorithm')}
            value={algorithm}
            onChange={setAlgorithm}
            options={[
              { value: 'SHA1' as Algorithm, label: 'SHA1' },
              { value: 'SHA256' as Algorithm, label: 'SHA256' },
              { value: 'SHA512' as Algorithm, label: 'SHA512' },
            ]}
          />
          <Segmented
            label={t('field.digits')}
            value={digits}
            onChange={setDigits}
            options={[
              { value: 6 as const, label: t('field.digits.6') },
              { value: 8 as const, label: t('field.digits.8') },
            ]}
          />
          <TextInput
            label={t('field.period')}
            value={period}
            onChange={setPeriod}
            inputMode="numeric"
            error={period === '' || periodValid ? null : t('field.period.error')}
          />
          <p className="text-[11px] leading-relaxed text-fg-muted">{t('form.advanced.hint')}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[11px] leading-relaxed text-danger">
          {message(error)}
        </p>
      )}

      <div className="space-y-2 pt-1">
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>
          {t(busy ? 'form.saving' : submitKey)}
        </Button>
        <Button variant="text" className="w-full" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * 实时试算。输入密钥的同时这里就在刷新验证码 ——
 * 用户拿它跟手机 App 上的码对一眼，就知道有没有抄错。
 */
function CodePreview({
  secret,
  algorithm,
  digits,
  period,
}: {
  secret: string;
  algorithm: Algorithm;
  digits: 6 | 8;
  period: number;
}) {
  const t = useT();
  const now = useTick(1000);
  const [state, setState] = useState<{ code: string; remaining: number } | 'invalid' | null>(null);

  useEffect(() => {
    let alive = true;
    if (!secret) {
      setState(null);
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = base32Decode(secret);
      if (bytes.length === 0) throw new Error('empty');
    } catch {
      setState('invalid');
      return;
    }
    void totp(bytes, { algorithm, digits, period, now })
      .then((result) => {
        if (alive) setState({ code: result.code, remaining: result.remaining });
      })
      .catch(() => {
        if (alive) setState('invalid');
      });
    return () => {
      alive = false;
    };
  }, [secret, algorithm, digits, period, now]);

  if (!secret) {
    return (
      <p className="rounded-[8px] bg-surface-alt/60 px-3 py-2 text-[11px] text-fg-muted">
        {t('preview.empty')}
      </p>
    );
  }
  if (state === 'invalid') {
    return (
      <p className="rounded-[8px] bg-danger/10 px-3 py-2 text-[11px] text-danger">
        {t('preview.invalid')}
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-[8px] bg-surface-alt/60 px-3 py-2">
      <span className="text-[11px] text-fg-muted">
        {t(state ? 'preview.ready' : 'preview.calculating')}
      </span>
      <span className="flex items-baseline gap-2">
        <span className="code text-[17px] text-code" dir="ltr">
          {state ? formatCode(state.code) : '— — —'}
        </span>
        {state && <span className="text-[11px] tabular-nums text-fg-muted">{state.remaining}s</span>}
      </span>
    </div>
  );
}
