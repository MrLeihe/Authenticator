import { useState } from 'react';
import { createEncryptedExport, exportAccountsToText } from '@/core/backup';
import { checkPassword } from '@/core/crypto';
import { downloadText, exportFileName } from '@/platform/files';
import { Button, SecondaryButton } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/TextInput';
import { useAccounts, useAppStore } from '../store';

/**
 * 导出。
 *
 * 两种格式对应两种完全不同的使用场景，所以放在最前面让用户选：
 * - **加密文件**：给"换电脑 / 重装"用，保险库密码对它无效，得另设一个导出密码。
 * - **明文文本**：给"搬去别的验证器"用。这东西等于把密钥原样交出去，
 *   所以必须在按钮上面把后果写清楚，而不是藏在帮助文档里。
 */
export function ExportScreen({ from }: { from?: 'settings' | undefined }) {
  const closeSheet = useAppStore((s) => s.closeSheet);
  const openSheet = useAppStore((s) => s.openSheet);
  const accounts = useAccounts();

  // 从设置里进来的就回设置：导完一次还可能在同一个地方接着导入
  const back = from === 'settings' ? () => openSheet({ kind: 'settings' }) : closeSheet;

  const [mode, setMode] = useState<'encrypted' | 'plain'>('encrypted');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const empty = accounts.length === 0;
  const check = checkPassword(password);
  const canExport = !busy && !empty && (mode === 'plain' || check.ok);

  const run = async () => {
    setError(null);
    setDone(null);
    if (mode === 'encrypted' && password !== confirm) {
      setError('两次输入的导出密码不一致');
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
      setDone(`已导出 ${accounts.length} 个账户到 ${name}，在浏览器的下载目录里。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-4">
      <ScreenHeader title="导出" onBack={back} />

      <div className="space-y-4 px-4 py-4">
        {empty ? (
          <p className="text-[12px] leading-relaxed text-fg-muted">
            还没有账户，没有可以导出的东西。先添加一个账户再来。
          </p>
        ) : (
          <>
            <Segmented
              label="导出格式"
              value={mode}
              onChange={(next) => {
                setMode(next);
                setError(null);
                setDone(null);
              }}
              options={[
                { value: 'encrypted' as const, label: '加密文件' },
                { value: 'plain' as const, label: '明文文本' },
              ]}
            />

            {mode === 'encrypted' ? (
              <>
                <PasswordInput
                  label="导出密码"
                  value={password}
                  onChange={setPassword}
                  hint="至少 8 位。这个密码和保险库密码无关，是打开这份文件要用的"
                  autoComplete="new-password"
                  disabled={busy}
                />
                <PasswordInput
                  label="再输一次"
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                  disabled={busy}
                />
                <p className="text-[11px] leading-relaxed text-fg-muted">
                  导出的是一份可以离开这台电脑的备份：它单独设密码，
                  所以重装扩展、换台电脑之后也打得开。反过来，
                  <span className="text-fg">这个密码丢了，这份文件就再也打不开了</span>
                  —— 我们没有任何办法帮你恢复。
                </p>
              </>
            ) : (
              <div className="rounded-[8px] bg-warn/10 px-3 py-2">
                <p className="text-[11px] leading-relaxed text-fg">
                  明文文件里是完整的密钥。<span className="font-medium">任何拿到这个文件的人都能生成你的验证码</span>
                  ，也不需要你的密码。只在要搬去别的验证器时用，用完就删掉，
                  别放进网盘、聊天记录或者邮件草稿。
                </p>
              </div>
            )}

            <Button disabled={!canExport} onClick={() => void run()}>
              {busy ? '正在导出…' : `导出 ${accounts.length} 个账户`}
            </Button>

            {!check.ok && mode === 'encrypted' && password.length > 0 && (
              <p className="text-[11px] leading-relaxed text-danger">{check.issues.join('；')}</p>
            )}
          </>
        )}

        {error && <p className="text-[11px] leading-relaxed text-danger">{error}</p>}
        {done && <p className="text-[11px] leading-relaxed text-fg">{done}</p>}

        {!empty && (
          <div className="border-t border-separator pt-3">
            <SecondaryButton onClick={back}>导出完了，返回</SecondaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
