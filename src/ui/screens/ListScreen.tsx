import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { remainingSeconds } from '@/core/totp';
import type { CachedCode } from '@/core/totp-cache';
import { TotpCache } from '@/core/totp-cache';
import type { Account } from '@/core/types';
import { AccountRow, rowHeight } from '../components/AccountRow';
import { EmptyGuide } from '../components/EmptyGuide';
import { PasswordHintBanner } from '../components/PasswordHintBanner';
import { AppMark, MoonIcon, PlusIcon, SearchIcon, SettingsIcon, SunIcon } from '../components/Icons';
import { useTick } from '../hooks/useTick';
import { useLang, useT } from '../i18n';
import { useResolvedDark } from '../theme';
import {
  filterAccounts,
  sortAccounts,
  useAccounts,
  useAppStore,
  useSettings,
} from '../store';

export function ListScreen() {
  const t = useT();
  const lang = useLang();
  const accounts = useAccounts();
  const settings = useSettings();
  const canRecover = useAppStore((s) => s.canRecover);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const setSettings = useAppStore((s) => s.setSettings);
  const showToast = useAppStore((s) => s.showToast);
  const openSheet = useAppStore((s) => s.openSheet);
  const reorderAccount = useAppStore((s) => s.reorderAccount);
  const dark = useResolvedDark(settings.theme);

  // 拖拽排序：只有「手动」排序且没在搜索时才允许 ——
  // 搜索状态下列表只是全集的一个子集，拖出来的位置对不上真实顺序
  const manual = settings.sortBy === 'manual' && query.trim() === '';
  /**
   * 自绘拖拽的状态。`pointerY` 每一帧更新，落点和让位都从它推出来。
   * `top` 是列表卡片顶部的视口 y —— 自动滚动时卡片会跟着往上走，要随滚更新，
   * 否则"指针在第几条之间"会越拖越偏。
   */
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    startY: number;
    pointerY: number;
    /** 列表卡片顶部此刻的视口 y，自动滚动时随滚更新 */
    top: number;
    /** 拖动开始那一刻的列表顶部 —— 用来抵消滚动，让被拖行一直贴住指针 */
    startTop: number;
  } | null>(null);
  /** 刚落到新位置的那一条：泛一下底色，让眼睛跟得上它跳到了哪儿 */
  const [landed, setLanded] = useState<string | null>(null);

  // 指针 y 单独放一份 ref：自动滚动的 interval 每隔 16ms 读它，
  // 不能依赖 React 状态（更新会晚半拍，而且会把 interval 逼着重挂）
  const pointerRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const now = useTick(250);
  const cache = useRef(new TotpCache());
  const [codes, setCodes] = useState<Map<string, CachedCode>>(new Map());

  const visible = useMemo(
    () => filterAccounts(sortAccounts(accounts, settings.sortBy, lang), query),
    [accounts, settings.sortBy, lang, query],
  );

  const rowH = rowHeight(settings.style, settings.view);
  /** 被拖行此刻在列表里的位移（px），已抵消自动滚动的位移 */
  const dragOffset = drag ? drag.pointerY - drag.startY + (drag.startTop - drag.top) : 0;
  /**
   * 落点：插到 `visible[dropIndex]` 之前，等于列表长度时表示末尾。
   *
   * 按被拖行的**前缘**算，不按中心、更不按指针：
   * - 指针贴在被拖行的哪个位置，取决于用户从哪抓起（抓顶部就贴顶边），
   *   拿它当参照，会把"该换了"拖到盖满之后。
   * - 中心当参照，要等中心越过下一行的中心才换 —— 那时已经"完全盖住"了。
   * 前缘（往下拖用底边、往上拖用顶边）一越过下一行的中线，下一行就立刻让位 ——
   * 也就是"盖住一半就自动上移"，和直觉同步。
   */
  const leadingEdge =
    drag !== null
      ? dragOffset >= 0
        ? drag.from * rowH + dragOffset + rowH // 底边
        : drag.from * rowH + dragOffset // 顶边
      : 0;
  const dropIndex =
    drag !== null
      ? Math.min(Math.max(Math.round(leadingEdge / rowH), 0), visible.length)
      : null;

  /**
   * 这一行要不要给落点让位。被拖行浮起来、离开原位之后，其它行平移一格，
   * 在落点处让出一个空档 —— 拖到哪，空档开到哪。
   *
   * 向下拖（dropIndex > from）：`(from, dropIndex)` 之间的一起上移一格；
   * 向上拖（dropIndex < from）：`[dropIndex, from)` 之间的一起下移一格。
   */
  const shiftFor = (index: number): number => {
    if (drag === null || dropIndex === null || index === drag.from) return 0;
    if (drag.from < dropIndex && index > drag.from && index < dropIndex) return -1;
    if (drag.from > dropIndex && index >= dropIndex && index < drag.from) return 1;
    return 0;
  };

  // 每次 tick 只让缓存重算翻页的那几个账户，其余直接命中
  useEffect(() => {
    let alive = true;
    void cache.current.refresh(visible, now).then((next) => {
      if (alive) setCodes(next);
    });
    return () => {
      alive = false;
    };
  }, [visible, now]);

  /**
   * FLIP：列表顺序变化（置顶 / 取消置顶 / 改排序）时，让行平滑滑到新位置，
   * 而不是整表瞬间跳一下。这就是"点置顶整个列表闪一下"的元凶 ——
   * 其实不是重渲染，是顺序变完那一帧所有行都平移了一格，肉眼看起来像闪。
   *
   * 拖拽不在这里管：它有自己的"让位"动画，硬套 FLIP 会把行往回拽。
   *
   * 这里**不设依赖**，每次 commit 都重测一遍位置：像「还没设密码」提示条这种
   * 异步冒出来的元素会让列表整体下移 48px，若只在 `visible` 变化时才重测，
   * 旧位置会一直差 48px，下次置顶时所有行都被误判成"移过了"。每帧重测，
   * 250ms 的 tick 会很快把新布局追上；再配合下面的"只动画整数个行高"，
   * 48px 这种非换位的布局变化既不会闪、也不会把真换位算错。
   */
  const positions = useRef<Map<string, number>>(new Map());
  const wasDragging = useRef(false);

  useLayoutEffect(() => {
    const root = listRef.current;
    if (!root) return;

    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-account-id]'));
    const next = new Map<string, number>();
    for (const el of rows) next.set(el.dataset.accountId!, el.offsetTop);

    const justDropped = wasDragging.current && drag === null;
    wasDragging.current = drag !== null;

    // 拖拽中 / 拖拽刚结束：行的视觉位置由 shift / 落位负责，这里只跟踪真实位置
    if (drag !== null || justDropped) {
      positions.current = next;
      return;
    }

    // 第一帧没有历史位置，只记录、不动画
    if (positions.current.size !== 0) {
      // 只动画「整数个行高」的位移：置顶/改排序把行移动整数行；提示条出现这类
      // 布局变化是任意像素（48px），不该被当成"这一行被挪了"去播放
      const shouldMove = (el: HTMLElement) => {
        const prev = positions.current.get(el.dataset.accountId!);
        if (prev === undefined) return false;
        const delta = prev - el.offsetTop;
        return delta !== 0 && delta % rowH === 0;
      };
      // 先反向摆回旧位置（瞬间、无过渡），再强迫重排，下一拍回到新位置带过渡
      for (const el of rows) {
        if (!shouldMove(el)) continue;
        const delta = positions.current.get(el.dataset.accountId!)! - el.offsetTop;
        el.style.transition = 'none';
        el.style.transform = `translateY(${delta}px)`;
      }
      void root.offsetHeight;
      for (const el of rows) {
        if (!shouldMove(el)) continue;
        el.style.transition = 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        el.style.transform = '';
      }
    }

    positions.current = next;
  });

  const startDrag = (id: string, startY: number) => {
    const rect = listRef.current?.getBoundingClientRect();
    const from = visible.findIndex((account) => account.id === id);
    if (!rect || from < 0) return;
    pointerRef.current = startY;
    setDrag({ id, from, startY, pointerY: startY, top: rect.top, startTop: rect.top });
  };

  const moveDrag = (pointerY: number) => {
    pointerRef.current = pointerY;
    setDrag((d) => (d ? { ...d, pointerY } : d));
  };

  const endDrag = () => {
    if (drag === null || dropIndex === null) return;
    setDrag(null);
    commit(drag.id, drag.from, dropIndex);
  };

  /**
   * 真正落地：把「插到第几条之前」换算成 vault 的 `beforeId`。
   * 要在**去掉被拖的那一条之后**的列表里取邻居，否则向下拖会永远差一位
   * （落点指向自己）。
   */
  const commit = (id: string, from: number, index: number) => {
    const rest = visible.filter((account) => account.id !== id);
    const beforeId = rest[from < index ? index - 1 : index]?.id ?? null;
    // 去掉自己之后，紧随其后的那一条没变 = 拖回原位，别白写一次盘
    if (rest[from]?.id === beforeId) return;
    void reorderAccount(id, beforeId).catch(() => {
      showToast('toast.reorder-failed', { tone: 'danger' });
    });
    setLanded(id);
  };

  // 拖到列表上下边缘时自动滚动：长列表拖不到目标行，就只能一屏一屏地"挪过去再拖"
  useEffect(() => {
    if (drag === null) return;
    const timer = window.setInterval(() => {
      const y = pointerRef.current;
      const margin = 72;
      let step = 0;
      if (y < margin) step = -Math.max(1, Math.round((margin - y) / 6));
      else if (y > window.innerHeight - margin) step = Math.max(1, Math.round((y - (window.innerHeight - margin)) / 6));
      if (step !== 0) {
        window.scrollBy(0, step);
        const rect = listRef.current?.getBoundingClientRect();
        if (rect) setDrag((d) => (d ? { ...d, top: rect.top } : d));
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [drag === null]);

  // 落位反馈只闪一次：600ms 后撤掉，免得下一次拖动前它还挂着
  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), 600);
    return () => clearTimeout(timer);
  }, [landed]);

  // 主题切换是"点一下立刻生效"，存盘失败要当场说一句，不能静默掉
  const switchTheme = (theme: 'light' | 'dark') => {
    void setSettings({ theme }).catch(() => {
      showToast('toast.settings-failed', { tone: 'danger' });
    });
  };

  const remainingOf = (account: Account): number => {
    const period = codes.get(account.id)?.period ?? account.period ?? 30;
    return remainingSeconds(period, now);
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      {/* 底部一根分割线：header 是 sticky + 半透明毛玻璃的，列表往上滚时
          内容会从它下面"透"过去。毛玻璃本身只够糊掉对比度，糊不掉"这里有一行字"，
          一条 hairline 才能把标题栏和信息区切开，滚起来也不会糊成一片 */}
      <header className="sticky top-0 z-10 border-b border-separator bg-bg/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          {/* 图标 + 标题：参考实现的标题栏是有牌面的，
              一个纯文字标题在 400px 的弹窗里会显得像"页签"而不是"应用"。
              标记本身自带底色，不再套一层方块 —— 圆外面再包圆角方会变成两层边框 */}
          <AppMark size={20} className="shrink-0 text-accent" />
          <h1 className="text-[17px] font-semibold tracking-tight">{t('app.name')}</h1>

          <div className="ml-auto flex items-center gap-1">
            {/* 三个都是同样的幽灵按钮：右上角一排里有一个是实心方块时，
                那一排就永远对不齐视觉重量。强调动作靠颜色（accent）而不是填充 */}
            <HeaderButton label={t('list.add')} onClick={() => openSheet({ kind: 'add' })} accent>
              <PlusIcon size={19} />
            </HeaderButton>
            {/* 画的是"点下去会变成什么"：现在是浅色就画月亮 */}
            <HeaderButton
              label={dark ? t('list.theme-to-light') : t('list.theme-to-dark')}
              onClick={() => switchTheme(dark ? 'light' : 'dark')}
            >
              {dark ? <SunIcon size={19} /> : <MoonIcon size={19} />}
            </HeaderButton>
            <HeaderButton
              label={t('settings.title')}
              onClick={() => openSheet({ kind: 'settings' })}
            >
              <SettingsIcon size={19} />
            </HeaderButton>
          </div>
        </div>

        {/* 搜索框通栏。视图切换（正常/紧凑）挪到设置里 ——
            它和搜索框挤在同一行时，搜索框只剩 ~250px，
            而"换个视图"一个月也用不了一次，不值得长期占着首页最好的一块横向空间。
            一条账户都没有时不画：空列表搜不出东西，那一条横向空间该让给引导区 */}
        {accounts.length > 0 && (
          <div className="relative mt-2.5">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-muted"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('list.search')}
              className="h-11 w-full rounded-[14px] bg-surface-alt pl-10 pr-3 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
            />
          </div>
        )}
      </header>

      {/* 没设密码时提醒一句。已经有账户才提醒 —— 一个还没装任何码的列表，
          提醒"别人能看到你的验证码"只会让人紧张而不知道在说什么 */}
      {!canRecover && accounts.length > 0 && <PasswordHintBanner />}

      <main
        className={`flex-1 ${
          accounts.length === 0 || settings.style === 'modern' ? 'px-4 pt-2' : 'pt-1.5'
        }`}
      >
        {visible.length === 0 ? (
          // 两类"空"必须分开：一条都没有时给分诊引导，搜不到时只解释搜索
          accounts.length === 0 ? (
            <EmptyGuide />
          ) : (
            <NoMatchState />
          )
        ) : (
          /* 列表是一张白卡：灰底 + 白卡是 iOS 分组列表的层次基础。
             行本身不带底色，hover 时铺一层 row-hover —— 这一档必须比页面底深，
             否则 hover 行会和弹窗背景撞色，卡片像被咬掉一块。
             经典版式反过来：不留边距、不切圆角、分隔线通栏，一屏能多读一行 */
          <div ref={listRef} className={`${drag !== null ? 'is-dragging' : ''}`}>
            <div
              className={
                settings.style === 'modern'
                  ? // 拖拽时打开 overflow：被拖行会浮起来、超出卡片上下沿，
                    // 还开着 overflow-hidden 会被圆角卡一刀
                    `mb-4 rounded-card bg-surface ${drag !== null ? 'overflow-visible' : 'overflow-hidden'}`
                  : 'bg-surface [--row-divider-inset:0px]'
              }
            >
              {visible.map((account, index) => {
                const isSource = drag?.id === account.id;
                return (
                  <AccountRow
                    key={account.id}
                    account={account}
                    code={codes.get(account.id)?.code ?? ''}
                    remaining={remainingOf(account)}
                    view={settings.view}
                    style={settings.style}
                    showInitials={settings.showInitials}
                    draggable={manual}
                    dragging={isSource}
                    dragOffset={isSource ? dragOffset : 0}
                    shift={shiftFor(index)}
                    onDragStart={startDrag}
                    onDragMove={moveDrag}
                    onDragEnd={endDrag}
                    landed={landed === account.id}
                  />
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** 顶部那一排小按钮：只有图标，标签走 aria-label / title */
function HeaderButton({
  label,
  onClick,
  accent,
  children,
}: {
  label: string;
  onClick: () => void;
  /** 主操作：靠颜色区分，不用填充色破坏这一排的视觉重量 */
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`rounded-[8px] p-1.5 transition-colors duration-150 hover:bg-surface-alt ${
        accent ? 'text-accent hover:text-accent-press' : 'text-fg-muted hover:text-fg'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * 搜不到：只是关键词没命中，和"一条账户都没有"是两件事。
 * 拿引导页去回答它，等于把"换个词试试"说成"你还没开始"。
 */
function NoMatchState() {
  const t = useT();
  const setQuery = useAppStore((s) => s.setQuery);
  return (
    <div className="flex flex-col items-center justify-center px-8 py-12 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-alt">
        <SearchIcon size={22} className="text-fg-muted" />
      </div>
      <p className="text-[14px] font-medium">{t('list.no-match.title')}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{t('list.no-match.body')}</p>
      <button
        type="button"
        className="mt-4 rounded-[10px] bg-surface px-4 py-2 text-[13px] font-medium text-accent transition-colors duration-150 hover:bg-row-hover"
        onClick={() => setQuery('')}
      >
        {t('list.no-match.clear')}
      </button>
    </div>
  );
}
