import { useEffect, useState } from 'react';
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
  const [fatal, setFatal] = useState<string | null>(null);

  // 主题存在加密的 vault 里，所以未解锁时只能用系统设置。这是刻意的：
  // 为了"锁屏也守主题"把偏好写到明文里，等于泄露一条用不到的用户特征
  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    void hydrate().catch((cause: unknown) => {
      // 这里唯一该说清的是"数据比扩展新"，其余按未知错误处理
      setFatal(cause instanceof Error ? cause.message : '读取本地数据失败');
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

function SheetView({ sheet }: { sheet: Sheet }) {
  switch (sheet.kind) {
    case 'add':
      return <AddAccountScreen />;
    case 'edit':
      return <EditAccountScreen id={sheet.id} />;
    case 'delete':
      return <DeleteAccountScreen id={sheet.id} />;
    case 'settings':
      return <SettingsScreen />;
    case 'export':
      return <ExportScreen from={sheet.from} />;
    case 'import':
      return <ImportScreen from={sheet.from} />;
  }
}

function LoadingScreen() {
  return (
    <div className="flex min-h-[280px] items-center justify-center bg-bg">
      <span
        aria-label="正在读取"
        className="h-5 w-5 animate-spin rounded-full border-2 border-separator border-t-accent"
      />
    </div>
  );
}

function FatalScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-[280px] flex-col justify-center bg-bg px-5 py-7">
      <h1 className="text-[16px] font-semibold tracking-tight">打不开本地数据</h1>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">{message}</p>
      <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">
        数据还在本地，没有被删掉。先别清除浏览器数据，把这句话记下来再处理。
      </p>
    </div>
  );
}
