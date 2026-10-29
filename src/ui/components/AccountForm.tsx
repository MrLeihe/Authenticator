import { useEffect, useState } from 'react';
import { base32Decode } from '@/core/base32';
import { formatCode, totp } from '@/core/totp';
import type { Algorithm } from '@/core/types';
import type { OtpAuthParams } from '@/core/otpauth';
import { useTick } from '../hooks/useTick';
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
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<OtpAuthParams>;
  submitLabel: string;
  onSubmit: (draft: OtpAuthParams) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [issuer, setIssuer] = useState(initial?.issuer ?? '');
  const [account, setAccount] = useState(initial?.account ?? '');
  const [secret, setSecret] = useState(initial?.secret ?? '');
  const [algorithm, setAlgorithm] = useState<Algorithm>(initial?.algorithm ?? 'SHA1');
  const [digits, setDigits] = useState<6 | 8>(initial?.digits ?? 6);
  const [period, setPeriod] = useState(String(initial?.period ?? 30));
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedSecret = secret.replace(/[\s-]/g, '').toUpperCase();
  const periodNumber = Number(period);
  const periodValid = /^\d+$/.test(period) && periodNumber >= 1 && periodNumber <= 3600;

  const submit = async () => {
    setError(null);
    if (!normalizedSecret) {
      setError('密钥不能为空');
      return;
    }
    try {
      if (base32Decode(normalizedSecret).length === 0) throw new Error('empty');
    } catch {
      setError('密钥不是合法的 base32，检查一下有没有漏字符');
      return;
    }
    if (!periodValid) {
      setError('周期必须是 1 到 3600 之间的整数秒');
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
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <TextInput
        label="发行方 / 网站"
        value={issuer}
        onChange={setIssuer}
        placeholder="例如 GitHub"
        autoFocus
        onEnter={() => void submit()}
      />
      <TextInput
        label="账户名"
        value={account}
        onChange={setAccount}
        placeholder="例如 you@example.com"
        onEnter={() => void submit()}
      />
      <TextInput
        label="密钥"
        value={secret}
        onChange={setSecret}
        placeholder="通常是 16 或 32 位字母数字"
        hint="网站给你的那串字母数字，空格和连字符可以保留"
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
          {advanced ? '收起高级选项' : '高级选项（算法 / 位数 / 周期）'}
        </Button>
      </div>

      {advanced && (
        <div className="space-y-3 rounded-[10px] bg-surface-alt/60 p-3">
          <Segmented
            label="算法"
            value={algorithm}
            onChange={setAlgorithm}
            options={[
              { value: 'SHA1' as Algorithm, label: 'SHA1' },
              { value: 'SHA256' as Algorithm, label: 'SHA256' },
              { value: 'SHA512' as Algorithm, label: 'SHA512' },
            ]}
          />
          <Segmented
            label="位数"
            value={digits}
            onChange={setDigits}
            options={[
              { value: 6 as const, label: '6 位' },
              { value: 8 as const, label: '8 位' },
            ]}
          />
          <TextInput
            label="周期（秒）"
            value={period}
            onChange={setPeriod}
            inputMode="numeric"
            error={period === '' || periodValid ? null : '只能是 1 到 3600 之间的整数'}
          />
          <p className="text-[11px] leading-relaxed text-fg-muted">
            不知道就不用改。绝大多数网站用 SHA1 / 6 位 / 30 秒。
          </p>
        </div>
      )}

      {error && <p className="text-[11px] leading-relaxed text-danger">{error}</p>}

      <div className="space-y-2 pt-1">
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? '保存中…' : submitLabel}
        </Button>
        <Button variant="text" className="w-full" onClick={onCancel} disabled={busy}>
          取消
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
        填入密钥后，这里会显示它此刻的验证码，方便你和手机上的码对一下。
      </p>
    );
  }
  if (state === 'invalid') {
    return (
      <p className="rounded-[8px] bg-danger/10 px-3 py-2 text-[11px] text-danger">
        密钥解不开，检查一下是不是少抄了几位
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-[8px] bg-surface-alt/60 px-3 py-2">
      <span className="text-[11px] text-fg-muted">
        {state ? '当前验证码，应和手机上一致' : '正在试算…'}
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
