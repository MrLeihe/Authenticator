import { useEffect, useRef, useState } from 'react';
import { ImportError, parseImport, planImport } from '@/core/backup';
import type { ParsedImport } from '@/core/backup';
import { CryptoError } from '@/core/crypto';
import type { OtpAuthParams } from '@/core/otpauth';
import { decodeQrFile } from '@/platform/qr';
import { Button, SecondaryButton, TextButton } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAccounts, useAppStore } from '../store';

/**
 * 导入。
 *
 * 整个流程是**预览 → 确认 → 合并**，中间没有一步会自动落盘：
 * 一份文件里可能有别人的账户、三个月前作废的密钥、或者与本机同名但换了密钥的条目，
 * 这些都必须让人先看见再决定。合并规则见 `core/backup.ts` 的 `planImport`：
 * 只做加法，绝不覆盖。
 */
export function ImportScreen({ from }: { from?: 'settings' | undefined }) {
  const closeSheet = useAppStore((s) => s.closeSheet);
  const openSheet = useAppStore((s) => s.openSheet);
  const importAccounts = useAppStore((s) => s.importAccounts);
  const accounts = useAccounts();

  const back = from === 'settings' ? () => openSheet({ kind: 'settings' }) : closeSheet;

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
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (file.size === 0) throw new Error('这个文件是空的');
      if (file.size > 5 * 1024 * 1024) throw new Error('文件太大了，备份文件一般在 1MB 以内');
      // 图片当迁移二维码处理，其余一律按文本读
      const content = file.type.startsWith('image/') ? await decodeQrFile(file) : await file.text();
      await read(content);
    } catch (cause) {
      setError(describe(cause));
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
      setError(describe(cause));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-4">
      <ScreenHeader
        title="导入"
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
              <p className="text-[13px] font-medium">把备份文件拖进来</p>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                支持本扩展导出的 .json、每行一条 otpauth 的 .txt，以及迁移二维码截图
              </p>
              <SecondaryButton
                className="mt-3 w-auto px-4"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {busy ? '读取中…' : '选择文件'}
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
                或者直接粘贴内容
              </label>
              <textarea
                id="import-text"
                value={text}
                rows={4}
                spellCheck={false}
                placeholder="otpauth://totp/… 一行一条，或整份 JSON"
                onChange={(event) => setText(event.target.value)}
                className="w-full resize-none rounded-[8px] bg-surface-alt px-3 py-2 font-digit text-[12px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
              />
              <div className="mt-2">
                <SecondaryButton disabled={busy || !text.trim()} onClick={() => void read(text)}>
                  解析内容
                </SecondaryButton>
              </div>
            </div>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-fg">
              这份备份是加密的，请输入<span className="font-medium">导出时设的密码</span>。
            </p>
            <PasswordInput
              label="导出密码"
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
              {busy ? '解密中…' : '解密并预览'}
            </Button>
            <TextButton className="w-full" onClick={reset} disabled={busy}>
              换一份文件
            </TextButton>
          </div>
        )}

        {step === 'preview' && plan && (
          <Preview plan={plan} onConfirm={() => void confirm()} busy={busy} onReset={reset} />
        )}

        {error && <p className="mt-3 text-[11px] leading-relaxed text-danger">{error}</p>}
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
  return (
    <div className="space-y-3">
      {plan.batch && (
        <p className="rounded-[8px] bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-fg">
          这是第 {plan.batch.index + 1} / {plan.batch.size} 张迁移码。账户多的时候
          Google Authenticator 会拆成好几张，其余的请再导入一次。
        </p>
      )}

      <div className="flex items-baseline gap-3 text-[12px]">
        <span className="text-fg">
          新增 <span className="font-semibold">{plan.add.length}</span> 条
        </span>
        {plan.skip.length > 0 && (
          <span className="text-fg-muted">已存在 {plan.skip.length} 条</span>
        )}
        {plan.issues.length > 0 && (
          <span className="text-danger">无法读取 {plan.issues.length} 条</span>
        )}
      </div>

      {plan.add.length > 0 && (
        <ul className="divide-y divide-separator rounded-[10px] bg-surface-alt/50">
          {plan.add.map((entry) => (
            <li key={`${entry.draft.issuer}:${entry.draft.account}:${entry.draft.secret}`} className="px-3 py-2">
              <PreviewRow draft={entry.draft} />
              {entry.note && (
                <p className="mt-1 text-[11px] leading-relaxed text-warn">{entry.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {plan.skip.length > 0 && (
        <details className="rounded-[8px] bg-surface-alt/40 px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-fg-muted">
            已存在、不会重复添加的 {plan.skip.length} 条
          </summary>
          <ul className="mt-2 space-y-1">
            {plan.skip.map((entry) => (
              <li
                key={`skip:${entry.draft.issuer}:${entry.draft.account}:${entry.draft.secret}`}
                className="text-[11px] leading-relaxed text-fg-muted"
              >
                {labelOf(entry.draft)} —— {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan.issues.length > 0 && (
        <ul className="space-y-1 rounded-[8px] bg-danger/5 px-3 py-2">
          {plan.issues.slice(0, 6).map((issue, index) => (
            <li key={`issue:${index}`} className="text-[11px] leading-relaxed text-danger">
              {issue}
            </li>
          ))}
          {plan.issues.length > 6 && (
            <li className="text-[11px] leading-relaxed text-danger">
              还有 {plan.issues.length - 6} 条同类问题
            </li>
          )}
        </ul>
      )}

      <div className="space-y-1.5 pt-1">
        <Button disabled={busy || plan.add.length === 0} onClick={onConfirm}>
          {busy ? '导入中…' : `确认导入 ${plan.add.length} 条`}
        </Button>
        <TextButton className="w-full" onClick={onReset} disabled={busy}>
          重新选择
        </TextButton>
      </div>

      {plan.add.length === 0 && (
        <p className="text-[11px] leading-relaxed text-fg-muted">
          没有需要新增的账户。已有的不会被覆盖，可以放心返回。
        </p>
      )}
    </div>
  );
}

/** 预览里只显示名字与参数，**绝不显示密钥**：这一屏可能会被截图、被旁边的人看到 */
function PreviewRow({ draft }: { draft: OtpAuthParams }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="truncate text-[12px] text-fg">{labelOf(draft)}</span>
      <span className="shrink-0 font-digit text-[11px] text-fg-muted">
        {draft.algorithm} · {draft.digits} 位{draft.period === 30 ? '' : ` · ${draft.period} 秒`}
      </span>
    </div>
  );
}

function labelOf(draft: OtpAuthParams): string {
  if (draft.issuer && draft.account) return `${draft.issuer} · ${draft.account}`;
  return draft.issuer || draft.account || '(未命名账户)';
}

function describe(cause: unknown): string {
  // 密码错与文件损坏在 GCM 下不可区分，别假装能分得开
  if (cause instanceof CryptoError && cause.reason === 'wrong-key') {
    return '密码不对，或者这份文件已经损坏';
  }
  if (cause instanceof Error) return cause.message;
  return '导入失败，请换一份文件试试';
}
