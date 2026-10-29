import { useState } from 'react';
import { createEncryptedExport, exportAccountsToText } from '@/core/backup';
import { checkPassword } from '@/core/crypto';
import { downloadText, exportFileName } from '@/platform/files';
import { Button, SecondaryButton } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/TextInput';
import { describePasswordIssue, useErrorText, useMessage } from '../errors';
import { listSeparator, useLang, useT } from '../i18n';
import { useAccounts, useAppStore } from '../store';

/**
 * 导出。
 *
 * 两种格式对应两种完全不同的使用场景，所以放在最前面让用户选：
 * - **加密文件**：给"换电脑 / 重装"用，保险库密码对它无效，得另设一个导出密码。
 * - **明文文本**：给"搬去别的验证器"用。这东西等于把密钥原样交出去，
 *   所以必须在按钮上面把后果写清楚，而不是藏在帮助文档里。
 */
export function ExportScreen() {
  const t = useT();
  const lang = useLang();
  const message = useMessage();
  const errorText = useErrorText();
  const back = useAppStore((s) => s.back);
  const accounts = useAccounts();

  // 从设置里进来的就回设置：导完一次还可能在同一个地方接着导入

  const [mode, setMode] = useState<'encrypted' | 'plain'>('encrypted');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const empty = accounts.length === 0;
  const check = checkPassword(password);
  const canExport = !busy && !empty && (mode === 'plain' || check.ok);
  // 密码不合规的每一条都说清楚（「至少 8 位」这种要带上实际位数），别只说"太弱"
  const problems = check.issues.map((issue) => message(describePasswordIssue(issue)));
  const separator = listSeparator(lang);

  const run = async () => {
    setError(null);
    setDone(null);
    if (mode === 'encrypted' && password !== confirm) {
      setError(t('export.mismatch'));
      return;
    }
    setBusy(true);
    try {
      const name = exportFileName(mode === 'encrypted' ? 'json' : 'txt');
      if (mode === 'encrypted') {
        const text = await createEncryptedExport(accounts, password);
        downloadText(name, text, 'application/json');
      } else {
        downloadText(name, exportAccountsToText(accounts), 'text/plain');
      }
      setDone(t('export.done', { count: accounts.length, name }));
    } catch (cause) {
      setError(errorText(cause, 'import'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-4">
      <ScreenHeader title={t('export.title')} onBack={back} />

      <div className="space-y-4 px-4 py-4">
        {empty ? (
          <p className="text-[12px] leading-relaxed text-fg-muted">{t('export.empty')}</p>
        ) : (
          <>
            <Segmented
              label={t('export.format')}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setError(null);
                setDone(null);
              }}
              options={[
                { value: 'encrypted' as const, label: t('export.format.encrypted') },
                { value: 'plain' as const, label: t('export.format.plain') },
              ]}
            />

            {mode === 'encrypted' ? (
              <>
                <PasswordInput
                  label={t('export.password')}
                  value={password}
                  onChange={setPassword}
                  hint={t('export.password.hint')}
                  autoComplete="new-password"
                  disabled={busy}
                />
                <PasswordInput
                  label={t('export.password.confirm')}
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                  disabled={busy}
                />
                <p className="text-[11px] leading-relaxed text-fg-muted">
                  {t('export.encrypted.note')}
                </p>
                {/* 丢密码这件事单独一段、加重：它是这份文件唯一不可逆的后果 */}
                <p className="text-[11px] font-medium leading-relaxed text-fg">
                  {t('export.encrypted.warn')}
                </p>
              </>
            ) : (
              <div className="rounded-[8px] bg-warn/10 px-3 py-2">
                <p className="text-[11px] font-medium leading-relaxed text-fg">
                  {t('export.plain.warn')}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-fg">{t('export.plain.note')}</p>
              </div>
            )}

            <Button disabled={!canExport} onClick={() => void run()}>
              {busy ? t('export.running') : t('export.run', { count: accounts.length })}
            </Button>

            {!check.ok && mode === 'encrypted' && password.length > 0 && (
              <p className="text-[11px] leading-relaxed text-danger">{problems.join(separator)}</p>
            )}
          </>
        )}

        {error && <p className="text-[11px] leading-relaxed text-danger">{error}</p>}
        {done && <p className="text-[11px] leading-relaxed text-fg">{done}</p>}

        {!empty && (
          <div className="border-t border-separator pt-3">
            <SecondaryButton onClick={back}>{t('export.back')}</SecondaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
