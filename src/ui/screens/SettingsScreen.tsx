import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ClipboardClear, Settings } from '@/core/types';
import { getExtensionVersion } from '@/platform/env';
import { Button, TextButton } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/TextInput';
import { describeError, useMessage } from '../errors';
import { useT } from '../i18n';
import { useAppStore, useSettings } from '../store';

/**
 * 设置。
 *
 * 一条原则：**每一项都要能立刻看到效果**，没有"保存"按钮。
 * 设置本身就是数据的一部分（存在加密的 vault 里），改一项写一次。
 */
export function SettingsScreen() {
  const t = useT();
  const closeSheet = useAppStore((s) => s.closeSheet);
  const openSheet = useAppStore((s) => s.openSheet);
  const canRecover = useAppStore((s) => s.canRecover);
  const settings = useSettings();
  const setSettings = useAppStore((s) => s.setSettings);
  const showToast = useAppStore((s) => s.showToast);

  const update = (patch: Partial<Settings>) => {
    void setSettings(patch).catch(() => {
      showToast('toast.settings-failed', { tone: 'danger' });
    });
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-4">
      <ScreenHeader title={t('settings.title')} onBack={closeSheet} />

      <div className="space-y-5 px-4 py-4">
        <Section title={t('settings.section.display')}>
          <Segmented
            label={t('settings.view')}
            value={settings.view}
            onChange={(view) => update({ view })}
            options={[
              { value: 'normal' as const, label: t('view.normal') },
              { value: 'compact' as const, label: t('view.compact') },
            ]}
          />
          <Toggle
            label={t('settings.initials')}
            hint={t('settings.initials.hint')}
            checked={settings.showInitials}
            onChange={(showInitials) => update({ showInitials })}
          />
          <Segmented
            label={t('settings.theme')}
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'system' as const, label: t('theme.system') },
              { value: 'light' as const, label: t('theme.light') },
              { value: 'dark' as const, label: t('theme.dark') },
            ]}
          />
          {/* 语言放在「显示」里而不是单开一块：它和主题一样属于"界面长什么样"，
              而且和主题一样改了立刻生效、不需要重开弹窗 */}
          <Segmented
            label={t('settings.language')}
            value={settings.language}
            onChange={(language) => update({ language })}
            options={[
              { value: 'system' as const, label: t('language.system') },
              { value: 'zh' as const, label: t('language.zh') },
              { value: 'en' as const, label: t('language.en') },
            ]}
          />
        </Section>

        <Section title={t('settings.section.sort')}>
          <Segmented
            label={t('settings.sort')}
            value={settings.sortBy}
            onChange={(sortBy) => update({ sortBy })}
            options={[
              { value: 'manual' as const, label: t('sort.manual') },
              { value: 'issuer' as const, label: t('sort.issuer') },
              { value: 'name' as const, label: t('sort.name') },
            ]}
          />
          <p className="text-[11px] leading-relaxed text-fg-muted">{t('settings.sort.hint')}</p>
        </Section>

        <Section title={t('settings.section.security')}>
          <Segmented
            label={t('settings.autolock')}
            value={settings.autoLockMinutes}
            onChange={(autoLockMinutes) => update({ autoLockMinutes })}
            options={[
              { value: 0 as const, label: t('autolock.0') },
              { value: 5 as const, label: t('autolock.5') },
              { value: 30 as const, label: t('autolock.30') },
              { value: 120 as const, label: t('autolock.120') },
            ]}
          />
          <PasswordSection enabled={canRecover} />
        </Section>

        <Section title={t('settings.section.clipboard')}>
          <Segmented
            label={t('settings.clipboard')}
            value={settings.clipboardClearSeconds}
            onChange={(clipboardClearSeconds) => update({ clipboardClearSeconds })}
            options={[
              { value: 0 as ClipboardClear, label: t('clipboard.0') },
              { value: 15 as ClipboardClear, label: t('clipboard.15') },
              { value: 30 as ClipboardClear, label: t('clipboard.30') },
              { value: 60 as ClipboardClear, label: t('clipboard.60') },
            ]}
          />
          <p className="text-[11px] leading-relaxed text-fg-muted">
            {t('settings.clipboard.hint')}
          </p>
        </Section>

        <Section title={t('settings.section.backup')}>
          <Toggle
            label={t('settings.autobackup')}
            hint={t('settings.autobackup.hint')}
            checked={settings.autoBackup}
            onChange={(autoBackup) => update({ autoBackup })}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => openSheet({ kind: 'export', from: 'settings' })}>
              {t('settings.export')}
            </Button>
            <Button variant="secondary" onClick={() => openSheet({ kind: 'import', from: 'settings' })}>
              {t('settings.import')}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-fg-muted">{t('settings.backup.hint')}</p>
        </Section>

        <Section title={t('settings.section.about')}>
          <dl className="space-y-1.5 text-[12px]">
            <Row label={t('settings.version')} value={getExtensionVersion()} />
            <Row label={t('settings.storage')} value={t('settings.storage.value')} />
            <Row label={t('settings.network')} value={t('settings.network.value')} />
          </dl>
          <p className="text-[11px] leading-relaxed text-fg-muted">{t('settings.about.hint')}</p>
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
  const t = useT();
  const message = useMessage();
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
      setError(t('settings.password-mismatch'));
      return;
    }
    setBusy(true);
    try {
      await action();
      reset();
    } catch (cause) {
      setError(message(describeError(cause)));
      setBusy(false);
    }
  };

  if (mode === 'idle') {
    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] text-fg-muted">{t('settings.password')}</span>
          <span className={`text-[12px] ${enabled ? 'text-fg' : 'text-fg-muted'}`}>
            {enabled ? t('settings.password.on') : t('settings.password.off')}
          </span>
        </div>
        {enabled ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setMode('change')}>
              {t('settings.password.change')}
            </Button>
            <Button variant="secondary" onClick={() => setMode('disable')}>
              {t('settings.password.disable')}
            </Button>
          </div>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setMode('set')}>
              {t('settings.password.set')}
            </Button>
            <p className="text-[11px] leading-relaxed text-fg-muted">
              {t('settings.password.off-hint')}
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
          label={t('settings.current-password')}
          value={current}
          onChange={setCurrent}
          autoFocus
          disabled={busy}
        />
      )}
      {mode !== 'disable' && (
        <>
          <PasswordInput
            label={t('settings.new-password')}
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            {...(mode === 'set' ? { hint: t('password.hint-long') } : {})}
            disabled={busy}
          />
          <PasswordInput
            label={t('password.confirm')}
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
          {busy
            ? t('common.busy')
            : mode === 'set'
              ? t('settings.password-submit')
              : mode === 'change'
                ? t('settings.password.change')
                : t('settings.disable-submit')}
        </Button>
        <TextButton className="w-full" onClick={reset} disabled={busy}>
          {t('common.cancel')}
        </TextButton>
      </div>

      {mode === 'disable' && (
        <p className="text-[11px] leading-relaxed text-fg-muted">
          {t('settings.password.disable-hint')}
        </p>
      )}
    </div>
  );
}
