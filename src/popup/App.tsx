import { Component, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RecoveryCodeSheet } from '@/ui/components/RecoveryCodeSheet';
import { useAutoLock } from '@/ui/hooks/useAutoLock';
import { AddAccountScreen } from '@/ui/screens/AddAccountScreen';
import { DeleteAccountScreen } from '@/ui/screens/DeleteAccountScreen';
import { EditAccountScreen } from '@/ui/screens/EditAccountScreen';
import { ExportScreen } from '@/ui/screens/ExportScreen';
import { ImportScreen } from '@/ui/screens/ImportScreen';
import { ListScreen } from '@/ui/screens/ListScreen';
import { LockScreen } from '@/ui/screens/LockScreen';
import { OnboardScreen } from '@/ui/screens/OnboardScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { describeError, useMessage } from '@/ui/errors';
import type { Message } from '@/ui/errors';
import { useLang, useT } from '@/ui/i18n';
import type { MessageKey } from '@/ui/i18n';
import { useAppStore, useSettings, type Sheet } from '@/ui/store';
import { applyTheme } from '@/ui/theme';

/**
 * 顶层路由：只看 `phase`。
 *
 * 恢复码是唯一会打断整个界面的东西 —— 生成它的时候状态已经切走了，
 * 所以它必须由这一层来渲染，不能挂在某个具体界面上。
 */
export default function App() {
  const phase = useAppStore((s) => s.phase);
  const hydrate = useAppStore((s) => s.hydrate);
  const pendingRecovery = useAppStore((s) => s.pendingRecovery);
  const clearPendingRecovery = useAppStore((s) => s.clearPendingRecovery);
  const sheet = useAppStore((s) => s.sheet);
  const theme = useSettings().theme;
  const lang = useLang();
  // 致命错误也只存键：这一屏可能一直挂着，用户切了语言它得跟着变
  const [fatal, setFatal] = useState<Message | null>(null);

  // 主题存在加密的 vault 里，所以未解锁时只能用系统设置。这是刻意的：
  // 为了"锁屏也守主题"把偏好写到明文里，等于泄露一条用不到的用户特征
  useEffect(() => applyTheme(theme), [theme]);

  // `<html lang>` 决定读屏用哪种语音念。弹窗里几乎全是中文短语，
  // 标错语言时读屏会拿英文音去念中文，听起来是一串乱码
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  useEffect(() => {
    void hydrate().catch((cause: unknown) => {
      // 这里唯一该说清的是"数据比扩展新"，其余按未知错误处理
      const described = describeError(cause);
      setFatal(described.key === 'error.unknown' ? { key: 'error.read-data' } : described);
    });
  }, [hydrate]);

  useAutoLock(phase === 'unlocked');

  if (fatal) return <FatalScreen message={fatal} />;

  // 恢复码是整屏替换而不是浮层：弹窗高度跟着内容走，浮层高了就会被裁掉
  if (pendingRecovery) {
    return <RecoveryCodeSheet code={pendingRecovery} onDone={clearPendingRecovery} />;
  }

  // 子界面也是整屏替换：弹窗高度跟着内容走，浮层高了会被裁掉且滚不动
  if (phase === 'unlocked' && sheet) return <SheetView sheet={sheet} />;

  return (
    <>
      {phase === 'loading' && <LoadingScreen />}
      {phase === 'empty' && <OnboardScreen />}
      {phase === 'locked' && <LockScreen />}
      {phase === 'unlocked' && <ListScreen />}
    </>
  );
}

/** 每一屏对应的标题键，给读屏当对话框名字用 */
const SHEET_LABELS: Record<Sheet['kind'], MessageKey> = {
  add: 'add.title',
  edit: 'edit.title',
  delete: 'delete.title',
  settings: 'settings.title',
  export: 'export.title',
  import: 'import.title',
};

/**
 * 子界面外壳：管焦点和 Esc。
 *
 * 为什么不是每个界面自己管：焦点回收必须发生在**卸载时**，
 * 而"点进某一屏"的那一下可能发生在这屏之外（列表上的按钮），
 * 只有外壳同时看得见两头。Esc 走的是 store 里的 `back()`，
 * 和头部返回箭头同一个动作。
 */
function SheetView({ sheet }: { sheet: Sheet }) {
  const t = useT();
  const back = useAppStore((s) => s.back);
  const container = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);

  // 打开时记下焦点从哪来，关掉时还回去 —— 键盘用户不该被扔回文档开头
  useEffect(() => {
    origin.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const previous = origin.current;
      // 目标可能已经跟着列表一起重渲染掉了，那就别再抢焦点
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // 换一层（设置 → 导出）时焦点留在被换掉的节点上会直接掉进 body，这里重新落一次。
  // 但界面自己已经落了焦点（表单的 autoFocus）就别抢 —— 打开「添加账户」应该直接
  // 停在第一个输入框里，而不是停在一个不可操作的容器上
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    if (element.contains(document.activeElement)) return;
    element.focus();
  }, [sheet]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      back();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [back]);

  return (
    <div
      ref={container}
      role="dialog"
      aria-modal="true"
      aria-label={t(SHEET_LABELS[sheet.kind])}
      tabIndex={-1}
      // 整屏容器不需要焦点环：它不可操作，画一圈反而像出了错
      className="outline-none ring-0 focus-visible:ring-0"
    >
      {sheet.kind === 'add' && <AddAccountScreen />}
      {sheet.kind === 'edit' && <EditAccountScreen id={sheet.id} />}
      {sheet.kind === 'delete' && <DeleteAccountScreen id={sheet.id} />}
      {sheet.kind === 'settings' && <SettingsScreen />}
      {sheet.kind === 'export' && <ExportScreen />}
      {sheet.kind === 'import' && <ImportScreen />}
    </div>
  );
}

function LoadingScreen() {
  const t = useT();
  return (
    <div className="flex min-h-[280px] items-center justify-center bg-bg">
      <span
        role="status"
        aria-label={t('app.loading')}
        className="h-5 w-5 animate-spin rounded-full border-2 border-separator border-t-accent"
      />
    </div>
  );
}

/** 渲染崩了时的兜底。数据本身没问题，重开就好 —— 这句必须说清楚 */
function CrashScreen() {
  const t = useT();
  return (
    <div className="flex min-h-[280px] flex-col justify-center bg-bg px-5 py-7">
      <h1 role="alert" className="text-[16px] font-semibold tracking-tight">
        {t('crash.title')}
      </h1>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">{t('crash.body')}</p>
      <button
        type="button"
        className="mt-4 h-[42px] w-full rounded-[10px] bg-accent text-[13px] font-medium text-white hover:bg-accent-press"
        onClick={() => location.reload()}
      >
        {t('crash.reload')}
      </button>
    </div>
  );
}

interface BoundaryState {
  failed: boolean;
}

/**
 * 渲染异常兜底。
 *
 * 不把错误对象打进控制台：渲染期抛出的异常可能已经把账户字段写进了报错信息，
 * 那正好是最不该进日志的东西。要诊断时把它临时改回来即可。
 */
export class Boundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <CrashScreen />;
    return this.props.children;
  }
}

function FatalScreen({ message }: { message: Message }) {
  const t = useT();
  const text = useMessage();
  return (
    <div className="flex min-h-[280px] flex-col justify-center bg-bg px-5 py-7">
      <h1 role="alert" className="text-[16px] font-semibold tracking-tight">
        {t('fatal.title')}
      </h1>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">{text(message)}</p>
      <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">{t('fatal.hint')}</p>
    </div>
  );
}
