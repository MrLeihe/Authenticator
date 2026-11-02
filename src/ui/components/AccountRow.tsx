import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
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
const METRICS: Record<UiStyle, { row: string; height: number; ring: number; name: string; code: string }> = {
  modern: { row: 'h-24', height: 96, ring: 32, name: 'text-[15px]', code: 'font-semibold' },
  classic: { row: 'h-[88px]', height: 88, ring: 28, name: 'text-[14px]', code: 'font-medium' },
};

/** 紧凑视图 44px。和 `h-11` 是同一个数，只写在这一处 */
const COMPACT_HEIGHT = 44;

/**
 * 一行的高度。列表页画拖拽插入位置时要用它算偏移 ——
 * 那边不能自己再写一份 96/88/44，改了版式却只改一边，插入线就会落错半行。
 */
export function rowHeight(style: UiStyle, view: ViewMode): number {
  return view === 'compact' ? COMPACT_HEIGHT : METRICS[style].height;
}

/**
 * 行内次要图标（拖拽把手、复制、置顶/编辑/删除）的统一显示方式：
 * 平时透明，鼠标移到这一行或键盘焦点落在这一行时才浮现。
 *
 * 为什么同一个常量要复用这几处：只要有一处写漏，就会出现"一半图标常驻、
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
 *
 * 这里只管显隐，不管过渡：过渡由用它的元素自己声明。图钉按钮同时要过渡颜色和透明度，
 * 两个 `transition-*` 写在同一元素上会互相覆盖（谁排在后面谁生效），
 * 所以按钮用 `transition`（覆盖颜色 + 透明度），纯图标用 `transition-opacity`。
 */
const HOVER_REVEAL =
  'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-has-[:focus-visible]:opacity-100';

interface AccountRowProps {
  account: Account;
  code: string;
  remaining: number;
  view: ViewMode;
  style: UiStyle;
  showInitials: boolean;
  /** 只有「手动排序 + 没在搜索」时才能拖，否则拖完位置会被排序覆盖 */
  draggable: boolean;
  /** 这一行是不是正被拖着（会浮起来跟着指针走） */
  dragging: boolean;
  /** 被拖行随指针移动的偏移量（px）；非被拖行为 0 */
  dragOffset: number;
  /** 其它行给落点让位的位移，-1 / 0 / +1（单位：行高） */
  shift: number;
  /** 越过阈值、真正开始拖了：把「谁、起点 y」报给列表页 */
  onDragStart: (id: string, startY: number) => void;
  /** 拖动中每一帧的指针 y —— 列表页据此算落点、让行让位 */
  onDragMove: (pointerY: number) => void;
  /** 松手。落点已在列表页算好 */
  onDragEnd: () => void;
  /** 刚被拖到新位置：整行泛一下底色，让人跟得上它跳到了哪儿 */
  landed?: boolean;
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
  dragOffset,
  shift,
  onDragStart,
  onDragMove,
  onDragEnd,
  landed = false,
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

  /**
   * 自绘拖拽的起点探测。
   *
   * 不用 HTML5 的 draggable：那套只能给一个系统截图的幽灵，做不出"被拖行浮起来
   * 跟着指针、其它行让位让出一个空档"的手感，而且幽灵长得像截图、没有阴影。
   *
   * 这里的协议是：在行上按下 → 移动超过 6px 才算拖（否则就是一次点击复制）→
   * 把后续的 move / up 挂到 window 上（指针很快会离开这一行，挂在行上会丢事件）
   * → 每一帧把指针 y 报给列表页，由列表页算落点、分发让位。
   */
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const latest = useRef({ onDragMove, onDragEnd });
  latest.current = { onDragMove, onDragEnd };

  /**
   * 吞掉拖拽结束后浏览器补发的那一发 click。
   *
   * 按下与抬起落在同一元素上时，浏览器会在 pointerup 之后补一个 click；
   * 不吞的话拖完顺手就把验证码复制了。
   *
   * 关键是**不能只在被拖的那一行上打标记**：拖到别的行松手时，click 派发给的是
   * 两行的共同祖先（列表容器），被拖行根本收不到这一发 click，标记就永远留着 ——
   * 表现是"拖过一次之后，这一行要点两下才能复制"。所以改在 window 的捕获阶段
   * 一次性拦掉：它先于 React 挂在容器上的委托监听器执行，直接掐断，
   * 任何一行都不会收到这一发。
   *
   * 定时器是必须的兜底：pointercancel 之后不会有 click，
   * 监听器不能留在 window 上等用户的下一发真实点击。
   */
  const swallowNextClick = () => {
    // 这里要的是 DOM 的 Event，不是 React 的合成事件 —— 用 EventListener
    // 而不是 `MouseEvent`：后者在本文件里已经被 react 的同名类型占住了
    const swallow: EventListener = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  };

  // window 上的监听器只建一次，回调永远读最新的（走 latest 而不是闭包）：
  // 把 onDragMove 写进依赖数组的话，每次 render 都会摘挂一遍，
  // 指针 move 正好落在那个空档里就会漏一帧
  const windowHandlers = useRef<{ move: (e: PointerEvent) => void; up: () => void } | null>(null);
  if (windowHandlers.current === null) {
    windowHandlers.current = {
      move: (e) => latest.current.onDragMove(e.clientY),
      up: () => {
        const h = windowHandlers.current!;
        window.removeEventListener('pointermove', h.move);
        window.removeEventListener('pointerup', h.up);
        window.removeEventListener('pointercancel', h.up);
        if (draggingRef.current) swallowNextClick();
        draggingRef.current = false;
        latest.current.onDragEnd();
      },
    };
  }

  // 组件卸载时兜底：拖到一半整个列表被换掉（锁屏、切搜索），别把监听器留在窗口上
  useEffect(() => {
    const h = windowHandlers.current!;
    return () => {
      window.removeEventListener('pointermove', h.move);
      window.removeEventListener('pointerup', h.up);
      window.removeEventListener('pointercancel', h.up);
    };
  }, []);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable || e.button !== 0) return;
    // 置顶/编辑/删除是真按钮，按下它们不该触发拖拽
    if ((e.target as HTMLElement).closest('button')) return;
    pressRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || draggingRef.current) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 6) return;
    // 越过阈值：从"可能的点击"转正成"拖动"
    draggingRef.current = true;
    pressRef.current = null;
    const h = windowHandlers.current!;
    window.addEventListener('pointermove', h.move);
    window.addEventListener('pointerup', h.up);
    window.addEventListener('pointercancel', h.up);
    onDragStart(account.id, press.y);
  };

  const handlePointerUp = () => {
    pressRef.current = null;
  };

  const handleClick = () => {
    activate();
  };

  const title = account.account
    ? t('name.with-issuer', { issuer: account.issuer, account: account.account })
    : account.issuer;
  // 3+3 分组沿用 Google Authenticator 的展示惯例，见 core/totp.ts
  const display = invalid ? '———' : formatCode(code);
  const codeClass = invalid ? 'text-fg-muted' : urgent ? 'text-warn' : 'text-code';

  const actions = (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {/* 三枚都是纯动作，一律 hover / 键盘聚焦时浮现 —— 状态不在这里讲。
          「钉住了」由行右上角的角标负责（见下方大段注释）：
          以前状态和动作挤在同一枚图标上，平时只有一枚 14px 的蓝色图钉常驻，
          在 96px 高的行里既不挨着谁也不像按钮，看着就是"孤零零的"；
          鼠标一移上去又冒出编辑/删除，同一枚图标一会儿当状态读、一会儿当按钮点。
          拆开后各归各位：角标常驻、只读、贴着行的边界；按钮只管被点。
          pinned 时这一枚仍然填色 + 强调色，因为那时角标已经淡出，
          它得自己说明"当前是钉着的，再点就取消" */}
      <IconButton
        label={account.pinned ? t('row.unpin') : t('row.pin')}
        active={account.pinned}
        className={HOVER_REVEAL}
        onClick={(e) => {
          e.stopPropagation();
          void togglePin(account.id);
        }}
      >
        <PinIcon size={14} filled={account.pinned} />
      </IconButton>
      <IconButton
        label={t('row.edit')}
        className={HOVER_REVEAL}
        onClick={(e) => {
          e.stopPropagation();
          openSheet({ kind: 'edit', id: account.id });
        }}
      >
        <PencilIcon size={14} />
      </IconButton>
      <IconButton
        label={t('row.delete')}
        className={HOVER_REVEAL}
        onClick={(e) => {
          e.stopPropagation();
          openSheet({ kind: 'delete', id: account.id });
        }}
      >
        <TrashIcon size={14} />
      </IconButton>
    </div>
  );

  const height = rowHeight(style, view);
  // 被拖行浮起来：动态的 transform 留在内联（要跟指针逐帧变），静态的"抬升"视觉
  // （表面底色 + 圆角 + 描边阴影）在 globals.css 的 .drag-lift 里，靠主题变量换肤。
  // 其它行靠 shift（± 行高）平移给落点让位，带 180ms 缓动。
  const liftStyle: CSSProperties | undefined = dragging
    ? {
        transform: `translateY(${dragOffset}px) scale(1.02)`,
        zIndex: 20,
        willChange: 'transform',
        // 显式关掉过渡：FLIP 会在行上留下 `transition: transform 240ms`，
        // 不在这里压掉的话，被拖行会带着 240ms 的延迟跟着指针，一卡一卡的
        transition: 'none',
      }
    : shift !== 0
      ? {
          transform: `translateY(${shift * height}px)`,
          transition: 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }
      : undefined;

  return (
    <div
      ref={row}
      style={liftStyle}
      data-account-id={account.id}
      // 光标说明的是"点下去会发生什么"：整行点击 = 复制验证码，所以是 pointer；
      // 正在被拖的这一行给 grabbing。拖动手势只给把手（见下面的 grip）——
      // 整行挂 grab 会让人以为点一下也会开始拖，而实际上点一下是复制
      className={`row-divider group relative ${dragging ? 'cursor-grabbing drag-lift' : 'cursor-pointer'} ${
        compact ? 'h-11' : metrics.row
      }`}
      role="button"
      tabIndex={0}
      // 读屏用户看不到大字码，所以把验证码本身也念出来 —— 否则"点击复制"
      // 等于让人复制一个还没听到的东西
      aria-label={
        invalid
          ? t('row.aria.invalid', { name: title })
          : t('row.aria.copy', { name: title, code: formatCode(code) })
      }
      onClick={handleClick}
      onKeyDown={onKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 紧凑模式没地方放角标，退化成左边缘一根 2px 蓝线，不占行内空间 */}
      {account.pinned && compact && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-accent"
        />
      )}

      {compact ? (
        /* 紧凑模式：一行读完 —— 弹出的窗口里能多塞好几个账户。
           这里故意不放操作按钮：塞进去会让圆环在 hover 时左右横跳，
           而紧凑模式本来就是"只想快速抄一串码"，管理动作留给正常模式。
           置顶状态不吃行内空间，改由左边缘那根 2px 蓝线表示（见上面的角标块）——
           放一枚 11px 图标会让那一行的账户名整体右移，一列里只有一行缩进看着像没对齐 */
        <div
          className={`flex h-full items-center gap-3 px-4 transition-colors duration-150 ${
            dragging ? '' : 'group-hover:bg-row-hover'
          } ${landed ? 'animate-row-land' : ''}`}
        >
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
        <div
          className={`flex h-full w-full flex-col justify-center gap-1.5 px-4 py-3 transition-colors duration-150 ${
            dragging ? '' : 'group-hover:bg-row-hover'
          } ${landed ? 'animate-row-land' : ''}`}
        >
          {/* 第一行：首字母 + 账户名 + 拖拽把手 + hover 图标 */}
          <div className="flex min-w-0 items-center gap-2.5">
            {showInitials && <Initials issuer={account.issuer} account={account.account} />}
            <span className={`truncate font-medium text-fg ${metrics.name}`}>{title}</span>
            {/* 置顶标记：跟在账户名后面的小药丸，和名字同一行、垂直居中对齐。
                放在行内而不是浮在左上角——浮上去会占掉顶部一行、把卡片压得偏重，
                和没置顶的卡片对不齐。灰色底 + 灰字，跟 WeChat 置顶标签一样低调：
                「置顶」是状态不是主操作。只读常驻，取消置顶仍走右侧图钉按钮 */}
            {account.pinned && !compact && (
              <span
                aria-hidden="true"
                className="inline-flex h-[16px] shrink-0 items-center rounded-full bg-surface-alt px-1.5 text-[10px] font-medium leading-none text-fg-secondary"
              >
                {t('row.pin')}
              </span>
            )}
            {/* 把手跟在文字后面：它收拾的是"这一行"，先看到是谁再看怎么挪。
                只画在能拖的时候，但两种状态占同样宽度 —— 切换排序方式时整列文字不会左右跳一下。
                和右边的管理图标一样只在 hover / 聚焦时浮现：常驻一排灰线会盖过验证码本身 */}
            {draggable ? (
              // 把手是这一行里最不像控件的东西（六个点，既不是按钮也没有文字），
              // 悬停给一句「拖动排序」。title 挂在包裹的 span 上：SVG 上的 title
              // 属性在 Chrome 里不出提示，要的是 <title> 子元素，那又会进无障碍树。
              // span 用 flex 而不是默认的行内盒：行内盒会按字体行高撑出一道
              // 基线以下的空隙，图标看着比左边的账户名高半个像素
              <span
                title={t('row.drag-hint')}
                // grab 只挂在这里：拖拽其实从整行任何位置按下+拖动都能发起，
                // 但光标只在把手上示意 —— 这里是唯一"看起来就该拖"的地方，
                // 把它做成暗示，比让整个列表都变成抓手更不影响"点一下复制"这个主操作
                className="flex shrink-0 cursor-grab active:cursor-grabbing"
              >
                <GripIcon
                  size={14}
                  className={`text-fg-muted transition-opacity duration-150 ${HOVER_REVEAL}`}
                />
              </span>
            ) : (
              <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            )}
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
              <CopyIcon
                size={16}
                className={`shrink-0 text-fg-muted transition-opacity duration-150 ${HOVER_REVEAL}`}
              />
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
  className = '',
  children,
}: {
  label: string;
  onClick: (e: MouseEvent) => void;
  active?: boolean;
  /** 显隐（`HOVER_REVEAL`）从这里进：容器一旦带 opacity-0，子元素再怎么设都白搭 */
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // 三个图标都没有文字，光靠图形认「置顶 / 编辑 / 删除」要试一下才知道，
      // 删除还会真的删掉东西。悬停给一句和 aria-label 同源的提示：
      // 读屏念的和眼睛看到的是同一句话，不会出现"读屏说置顶、提示说钉住"这种分叉。
      // 用原生 title 而不是自绘 tooltip：这一排图标本身只有 22px，
      // 自绘气泡在 400px 宽的弹窗里盖住验证码比帮上忙更烦；
      // 顶部那一排图标按钮（ListScreen 的 HeaderButton）也是这么做的
      title={label}
      // 用 `transition` 而不是 `transition-colors`：置顶这一枚既过渡颜色也过渡透明度，
      // 两套 transition-property 撞在同一个元素上时总有一套会失效
      className={`rounded-[6px] p-1 transition duration-150 hover:bg-surface-alt ${
        active ? 'text-accent' : 'text-fg-muted hover:text-fg'
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
