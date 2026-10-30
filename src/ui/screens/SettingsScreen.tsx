import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClipboardClear, Settings, UiStyle } from '@/core/types';
import { getExtensionVersion } from '@/platform/env';
import { backupStatus } from '@/platform/vault-service';
import { Button, TextButton } from '../components/Button';
import { ChevronRightIcon } from '../components/Icons';
import { PasswordInput } from '../components/PasswordInput';
import { ScreenHeader } from '../components/ScreenHeader';
import { Switch } from '../components/Switch';
import { Segmented } from '../components/TextInput';
import { describeError, useMessage } from '../errors';
import { useT } from '../i18n';
import { useAppStore, useSettings, useTrash } from '../store';

/**
 * 设置。
 *
 * 一条原则：**每一项都要能立刻看到效果**，没有"保存"按钮。
 * 设置本身就是数据的一部分（存在加密的 vault 里），改一项写一次。
 *
 * 版式上照 iOS 的分组列表：灰色页面底 + 白色圆角卡片，每个分组一张卡，
 * 卡内相邻行之间画一根左右内缩的分隔线。层级靠"底色差 + 圆角 + 分隔线"
 * 三层叠出来 —— 全部控件直接铺在灰底上时，即使每一行都对齐，
 * 读起来还是一整片，找不到"该从哪读到哪"。
 */
export function SettingsScreen() {
  const t = useT();
  const closeSheet = useAppStore((s) => s.closeSheet);
  const openSheet = useAppStore((s) => s.openSheet);
  const canRecover = useAppStore((s) => s.canRecover);
  const settings = useSettings();
  const setSettings = useAppStore((s) => s.setSettings);
  const showToast = useAppStore((s) => s.showToast);
  const restoreBackup = useAppStore((s) => s.restoreBackup);
  const trash = useTrash();
  const [backup, setBackup] = useState<{ count: number; latest: string | null }>({
    count: 0,
    latest: null,
  });

  // 备份状态只读一次：它只在「数据改动」时变，而改动会触发本组件随 vault 重渲染的
  // 情况很有限。这里打开设置页时取一次就够，不追求实时。
  useEffect(() => {
    let alive = true;
    void backupStatus().then((status) => {
      if (alive) setBackup(status);
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = (patch: Partial<Settings>) => {
    void setSettings(patch).catch(() => {
      showToast('toast.settings-failed', { tone: 'danger' });
    });
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-6">
      <ScreenHeader title={t('settings.title')} onBack={closeSheet} />

      <div className="pt-4">
        {/* 备份排第一：这一页里只有它管"数据会不会丢"，也只有在换机、
            重装、清缓存这些时刻才会被想起来 —— 越急的事越不该靠滚动去找。
            其余分组是"用起来舒不舒服"，排在后面 */}
        <Group title={t('settings.section.backup')}>
          <Item label={t('settings.autobackup')} hint={t('settings.autobackup.hint')} inline>
            <Switch
              label={t('settings.autobackup')}
              checked={settings.autoBackup}
              onChange={(autoBackup) => update({ autoBackup })}
            />
          </Item>
          <Item
            label={t('settings.backup-status', {
              count: backup.count,
              when: backup.latest ?? '—',
            })}
            hint={t('settings.backup-status.hint')}
          >
            <button
              type="button"
              className="mt-2.5 h-10 w-full rounded-[10px] border border-separator text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-surface-alt"
              onClick={() => {
                // restoreBackup 内部已经处理了「恢复了多少」/「没得恢复」两种提示
                void restoreBackup();
              }}
            >
              {t('settings.restore-backup')}
            </button>
          </Item>
          <div className="px-4 py-3.5">
            <div className="flex gap-2">
              <PillButton onClick={() => openSheet({ kind: 'export', from: 'settings' })}>
                {t('settings.export')}
              </PillButton>
              <PillButton onClick={() => openSheet({ kind: 'import', from: 'settings' })}>
                {t('settings.import')}
              </PillButton>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">
              {t('settings.backup.hint')}
            </p>
          </div>
        </Group>

        <Group title={t('settings.section.trash')}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-surface-alt"
            onClick={() => openSheet({ kind: 'trash' })}
          >
            <span className="text-[14px] text-fg">{t('settings.trash')}</span>
            <span className="flex shrink-0 items-center gap-1 text-[13px] text-fg-muted">
              {trash.length > 0 ? t('settings.trash.count', { count: trash.length }) : t('settings.trash.empty')}
              <ChevronRightIcon size={14} className="text-fg-muted" />
            </span>
          </button>
        </Group>

        <Group title={t('settings.section.display')}>
          {/* 风格排在最前面：它决定列表的整体骨架，先选骨架再选细节 */}
          <Item label={t('settings.style')} hint={t('settings.style.hint')}>
            <StylePicker
              label={t('settings.style')}
              value={settings.style}
              onChange={(style) => update({ style })}
            />
          </Item>
          <Item label={t('settings.view')}>
            <Segmented
              ariaLabel={t('settings.view')}
              value={settings.view}
              onChange={(view) => update({ view })}
              options={[
                { value: 'normal' as const, label: t('view.normal') },
                { value: 'compact' as const, label: t('view.compact') },
              ]}
            />
          </Item>
          <Item label={t('settings.initials')} hint={t('settings.initials.hint')} inline>
            <Switch
              label={t('settings.initials')}
              checked={settings.showInitials}
              onChange={(showInitials) => update({ showInitials })}
            />
          </Item>
          <Item label={t('settings.theme')}>
            <Segmented
              ariaLabel={t('settings.theme')}
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'system' as const, label: t('theme.system') },
                { value: 'light' as const, label: t('theme.light') },
                { value: 'dark' as const, label: t('theme.dark') },
              ]}
            />
          </Item>
          {/* 语言放在「显示」里而不是单开一块：它和主题一样属于"界面长什么样"，
              而且和主题一样改了立刻生效、不需要重开弹窗 */}
          <Item label={t('settings.language')}>
            <Segmented
              ariaLabel={t('settings.language')}
              value={settings.language}
              onChange={(language) => update({ language })}
              options={[
                { value: 'system' as const, label: t('language.system') },
                { value: 'zh' as const, label: t('language.zh') },
                { value: 'en' as const, label: t('language.en') },
              ]}
            />
          </Item>
        </Group>

        <Group title={t('settings.section.sort')}>
          <Item label={t('settings.sort')} hint={t('settings.sort.hint')}>
            <Segmented
              ariaLabel={t('settings.sort')}
              value={settings.sortBy}
              onChange={(sortBy) => update({ sortBy })}
              options={[
                { value: 'manual' as const, label: t('sort.manual') },
                { value: 'issuer' as const, label: t('sort.issuer') },
                { value: 'name' as const, label: t('sort.name') },
              ]}
            />
          </Item>
        </Group>

        <Group title={t('settings.section.security')}>
          <Item label={t('settings.autolock')}>
            <Segmented
              ariaLabel={t('settings.autolock')}
              value={settings.autoLockMinutes}
              onChange={(autoLockMinutes) => update({ autoLockMinutes })}
              options={[
                { value: 0 as const, label: t('autolock.0') },
                { value: 5 as const, label: t('autolock.5') },
                { value: 30 as const, label: t('autolock.30') },
                { value: 120 as const, label: t('autolock.120') },
              ]}
            />
          </Item>
          <PasswordItem enabled={canRecover} />
        </Group>

        <Group title={t('settings.section.clipboard')}>
          <Item label={t('settings.clipboard')} hint={t('settings.clipboard.hint')}>
            <Segmented
              ariaLabel={t('settings.clipboard')}
              value={settings.clipboardClearSeconds}
              onChange={(clipboardClearSeconds) => update({ clipboardClearSeconds })}
              options={[
                { value: 0 as ClipboardClear, label: t('clipboard.0') },
                { value: 15 as ClipboardClear, label: t('clipboard.15') },
                { value: 30 as ClipboardClear, label: t('clipboard.30') },
                { value: 60 as ClipboardClear, label: t('clipboard.60') },
              ]}
            />
          </Item>
        </Group>

        <Group title={t('settings.section.about')}>
          <div className="space-y-2 px-4 py-3.5">
            <Row label={t('settings.version')} value={getExtensionVersion()} />
            <Row label={t('settings.storage')} value={t('settings.storage.value')} />
            <Row label={t('settings.network')} value={t('settings.network.value')} />
          </div>
          <div className="px-4 pb-3.5">
            <p className="text-[12px] leading-relaxed text-fg-muted">{t('settings.about.hint')}</p>
          </div>
        </Group>
      </div>
    </div>
  );
}

/**
 * 风格选择：两个带缩略图的按钮。
 *
 * 缩略图不是装饰：左边两条横线代表"账户名 + 验证码"，右边那个环就是真实的
 * 倒计时环按比例缩小画出来的 —— 现代 16px、经典 11px。用户不用点进去，
 * 光看这两张图就知道选完列表会变成什么样。
 */
function StylePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: UiStyle;
  onChange: (style: UiStyle) => void;
}) {
  const t = useT();
  const options: ReadonlyArray<{ value: UiStyle; label: string }> = [
    { value: 'modern', label: t('style.modern') },
    { value: 'classic', label: t('style.classic') },
  ];

  return (
    <div className="flex gap-2" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        const modern = option.value === 'modern';
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            className={`flex-1 rounded-[10px] p-1.5 transition-colors duration-150 ${
              active
                ? 'bg-surface ring-2 ring-accent'
                : 'bg-surface-alt ring-1 ring-transparent hover:ring-separator'
            }`}
            onClick={() => onChange(option.value)}
          >
            {/* 缩略图固定 36px 高：两个按钮必须等高，否则这一行会一高一低。
                宽度、粗细、环径三处一起收，经典版才看得出"更紧凑" */}
            <span
              className={`flex h-9 items-center rounded-[7px] bg-surface px-2 ${
                modern ? 'gap-2' : 'gap-1.5'
              }`}
            >
              <span className={`flex min-w-0 flex-1 flex-col ${modern ? 'gap-1' : 'gap-0.5'}`}>
                <span
                  className={`block rounded-full bg-fg-muted/50 ${
                    modern ? 'h-1 w-8' : 'h-[3px] w-7'
                  }`}
                />
                <span
                  className={`block rounded-full bg-code/70 ${
                    modern ? 'h-[5px] w-11' : 'h-1 w-9'
                  }`}
                />
              </span>
              <span
                aria-hidden="true"
                className="shrink-0 rounded-full border-[1.5px] border-tick-track border-r-tick border-t-tick"
                style={{ width: modern ? 16 : 11, height: modern ? 16 : 11 }}
              />
            </span>
            <span
              className={`mt-1 block text-[12px] ${
                active ? 'font-medium text-fg' : 'text-fg-muted'
              }`}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 一个设置分组：灰底上的一张白卡，标题在卡外 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      {/* 标题比卡内文字再靠左 8px：缩进 24px，卡内文字 32px。
          完全对齐时标题看着像卡里的第一行内容，分组的分界感反而没了；
          再往左（px-5 = 20px）就贴到卡片圆角上了。
          颜色和字重也提一档：13px/600 + --fg-secondary，
          纯 --fg-muted 做标题太虚，一页扫下来抓不住有哪几组 */}
      <h2 className="mb-2 px-6 text-[13px] font-semibold text-fg-secondary">{title}</h2>
      <div className="card-divide mx-4 overflow-hidden rounded-card bg-surface">{children}</div>
    </section>
  );
}

/**
 * 卡片里的一行。
 *
 * `inline` 决定控件放右边还是下一行：
 * - 开关这类窄控件放右边，标题和开关在同一水平线上，扫视最快
 * - 分段控件放右边会把它挤成窄条，所以放在标题下面、占满整行
 */
function Item({
  label,
  hint,
  inline,
  children,
}: {
  label: string;
  hint?: string;
  inline?: boolean;
  children: ReactNode;
}) {
  if (inline) {
    return (
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <span className="block text-[14px] text-fg">{label}</span>
          {hint && <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{hint}</p>}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="px-4 py-3.5">
      <span className="block text-[14px] text-fg">{label}</span>
      <div className="mt-2.5">{children}</div>
      {hint && <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">{hint}</p>}
    </div>
  );
}

/** 卡片内的小尺寸描边按钮。42px 的全宽按钮放进卡片会像一块砖 */
function PillButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-10 flex-1 items-center justify-center rounded-[10px] border border-separator text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-surface-alt"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[13px] text-fg-muted">{label}</dt>
      <dd className="text-[13px] text-fg">{value}</dd>
    </div>
  );
}

/** 密码保护：开启 / 修改 / 关闭。三种状态互斥，用同一个面板切换。 */
function PasswordItem({ enabled }: { enabled: boolean }) {
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
      <div className="px-4 py-3.5">
        {/* 标题和按钮在同一行，说明文字另起一行占满整宽。
            把说明塞进左侧那一栏里的话，它会被按钮挤到只剩 2/3 宽，
            一段 3 行的说明会变成 4 行，读起来断断续续 */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px] text-fg">{t('settings.password')}</span>
          {enabled ? (
            <span className="shrink-0 text-[13px] text-fg-muted">{t('settings.password.on')}</span>
          ) : (
            <button
              type="button"
              className="h-7 shrink-0 rounded-full bg-accent px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-accent-press"
              onClick={() => setMode('set')}
            >
              {t('settings.password.set')}
            </button>
          )}
        </div>

        {/* 未开启时说清代价，而不是只写"未开启" —— 这一行的目的是让人决定要不要开 */}
        {!enabled && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
            {t('settings.password.off-hint')}
          </p>
        )}

        {enabled && (
          <div className="mt-3 flex gap-2">
            <PillButton onClick={() => setMode('change')}>{t('settings.password.change')}</PillButton>
            <PillButton onClick={() => setMode('disable')}>
              {t('settings.password.disable')}
            </PillButton>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 px-4 py-3.5">
      <span className="block text-[14px] text-fg">{t('settings.password')}</span>
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

      {error && <p className="text-[12px] leading-relaxed text-danger">{error}</p>}

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
        <p className="text-[12px] leading-relaxed text-fg-muted">
          {t('settings.password.disable-hint')}
        </p>
      )}
    </div>
  );
}
