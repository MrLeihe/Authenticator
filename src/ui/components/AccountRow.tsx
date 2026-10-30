import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { formatCode } from '@/core/totp';
import type { Account, UiStyle } from '@/core/types';
import { copyText, scheduleClipboardClear } from '@/platform/clipboard';
import { useT } from '../i18n';
import { useAppStore, useSettings, type ViewMode } from '../store';
import { Countdown } from './Countdown';
import { CopyIcon, GripIcon, PencilIcon, PinIcon, TrashIcon } from './Icons';
import { Initials } from './Initials';

const WARN_AT = 4;

/**
 * 两种版式的尺寸表。**只在这里放数字**，组件里不再散落三元表达式 ——
 * 一处放宽、一处没跟上，就会出现"名字变大了但环没跟上"的半调子。
 *
 * 现代版：行高 96，环 32（两位数读得清），名字 15px，验证码 600。
 * 经典版：行高 88，环 28，名字 14px，验证码 500 —— 一屏多出一整行，
 *         代价是环里的数字只能 10px，够看但不适合盯着数。
 *
 * 验证码字重分两档是因为两版的检验距离不同：现代版卡片留白多、眼睛离屏远，
 * 500 在 24px 等宽下笔画偏细，扫一眼容易把 6 和 8 看混；经典版行挤，
 * 提到 600 会让整列数字连成黑块，反而更难分辨。
 */
const METRICS: Record<UiStyle, { row: string; ring: number; name: string; code: string }> = {
  modern: { row: 'h-24', ring: 32, name: 'text-[15px]', code: 'font-semibold' },
  classic: { row: 'h-[88px]', ring: 28, name: 'text-[14px]', code: 'font-medium' },
};

/**
 * 行内次要图标（拖拽把手、复制、置顶/编辑/删除）的统一显示方式：
 * 平时透明，鼠标移到这一行或键盘焦点落在这一行时才浮现。
 *
 * 为什么同一个常量要复用四处：这四处只要有一处写漏，就会出现"一半图标常驻、
 * 一半图标才出现"的分裂感 —— 而且很难在代码评审时看出来，只能靠眼睛发现。
 *
 * `group-focus-within` 曾经在这里用过，是个陷阱：整行点击 = 复制验证码，
 * 而点击会给这一行留下焦点，于是图标「粘」在最后点过的那一行上，
 * 鼠标移开也不消失 —— 看起来像 bug，其实就是 focus-within 把鼠标焦点
 * 当成键盘焦点了。
 *
 * `:focus-visible` 只在键盘导航时成立，正好区分两者，所以拆成两条：
 *   - `group-focus-visible`        → 键盘 Tab 到这一行本身
 *   - `group-has-[:focus-visible]`  → 键盘 Tab 到行内的置顶/编辑/删除按钮
 * 第二条不能省：少了它，Tab 进按钮时那一组图标是隐形的，键盘用户会按到看不见的东西。
 */
const HOVER_REVEAL =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-has-[:focus-visible]:opacity-100';

interface AccountRowProps {
  account: Account;
  code: string;
  remaining: number;
  view: ViewMode;
  style: UiStyle;
  showInitials: boolean;
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
 * 账户行。现代版 96px 两行，经典版 88px 两行，紧凑 44px 单行。
 *
 * 96px 不是被某一项撑出来的：两行内容（名字 15px + 6px 间距 + 验证码 28.8px）
 * 合起来约 54px，剩下的都是上下留白 —— 这一档卖的就是"宽松"。
 * 想一屏多看几行就去设置里换经典版，或切成紧凑视图。
 *
 * 整行点击 = 复制验证码。右侧的置顶/编辑/删除是真按钮，
 * 所以外层不能用 <button>（嵌套按钮非法），改 role="button" + 键盘处理。
 */
export const AccountRow = memo(function AccountRow({
  account,
  code,
  remaining,
  view,
  style,
  showInitials,
  draggable,
  dragging,
  dropEdge,
  onDragStart,
  onDragEnd,
  onDrop,
}: AccountRowProps) {
  const t = useT();
  const showToast = useAppStore((s) => s.showToast);
  const openSheet = useAppStore((s) => s.openSheet);
  const togglePin = useAppStore((s) => s.togglePin);
  const clearSeconds = useSettings().clipboardClearSeconds;
  const compact = view === 'compact';
  const metrics = METRICS[style];
  const invalid = code === '';
  // 无效时不跟着倒计时变橙：橙色的含义是"这串码快过期了"，
  // 而当码根本没显示时，这个提示只会让人以为出了问题
  const urgent = !invalid && remaining <= WARN_AT;

  const copy = useCallback(async () => {
    if (invalid) {
      showToast('toast.invalid-secret', { tone: 'danger' });
      return;
    }
    const ok = await copyText(code);
    if (ok) {
      showToast('toast.copied');
      scheduleClipboardClear(clearSeconds);
    } else {
      showToast('toast.copy-failed', { tone: 'danger' });
    }
  }, [code, invalid, clearSeconds, showToast]);

  const activate = useCallback(() => {
    void copy();
  }, [copy]);

  /**
   * 验证码翻页时播报一句。
   *
   * 只在焦点正落在这一行时才播报：一屏十几行同时换码，全播出去在读屏里
   * 只是一串听不清的噪音。也不念数字本身 —— 验证码马上就会被复制走，
   * 而"把一串一次性密码念出声"在没有耳机的场合是纯粹的泄露。
   */
  const row = useRef<HTMLDivElement>(null);
  const previousCode = useRef(code);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (previousCode.current === code) return;
    previousCode.current = code;
    if (!row.current?.contains(document.activeElement)) return;
    // aria-live 只在文字"变了"的时候才开口。同一句话每 30 秒要说一次，
    // 直接写同样的字符串读屏会当成没变化，所以先清空、下一拍再补上
    setAnnouncement('');
    const timer = setTimeout(() => setAnnouncement(t('row.code-refreshed')), 60);
    return () => clearTimeout(timer);
  }, [code, t]);

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

  const title = account.account
    ? t('name.with-issuer', { issuer: account.issuer, account: account.account })
    : account.issuer;
  // 3+3 分组沿用 Google Authenticator 的展示惯例，见 core/totp.ts
  const display = invalid ? '———' : formatCode(code);
  const codeClass = invalid ? 'text-fg-muted' : urgent ? 'text-warn' : 'text-code';

  const pinnedMark = account.pinned && (
    <PinIcon size={11} filled className="shrink-0 text-accent" />
  );

  const actions = (
    <div className={`ml-auto flex shrink-0 items-center gap-1 ${HOVER_REVEAL}`}>
      <IconButton
        label={account.pinned ? t('row.unpin') : t('row.pin')}
        active={account.pinned}
        onClick={(e) => {
          e.stopPropagation();
          void togglePin(account.id);
        }}
      >
        <PinIcon size={14} filled={account.pinned} />
      </IconButton>
      <IconButton
        label={t('row.edit')}
        onClick={(e) => {
          e.stopPropagation();
          openSheet({ kind: 'edit', id: account.id });
        }}
      >
        <PencilIcon size={14} />
      </IconButton>
      <IconButton
        label={t('row.delete')}
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
      ref={row}
      className={`row-divider group relative ${compact ? 'h-11' : metrics.row} ${
        dragging ? 'opacity-40' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      role="button"
      tabIndex={0}
      // 读屏用户看不到大字码，所以把验证码本身也念出来 —— 否则"点击复制"
      // 等于让人复制一个还没听到的东西
      aria-label={
        invalid
          ? t('row.aria.invalid', { name: title })
          : t('row.aria.copy', { name: title, code: formatCode(code) })
      }
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
           而紧凑模式本来就是"只想快速抄一串码"，管理动作留给正常模式。
           置顶图钉也不放：11px 的图标会让那一行的账户名整体右移，
           一列里只有一行缩进看着像没对齐；置顶本来就已经排在最前面。 */
        <div className="flex h-full items-center gap-3 px-4 transition-colors duration-150 group-hover:bg-row-hover">
          <span className="truncate text-[13px] text-fg">{title}</span>
          <span className={`code ml-auto shrink-0 text-[17px] ${codeClass}`} dir="ltr">
            {display}
          </span>
          <Countdown
            remaining={remaining}
            period={account.period}
            warnAt={WARN_AT}
            size={20}
            showNumber={false}
          />
        </div>
      ) : (
        <div className="flex h-full w-full flex-col justify-center gap-1.5 px-4 py-3 transition-colors duration-150 group-hover:bg-row-hover">
          {/* 第一行：首字母 + 账户名 + 拖拽把手 + hover 图标 */}
          <div className="flex min-w-0 items-center gap-2.5">
            {showInitials && <Initials issuer={account.issuer} account={account.account} />}
            <span className={`truncate font-medium text-fg ${metrics.name}`}>{title}</span>
            {/* 把手跟在文字后面：它收拾的是"这一行"，先看到是谁再看怎么挪。
                只画在能拖的时候，但两种状态占同样宽度 —— 切换排序方式时整列文字不会左右跳一下。
                和右边的管理图标一样只在 hover / 聚焦时浮现：常驻一排灰线会盖过验证码本身 */}
            {draggable ? (
              <GripIcon size={14} className={`shrink-0 text-fg-muted ${HOVER_REVEAL}`} />
            ) : (
              <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            )}
            {pinnedMark}
            {actions}
          </div>

          {/* 第二行：验证码 + 复制图标 …… 倒计时环 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`code transition-colors duration-200 ${codeClass} ${metrics.code}`}
                dir="ltr"
              >
                {display}
              </span>
              {/* 复制图标紧贴验证码：它动作的对象就是这串码。
                  放到行尾会让人以为最右边那个圆环才是复制按钮。
                  平时不显示：整行点一下就是复制，图标只在 hover 时作为确认 */}
              <CopyIcon size={16} className={`shrink-0 text-fg-muted ${HOVER_REVEAL}`} />
            </div>

            <Countdown
              remaining={remaining}
              period={account.period}
              warnAt={WARN_AT}
              size={metrics.ring}
            />
          </div>
        </div>
      )}

      {/* 播报区必须一直挂着：读屏只监听节点的文字变化，
          临到要说话才插入节点，那句话多半不会被念出来 */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
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
