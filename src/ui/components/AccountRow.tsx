import { memo, useCallback } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { formatCode } from '@/core/totp';
import type { Account } from '@/core/types';
import { copyText, scheduleClipboardClear } from '@/platform/clipboard';
import { useAppStore, useSettings, type ViewMode } from '../store';
import { Countdown } from './Countdown';
import { CopyIcon, GripIcon, PencilIcon, PinIcon, TrashIcon } from './Icons';
import { Initials } from './Initials';

const WARN_AT = 4;

interface AccountRowProps {
  account: Account;
  code: string;
  remaining: number;
  view: ViewMode;
  showInitials: boolean;
  /** 打码模式下正在临时揭示的行 */
  revealed: boolean;
  onReveal: (id: string | null) => void;
  /** 只有「手动排序 + 没在搜索」时才能拖，否则拖完位置会被排序覆盖 */
  draggable: boolean;
  dragging: boolean;
  /** 拖到这一行上方还是下方，用来画落点提示线 */
  dropEdge: 'top' | 'bottom' | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (id: string, after: boolean) => void;
}

/**
 * 账户行。正常/打码 92px 两行，紧凑 44px 单行。
 *
 * 整行点击 = 复制；打码态整行点击 = 先揭示（5 秒后由 store 自动收回）。
 * 右侧的置顶/编辑/删除是真按钮，所以外层不能用 <button>（嵌套按钮非法），
 * 改 role="button" + 键盘处理。
 */
export const AccountRow = memo(function AccountRow({
  account,
  code,
  remaining,
  view,
  showInitials,
  revealed,
  onReveal,
  draggable,
  dragging,
  dropEdge,
  onDragStart,
  onDragEnd,
  onDrop,
}: AccountRowProps) {
  const showToast = useAppStore((s) => s.showToast);
  const openSheet = useAppStore((s) => s.openSheet);
  const togglePin = useAppStore((s) => s.togglePin);
  const clearSeconds = useSettings().clipboardClearSeconds;
  const compact = view === 'compact';
  const masked = view === 'masked' && !revealed;
  const invalid = code === '';
  // 打码/无效时不跟着倒计时变橙：橙色的含义是"这串码快过期了"，
  // 而当码根本没显示时，这个提示只会让人以为出了问题
  const hidden = masked || invalid;
  const urgent = !hidden && remaining <= WARN_AT;

  const copy = useCallback(async () => {
    if (invalid) {
      showToast('密钥无效，无法生成验证码', 'danger');
      return;
    }
    const ok = await copyText(code);
    if (ok) {
      showToast('已复制验证码');
      scheduleClipboardClear(clearSeconds);
    } else {
      showToast('复制失败', 'danger');
    }
  }, [code, invalid, clearSeconds, showToast]);

  const activate = useCallback(() => {
    if (masked) {
      onReveal(account.id);
      return;
    }
    void copy();
  }, [masked, onReveal, account.id, copy]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    // 不设 effectAllowed 的话部分平台不允许移动光标样式
    event.dataTransfer.effectAllowed = 'move';
    // 有些浏览器要求必须写点东西进 dataTransfer，否则拖不起来
    event.dataTransfer.setData('text/plain', account.id);
    onDragStart(account.id);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    // 必须挡住冒泡：外层 <main> 也有 drop 处理（拖到空白处 = 移到末尾），
    // 放任冒泡的话"插到这一行前面"会被紧接着的"移到末尾"覆盖掉
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    // 落点在行的下半部分 = 插到它后面
    onDrop(account.id, event.clientY > rect.top + rect.height / 2);
  };

  const title = account.account ? `${account.issuer}：${account.account}` : account.issuer;
  const display = masked ? '••• •••' : invalid ? '———' : formatCode(code);
  const codeClass = hidden ? 'text-fg-muted' : urgent ? 'text-warn' : 'text-code';

  const pinnedMark = account.pinned && (
    <PinIcon size={11} filled className="shrink-0 text-accent" />
  );

  const actions = (
    <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <IconButton
        label={account.pinned ? '取消置顶' : '置顶'}
        active={account.pinned}
        onClick={(e) => {
          e.stopPropagation();
          void togglePin(account.id);
        }}
      >
        <PinIcon size={14} filled={account.pinned} />
      </IconButton>
      <IconButton
        label="编辑"
        onClick={(e) => {
          e.stopPropagation();
          openSheet({ kind: 'edit', id: account.id });
        }}
      >
        <PencilIcon size={14} />
      </IconButton>
      <IconButton
        label="删除"
        onClick={(e) => {
          e.stopPropagation();
          openSheet({ kind: 'delete', id: account.id });
        }}
      >
        <TrashIcon size={14} />
      </IconButton>
    </div>
  );

  return (
    <div
      className={`row-divider group relative ${compact ? 'h-11' : 'h-[92px]'} ${
        dragging ? 'opacity-40' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${title}，${masked ? '已隐藏' : '点击复制验证码'}`}
      onClick={activate}
      onKeyDown={onKeyDown}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={onDragEnd}
      onDragOver={
        draggable
          ? (event) => {
              // 不 preventDefault 的话浏览器不会把它当成合法落点
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }
          : undefined
      }
      onDrop={draggable ? handleDrop : undefined}
    >
      {dropEdge && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-accent ${
            dropEdge === 'top' ? 'top-0' : 'bottom-0'
          }`}
        />
      )}

      {compact ? (
        /* 紧凑模式：一行读完 —— 弹出的窗口里能多塞好几个账户。
           这里故意不放操作按钮：塞进去会让圆环在 hover 时左右横跳，
           而紧凑模式本来就是"只想快速抄一串码"，管理动作留给正常模式。 */
        <div className="flex h-full items-center gap-3 px-4 transition-colors duration-150 group-hover:bg-surface-alt/60">
          {pinnedMark}
          <span className="truncate text-[13px] text-fg">{title}</span>
          <span className={`code ml-auto shrink-0 text-[17px] ${codeClass}`} dir="ltr">
            {display}
          </span>
          <Countdown
            remaining={remaining}
            period={account.period}
            warnAt={WARN_AT}
            size={18}
            showNumber={false}
          />
        </div>
      ) : (
        <div className="flex h-full w-full flex-col justify-center gap-1 px-4 py-3 transition-colors duration-150 group-hover:bg-surface-alt/60">
          {/* 第一行：拖拽把手 + 首字母 + 账户名 + hover 图标 */}
          <div className="flex min-w-0 items-center gap-2.5">
            {/* 拖拽把手只画在能拖的时候，但两种状态占同样宽度：
                切换排序方式时整列文字不会左右跳一下 */}
            {draggable ? (
              <GripIcon
                size={14}
                className="shrink-0 text-fg-muted/40 transition-colors duration-150 group-hover:text-fg-muted"
              />
            ) : (
              <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            )}
            {showInitials && <Initials issuer={account.issuer} account={account.account} />}
            <span className="truncate text-[14px] font-medium text-fg">{title}</span>
            {pinnedMark}
            {actions}
          </div>

          {/* 第二行：验证码 + 复制图标 + 倒计时环 */}
          <div className="flex items-end justify-between">
            <span className={`code transition-colors duration-200 ${codeClass}`} dir="ltr">
              {display}
            </span>

            <div className="flex items-center gap-2.5 pb-0.5">
              <CopyIcon
                size={14}
                className="text-fg-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              />
              <Countdown remaining={remaining} period={account.period} warnAt={WARN_AT} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: (e: MouseEvent) => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`rounded-[6px] p-1 transition-colors duration-150 hover:bg-surface-alt ${
        active ? 'text-accent' : 'text-fg-muted hover:text-fg'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
