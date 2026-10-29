import { useEffect, useRef, useState } from 'react';
import { ImportError, parseImport, planImport } from '@/core/backup';
import type { ParsedImport } from '@/core/backup';
import type { OtpAuthParams } from '@/core/otpauth';
import { decodeQrFile } from '@/platform/qr';
import { Button, SecondaryButton, TextButton } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  UiError,
  describeDiagnostic,
  describeNote,
  describeSkip,
  useErrorText,
  useMessage,
} from '../errors';
import { useT } from '../i18n';
import type { Translate } from '../i18n';
import { useAccounts, useAppStore } from '../store';

/**
 * 导入。
 *
 * 整个流程是**预览 → 确认 → 合并**，中间没有一步会自动落盘：
 * 一份文件里可能有别人的账户、三个月前作废的密钥、或者与本机同名但换了密钥的条目，
 * 这些都必须让人先看见再决定。合并规则见 `core/backup.ts` 的 `planImport`：
 * 只做加法，绝不覆盖。
 */
export function ImportScreen() {
  const t = useT();
  const errorText = useErrorText();
  const back = useAppStore((s) => s.back);
  const importAccounts = useAppStore((s) => s.importAccounts);
  const accounts = useAccounts();


  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'pick' | 'password' | 'preview'>('pick');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState('');
  /** 加密备份：等用户把密码填进来再解 */
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);

  const plan = parsed ? planImport(accounts, parsed) : null;

  const reset = () => {
    setStep('pick');
    setParsed(null);
    setPendingText(null);
    setPassword('');
    setText('');
    setError(null);
  };

  /** 统一入口：文件、拖放、粘贴、文本框最后都走到这里 */
  const read = async (content: string, withPassword?: string) => {
    setError(null);
    setBusy(true);
    try {
      const result = await parseImport(content, withPassword);
      setParsed(result);
      setStep('preview');
      setPendingText(null);
    } catch (cause) {
      if (cause instanceof ImportError && cause.reason === 'encrypted') {
        // 不是错误，只是缺一步：切到输密码
        setPendingText(content);
        setStep('password');
        return;
      }
      setError(errorText(cause, 'import'));
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      // 这两个前提只有界面知道（core 拿到的是字符串，看不见文件有多大）
      if (file.size === 0) throw new UiError('error.file-empty');
      if (file.size > 5 * 1024 * 1024) throw new UiError('error.file-too-large');
      // 图片当迁移二维码处理，其余一律按文本读
      const content = file.type.startsWith('image/') ? await decodeQrFile(file) : await file.text();
      await read(content);
    } catch (cause) {
      setError(errorText(cause, 'import'));
    } finally {
      setBusy(false);
    }
  };

  // 截图里的迁移码可以直接粘贴进来，和添加账户时的习惯保持一致
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith('image/'),
      );
      if (file) {
        event.preventDefault();
        void handleFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const confirm = async () => {
    if (!plan || plan.add.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await importAccounts(plan.add.map((entry) => entry.draft));
    } catch (cause) {
      setError(errorText(cause, 'import'));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-4">
      <ScreenHeader
        title={t('import.title')}
        onBack={
          step === 'pick'
            ? back
            : () => {
                reset();
              }
        }
      />

      <div className="flex-1 px-4 py-4">
        {step === 'pick' && (
          <div className="space-y-3">
            <div
              className={`flex flex-col items-center justify-center rounded-[12px] border-2 border-dashed px-4 py-7 text-center transition-colors duration-150 ${
                dragging ? 'border-accent bg-accent/5' : 'border-separator'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void handleFile(event.dataTransfer.files[0]);
              }}
            >
              <p className="text-[13px] font-medium">{t('import.drop-title')}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                {t('import.drop-hint')}
              </p>
              <SecondaryButton
                className="mt-3 w-auto px-4"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {busy ? t('import.reading') : t('import.pick-file')}
              </SecondaryButton>
              <input
                ref={fileInput}
                type="file"
                accept=".json,.txt,.text,application/json,text/plain,image/*"
                className="hidden"
                onChange={(event) => {
                  void handleFile(event.target.files?.[0]);
                  // 清空 value，否则连续选同一个文件不会再次触发 change
                  event.target.value = '';
                }}
              />
            </div>

            <div className="border-t border-separator pt-3">
              <label htmlFor="import-text" className="mb-1.5 block text-[12px] font-medium text-fg-muted">
                {t('import.paste-label')}
              </label>
              <textarea
                id="import-text"
                value={text}
                rows={4}
                spellCheck={false}
                placeholder={t('import.paste-placeholder')}
                onChange={(event) => setText(event.target.value)}
                className="w-full resize-none rounded-[8px] bg-surface-alt px-3 py-2 font-digit text-[12px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
              />
              <div className="mt-2">
                <SecondaryButton disabled={busy || !text.trim()} onClick={() => void read(text)}>
                  {t('import.parse')}
                </SecondaryButton>
              </div>
            </div>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-fg">{t('import.password.body')}</p>
            <PasswordInput
              label={t('import.password.label')}
              value={password}
              // 一改密码就把上一次的"密码不对"收掉：否则输到一半还挂着红字，像是又错了
              onChange={(value) => {
                setPassword(value);
                setError(null);
              }}
              autoFocus
              disabled={busy}
              onEnter={() => {
                if (pendingText) void read(pendingText, password);
              }}
            />
            <Button
              disabled={busy || password.length === 0}
              onClick={() => {
                if (pendingText) void read(pendingText, password);
              }}
            >
              {busy ? t('import.decrypting') : t('import.decrypt')}
            </Button>
            <TextButton className="w-full" onClick={reset} disabled={busy}>
              {t('import.other-file')}
            </TextButton>
          </div>
        )}

        {step === 'preview' && plan && (
          <Preview plan={plan} onConfirm={() => void confirm()} busy={busy} onReset={reset} />
        )}

        {/* 这一句往往是「为什么没导入成功」的唯一解释，读屏要能立刻听到 */}
        {error && (
          <p role="alert" className="mt-3 text-[11px] leading-relaxed text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Preview({
  plan,
  busy,
  onConfirm,
  onReset,
}: {
  plan: ReturnType<typeof planImport>;
  busy: boolean;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const t = useT();
  const message = useMessage();
  /** 问题列表先全部折成句子，再决定显示几条 —— 免得"还有 N 条"那一行的算法和渲染各算一次 */
  const issues = plan.issues.map((issue) => message(describeDiagnostic(issue)));
  const shown = issues.slice(0, ISSUES_SHOWN);

  return (
    <div className="space-y-3">
      {plan.batch && (
        <p className="rounded-[8px] bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-fg">
          {t('import.batch', { index: plan.batch.index + 1, total: plan.batch.size })}
        </p>
      )}

      <div className="flex items-baseline gap-3 text-[12px]">
        <span className="text-fg">{t('import.count.add', { count: plan.add.length })}</span>
        {plan.skip.length > 0 && (
          <span className="text-fg-muted">{t('import.count.skip', { count: plan.skip.length })}</span>
        )}
        {plan.issues.length > 0 && (
          <span className="text-danger">{t('import.count.issues', { count: plan.issues.length })}</span>
        )}
      </div>

      {plan.add.length > 0 && (
        <ul className="divide-y divide-separator rounded-[10px] bg-surface-alt/50">
          {plan.add.map((entry) => (
            <li
              key={`${entry.draft.issuer}:${entry.draft.account}:${entry.draft.secret}`}
              className="px-3 py-2"
            >
              <PreviewRow draft={entry.draft} />
              {entry.note && (
                <p className="mt-1 text-[11px] leading-relaxed text-warn">
                  {message(describeNote(entry.note))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {plan.skip.length > 0 && (
        <details className="rounded-[8px] bg-surface-alt/40 px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-fg-muted">
            {t('import.skip-summary', { count: plan.skip.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {plan.skip.map((entry) => (
              <li
                key={`skip:${entry.draft.issuer}:${entry.draft.account}:${entry.draft.secret}`}
                className="text-[11px] leading-relaxed text-fg-muted"
              >
                {labelOf(entry.draft, t)} —— {message(describeSkip(entry.reason))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {issues.length > 0 && (
        <ul className="space-y-1 rounded-[8px] bg-danger/5 px-3 py-2">
          {shown.map((issue) => (
            <li key={issue} className="text-[11px] leading-relaxed text-danger">
              {issue}
            </li>
          ))}
          {issues.length > ISSUES_SHOWN && (
            <li className="text-[11px] leading-relaxed text-danger">
              {t('import.issues.more', { count: issues.length - ISSUES_SHOWN })}
            </li>
          )}
        </ul>
      )}

      <div className="space-y-1.5 pt-1">
        <Button disabled={busy || plan.add.length === 0} onClick={onConfirm}>
          {busy ? t('import.importing') : t('import.confirm', { count: plan.add.length })}
        </Button>
        <TextButton className="w-full" onClick={onReset} disabled={busy}>
          {t('import.reset')}
        </TextButton>
      </div>

      {plan.add.length === 0 && (
        <p className="text-[11px] leading-relaxed text-fg-muted">{t('import.nothing-new')}</p>
      )}
    </div>
  );
}

/** 问题列表超过这个数就折起来，剩下的只报个数 —— 一屏全铺开会把「确认导入」挤出视野 */
const ISSUES_SHOWN = 6;

/** 预览里只显示名字与参数，**绝不显示密钥**：这一屏可能会被截图、被旁边的人看到 */
function PreviewRow({ draft }: { draft: OtpAuthParams }) {
  const t = useT();
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="truncate text-[12px] text-fg">{labelOf(draft, t)}</span>
      <span className="shrink-0 font-digit text-[11px] text-fg-muted">
        {draft.period === 30
          ? t('draft.meta', { algorithm: draft.algorithm, digits: draft.digits })
          : t('draft.meta.period', {
              algorithm: draft.algorithm,
              digits: draft.digits,
              period: draft.period,
            })}
      </span>
    </div>
  );
}

function labelOf(draft: OtpAuthParams, t: Translate): string {
  if (draft.issuer && draft.account) {
    return t('name.dot-joined', { issuer: draft.issuer, account: draft.account });
  }
  return draft.issuer || draft.account || t('common.unnamed');
}
