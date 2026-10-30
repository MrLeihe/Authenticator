import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { latestBackup } from '@/platform/vault-service';
import type { BackupSnapshot } from '@/platform/vault-service';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { useAppStore } from '../store';
import type { Sheet } from '../store';
import { Button } from './Button';
import { ArchiveIcon, ChevronRightIcon, KeyIcon, PhoneIcon, QrCodeIcon, ScreenIcon, TransferIcon } from './Icons';

/**
 * 一条账户都没有时的首屏。
 *
 * 它不是"空状态提示"，是**分诊台**：先问一句"你的验证码在哪里"，
 * 再按用户此刻手上有什么分四路。按功能分（扫码 / 手动 / 导入）是错的 ——
 * 那要求用户先知道自己属于哪一类，而第一次用的人恰恰不知道自己属于哪一类。
 *
 * **主按钮 + 问句 + 四张卡**，而不是五张等权的卡。曾经试过把"扫描此页面"
 * 也做成一张卡、和其余几张平权，结果是这一路被埋掉了：它是唯一一步出结果的动作
 * （其余几路都要先进引导页再进表单），而且打开扩展的那一刻，二维码通常就摆在屏幕上，
 * 本来就该是默认动作。平权等于告诉用户"这几件事一样常见"，那是假话。
 *
 * 但"我正在开启两步验证"那张卡不是主按钮的重复：主按钮假设二维码已经在屏幕上，
 * 它假设用户还没走到那一步（不知道去网站的哪儿开）。所以它进的是步骤页 ——
 * 两者终点相同、前提不同。删过一次，删错了。
 *
 * 按钮下面不写解释小字。写过一版"直接读当前标签页上的二维码，不用自己截图"，
 * 是说给自己听的：用户在空态要的是"点哪个"，不是"它怎么做到的"。
 * 原理留在扫码页里说 —— 那一页有"扫描当前页面"和"上传图片"两个入口并存，
 * 才需要一句说明它们的分工。
 *
 * 卡片按用户"手上有什么"分，不按功能分 —— 按功能分（扫码 / 手动 / 导入）
 * 要求用户先知道自己属于哪一类，而第一次用的人恰恰不知道。
 */
/**
 * 四张分诊卡的静态配置。`onClick` 用到 `openSheet`，而 `openSheet` 是 store 的
 * selector，不能在模块顶层调用，所以这里只存 `tone` / `icon` / 文案键，
 * `onClick` 在组件体内按 `tone` 映射回去。
 *
 * 顺序即含义：
 * 1. setup   —— 主按钮假设"二维码已在屏幕上"，这张卡假设"用户还没走到那一步"，
 *              所以进步骤页，讲清去网站的哪儿开。和主按钮终点相同、前提不同。
 * 2. phone   —— 手机上已有验证器，转移过来。
 * 3. secret  —— 手上只有一串密钥，手动输入。
 * 4. import  —— 东西在别的应用或备份文件里。它和上面几张是同一层级的"处境"，
 *              不再是一条附注式的蓝色文字链。
 */
type CardKey = 'setup' | 'phone' | 'secret' | 'import';

const CARDS: {
  key: CardKey;
  tone: Tone;
  icon: ReactNode;
  title: MessageKey;
  hint: MessageKey;
}[] = [
  {
    key: 'setup',
    tone: 'success',
    icon: <QrCodeIcon size={16} />,
    title: 'empty.card.setup',
    hint: 'empty.card.setup.hint',
  },
  {
    key: 'phone',
    tone: 'accent',
    icon: <PhoneIcon size={16} />,
    title: 'empty.card.phone',
    hint: 'empty.card.phone.hint',
  },
  {
    key: 'secret',
    tone: 'violet',
    icon: <KeyIcon size={16} />,
    title: 'empty.card.secret',
    hint: 'empty.card.secret.hint',
  },
  {
    key: 'import',
    tone: 'teal',
    icon: <TransferIcon size={16} />,
    title: 'empty.card.import',
    hint: 'empty.card.import.hint',
  },
];

/** 每张卡按 `tone` 决定跳转到哪个界面 */
function cardTarget(key: CardKey, openSheet: (sheet: Sheet) => void): void {
  switch (key) {
    case 'setup':
      openSheet({ kind: 'guide', guide: 'setup' });
      break;
    case 'phone':
      openSheet({ kind: 'guide', guide: 'phone' });
      break;
    case 'secret':
      openSheet({ kind: 'guide', guide: 'secret' });
      break;
    case 'import':
      openSheet({ kind: 'import' });
      break;
  }
}

export function EmptyGuide() {
  const t = useT();
  const openSheet = useAppStore((s) => s.openSheet);

  return (
    <div className="animate-rise-in pb-5 pt-4">
      <BackupBanner />

      <h2 className="text-center text-[18px] font-semibold tracking-tight">
        {t('list.empty.title')}
      </h2>

      <div className="mt-4">
        <Button onClick={() => openSheet({ kind: 'add', mode: 'scan', autoscan: true })}>
          <ScreenIcon size={16} />
          {t('empty.scan-page')}
        </Button>
      </div>

      <p className="mb-2 mt-4 text-center text-[13px] text-fg-secondary">{t('list.empty.body')}</p>

      <div className="space-y-2">
        {/* 四张卡用 index*60ms 的交错延迟依次浮起（参考实现的 onboarding 做法）。
            不逐张手写数字，改由 map 驱动，避免加/减卡片时漏改序号。
            延迟只作用于入场，不作用于 hover：animation 是 backwards fill，首帧前的
            那点透明不残留，过渡里点下去依然即时响应 */}
        {CARDS.map((card, index) => (
          <GuideCard
            key={card.key}
            tone={card.tone}
            icon={card.icon}
            title={t(card.title)}
            hint={t(card.hint)}
            delay={index * 60}
            onClick={() => cardTarget(card.key, openSheet)}
          />
        ))}
      </div>

      {/* 兜底一条：给"什么都没有，但网站现在就卡在这一步"的人。
          他不走表单 —— 他缺的是别人告诉他接下来该做什么，不是又一个输入框 */}
      <div className="mt-4 flex justify-center">
        <LinkButton onClick={() => openSheet({ kind: 'guide', guide: 'rescue' })}>
          {t('empty.rescue')}
        </LinkButton>
      </div>
    </div>
  );
}

type Tone = 'accent' | 'success' | 'violet' | 'teal';

/** 图标底的四种色调。只用来区分四张卡，不承载任何状态含义。
 *  暗色下要提一档不透明度：10% 的色块压在 dark-800 上几乎和卡片同色，
 *  等于把"四张卡是四件事"这个提示抹掉了 */
const TONE: Record<Tone, string> = {
  accent: 'bg-accent/10 text-accent dark:bg-accent/20',
  success: 'bg-success/10 text-success dark:bg-success/20',
  violet: 'bg-violet/10 text-violet dark:bg-violet/20',
  teal: 'bg-teal/10 text-teal dark:bg-teal/20',
};

function GuideCard({
  tone,
  icon,
  title,
  hint,
  delay,
  onClick,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  hint: string;
  delay: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      style={{ animationDelay: `${delay}ms` }}
      className="flex w-full animate-rise-in items-center gap-3 rounded-card bg-surface py-3 pl-3.5 pr-3 text-left transition-colors duration-150 hover:bg-row-hover"
      onClick={onClick}
    >
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${TONE[tone]}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-tight">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-fg-muted">{hint}</span>
      </span>
      <ChevronRightIcon size={14} className="shrink-0 text-fg-muted/50" />
    </button>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-accent transition-colors duration-150 hover:text-accent-press"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * 本机备份横幅。
 *
 * 只在"列表空着、但本机还躺着快照"时出现 —— 那正是用户最需要知道这件事的一刻
 * （删光了、或者刚重载完扩展）。快照与保险库用同一个 DEK 加密，
 * 所以它救不了"卸载重装"，文案不能许这个诺。
 */
function BackupBanner() {
  const t = useT();
  const restoreBackup = useAppStore((s) => s.restoreBackup);
  const [snapshot, setSnapshot] = useState<BackupSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void latestBackup()
      .then((next) => {
        if (alive) setSnapshot(next);
      })
      // 读不出来就当没有：这一条本来就是锦上添花，不该在空态上再抛一个错
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!snapshot) return null;

  const days = daysAgo(snapshot.date);
  const when = days <= 0 ? t('backup.when-today') : t('backup.when-days', { days });

  return (
    <div className="mb-3 rounded-[12px] bg-accent/[0.08] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <ArchiveIcon size={14} className="mt-[2px] shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-tight">
            {t('backup.title', { count: snapshot.accounts })}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
            {t('backup.hint', { when })}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        className="mt-2 ml-6 rounded-[6px] bg-accent px-3 py-1 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-accent-press disabled:opacity-60"
        onClick={() => {
          setBusy(true);
          void restoreBackup().finally(() => setBusy(false));
        }}
      >
        {t(busy ? 'backup.restoring' : 'backup.restore')}
      </button>
    </div>
  );
}

/** `YYYY-MM-DD` 距今几天。按本地日期算，不引入时区偏移 */
function daysAgo(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return 0;
  const then = new Date(year, month - 1, day).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - then) / 86_400_000);
}
