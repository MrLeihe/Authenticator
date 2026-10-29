import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ClipboardClear, Settings } from '@/core/types';
import { getExtensionVersion } from '@/platform/env';
import { Button, TextButton } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/TextInput';
import { useAppStore, useSettings } from '../store';

/**
 * 设置。
 *
 * 一条原则：**每一项都要能立刻看到效果**，没有"保存"按钮。
 * 设置本身就是数据的一部分（存在加密的 vault 里），改一项写一次。
 */
export function SettingsScreen() {
  const closeSheet = useAppStore((s) => s.closeSheet);
  const openSheet = useAppStore((s) => s.openSheet);
  const canRecover = useAppStore((s) => s.canRecover);
  const settings = useSettings();
  const setSettings = useAppStore((s) => s.setSettings);
  const showToast = useAppStore((s) => s.showToast);

  const update = (patch: Partial<Settings>) => {
    void setSettings(patch).catch((cause: unknown) => {
      showToast(cause instanceof Error ? cause.message : '保存设置失败', 'danger');
    });
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-4">
      <ScreenHeader title="设置" onBack={closeSheet} />

      <div className="space-y-5 px-4 py-4">
        <Section title="显示">
          <Segmented
            label="验证码显示方式"
            value={settings.view}
            onChange={(view) => update({ view })}
            options={[
              { value: 'normal' as const, label: '正常' },
              { value: 'compact' as const, label: '紧凑' },
              { value: 'masked' as const, label: '隐藏' },
            ]}
          />
          <Toggle
            label="显示账户首字母图标"
            hint="关掉之后列表更素净，宽度也更省"
            checked={settings.showInitials}
            onChange={(showInitials) => update({ showInitials })}
          />
          <Segmented
            label="主题"
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'system' as const, label: '跟随系统' },
              { value: 'light' as const, label: '浅色' },
              { value: 'dark' as const, label: '深色' },
            ]}
          />
        </Section>

        <Section title="排序">
          <Segmented
            label="列表顺序"
            value={settings.sortBy}
            onChange={(sortBy) => update({ sortBy })}
            options={[
              { value: 'manual' as const, label: '手动' },
              { value: 'issuer' as const, label: '按网站' },
              { value: 'name' as const, label: '按账户' },
            ]}
          />
          <p className="text-[11px] leading-relaxed text-fg-muted">
            只有「手动」能拖动排序。置顶的账户始终排在最前面。
          </p>
        </Section>

        <Section title="安全">
          <Segmented
            label="多久没操作自动上锁"
            value={settings.autoLockMinutes}
            onChange={(autoLockMinutes) => update({ autoLockMinutes })}
            options={[
              { value: 0 as const, label: '不锁' },
              { value: 5 as const, label: '5 分钟' },
              { value: 30 as const, label: '30 分钟' },
              { value: 120 as const, label: '2 小时' },
            ]}
          />
          <PasswordSection enabled={canRecover} />
        </Section>

        <Section title="剪贴板">
          <Segmented
            label="复制验证码后自动清空"
            value={settings.clipboardClearSeconds}
            onChange={(clipboardClearSeconds) => update({ clipboardClearSeconds })}
            options={[
              { value: 0 as ClipboardClear, label: '不清空' },
              { value: 15 as ClipboardClear, label: '15 秒' },
              { value: 30 as ClipboardClear, label: '30 秒' },
              { value: 60 as ClipboardClear, label: '60 秒' },
            ]}
          />
          <p className="text-[11px] leading-relaxed text-fg-muted">
            验证码在剪贴板里待得越久，越可能被别的程序读到。
          </p>
        </Section>

        <Section title="备份">
          <Toggle
            label="每天自动备份一份"
            hint="当天第一次改动时留一份快照，保留最近 7 份，只存在本机"
            checked={settings.autoBackup}
            onChange={(autoBackup) => update({ autoBackup })}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => openSheet({ kind: 'export', from: 'settings' })}>
              导出账户
            </Button>
            <Button variant="secondary" onClick={() => openSheet({ kind: 'import', from: 'settings' })}>
              导入账户
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-fg-muted">
            导出的文件可以搬到另一台电脑，或者重装扩展之后再用。
            导入只往里加：同一个密钥的账户会跳过，已有的永远不会被覆盖。
          </p>
        </Section>

        <Section title="关于">
          <dl className="space-y-1.5 text-[12px]">
            <Row label="版本" value={getExtensionVersion()} />
            <Row label="数据存放" value="仅本机，加密存储" />
            <Row label="网络请求" value="无" />
          </dl>
          <p className="text-[11px] leading-relaxed text-fg-muted">
            没有账号、没有云端、没有任何统计。验证码全部在本机算出来。
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
      />
      <span>
        <span className="block text-[12px] text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** 密码保护：开启 / 修改 / 关闭。三种状态互斥，用同一个面板切换。 */
function PasswordSection({ enabled }: { enabled: boolean }) {
  const setPassword = useAppStore((s) => s.setPassword);
  const changePassword = useAppStore((s) => s.changePassword);
  const clearPassword = useAppStore((s) => s.clearPassword);
  const [mode, setMode] = useState<'idle' | 'set' | 'change' | 'disable'>('idle');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode('idle');
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setBusy(false);
  };

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    try {
      await action();
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试');
      setBusy(false);
    }
  };

  if (mode === 'idle') {
    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] text-fg-muted">密码保护</span>
          <span className={`text-[12px] ${enabled ? 'text-fg' : 'text-fg-muted'}`}>
            {enabled ? '已开启' : '未开启'}
          </span>
        </div>
        {enabled ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setMode('change')}>
              修改密码
            </Button>
            <Button variant="secondary" onClick={() => setMode('disable')}>
              关闭密码
            </Button>
          </div>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setMode('set')}>
              设置密码
            </Button>
            <p className="text-[11px] leading-relaxed text-fg-muted">
              现在数据已经加密存放，只是打开时不再问密码。设了密码，别人拿到这台电脑也看不到验证码。
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-[10px] bg-surface-alt/60 p-3">
      {mode !== 'set' && (
        <PasswordInput
          label="当前密码"
          value={current}
          onChange={setCurrent}
          autoFocus
          disabled={busy}
        />
      )}
      {mode !== 'disable' && (
        <>
          <PasswordInput
            label="新密码"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            {...(mode === 'set' ? { hint: '至少 8 位，建议用一句话而不是一个词' } : {})}
            disabled={busy}
          />
          <PasswordInput
            label="再输一次"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            disabled={busy}
          />
        </>
      )}

      {error && <p className="text-[11px] leading-relaxed text-danger">{error}</p>}

      <div className="space-y-1.5 pt-0.5">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            if (mode === 'set') void run(() => setPassword(next));
            else if (mode === 'change') void run(() => changePassword(current, next));
            else void run(() => clearPassword(current));
          }}
        >
          {busy ? '处理中…' : mode === 'set' ? '设好，继续' : mode === 'change' ? '修改密码' : '关闭密码保护'}
        </Button>
        <TextButton className="w-full" onClick={reset} disabled={busy}>
          取消
        </TextButton>
      </div>

      {mode === 'disable' && (
        <p className="text-[11px] leading-relaxed text-fg-muted">
          关闭后数据仍然加密存放，但打开扩展时不再需要密码，恢复码也会一并作废。
        </p>
      )}
    </div>
  );
}
