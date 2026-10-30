import { Button, SecondaryButton } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { useAppStore } from '../store';
import type { GuideId, Sheet } from '../store';

/**
 * 空态那几张卡片点进来的说明页。
 *
 * 为什么不直接进表单：会点「手机上已经有验证器」的人，恰恰是**还不知道
 * 手上那串东西叫什么**的人。把他直接丢进一个要求填「密钥」的表单，
 * 第一步就卡住了 —— 他不知道手机上没有「密钥」这两个字。
 * 先给三到四步，最后一步才是按钮，中途随时能退出。
 *
 * 三页共用一套模板：都是「按顺序做这几件事 → 做完了点这里」。
 * 单独给每页写布局只会让三页慢慢长得不一样。
 */

interface GuideCopy {
  title: MessageKey;
  steps: readonly MessageKey[];
  action: MessageKey;
  /** 做完之后要去的地方 */
  target: Sheet;
}

const GUIDES: Record<GuideId, GuideCopy> = {
  // 和空态那个主按钮的差别在**前提**上：主按钮假设二维码已经在屏幕上，
  // 这张卡假设用户正在开启两步验证、但还没走到"显示二维码"那一步。
  // 所以它必须先讲网站里怎么找，最后一步才回到"扫刚才那一页"。
  setup: {
    title: 'guide.setup.title',
    steps: ['guide.setup.step1', 'guide.setup.step2', 'guide.setup.step3'],
    action: 'scan.page',
    target: { kind: 'add', mode: 'scan', autoscan: true },
  },
  phone: {
    title: 'guide.phone.title',
    steps: ['guide.phone.step1', 'guide.phone.step2', 'guide.phone.step3', 'guide.phone.step4'],
    action: 'guide.phone.action',
    // 手机导出给你的是一份**批量**格式（`otpauth-migration://`，一个二维码
    // 装着一批账户），一个表单放不下。导入页本来就是干这个的：
    // 选图 → 逐条预览 → 确认合并
    target: { kind: 'import' },
  },
  secret: {
    title: 'guide.secret.title',
    steps: ['guide.secret.step1', 'guide.secret.step2', 'guide.secret.step3'],
    action: 'guide.secret.action',
    target: { kind: 'add', mode: 'manual' },
  },
  rescue: {
    title: 'guide.rescue.title',
    steps: ['guide.rescue.step1', 'guide.rescue.step2', 'guide.rescue.step3'],
    action: 'guide.rescue.action',
    // 这一页说的事就是"网站正显示新二维码"，所以进去就顺手截一次当前页面
    target: { kind: 'add', mode: 'scan', autoscan: true },
  },
};

export function GuideScreen({ guide }: { guide: GuideId }) {
  const t = useT();
  const back = useAppStore((s) => s.back);
  const openSheet = useAppStore((s) => s.openSheet);
  const copy = GUIDES[guide];

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      <ScreenHeader title={t(copy.title)} onBack={back} />

      <div className="flex-1 px-4 pb-4 pt-1">
        <ol className="space-y-4">
          {copy.steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              {/* 序号用圆形而不是 "1." 前缀：弹窗里 320px 的行宽经不起缩进，
                  数字占掉的位置会一路压缩到正文，让每行只剩十几个字 */}
              <span
                aria-hidden="true"
                className="mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[12px] font-semibold text-accent"
              >
                {index + 1}
              </span>
              <p className="text-[13px] leading-relaxed text-fg">{t(step)}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="border-t border-separator px-4 py-3">
        {/* 用 grid 而不是 flex：两个按钮的 variant 自带 `w-full`，
            在 flex 里再传 `w-auto` 谁生效取决于 Tailwind 的类顺序，
            实测会把"返回"撑满整行、主按钮挤出屏幕。
            `auto` 列由内容决定宽度，`w-full` 在这列里就没有副作用 */}
        <div className="grid grid-cols-[auto_1fr] items-center gap-2">
          <SecondaryButton className="px-5" onClick={back}>
            {t('common.back')}
          </SecondaryButton>
          <Button onClick={() => openSheet(copy.target)}>{t(copy.action)}</Button>
        </div>
      </div>
    </div>
  );
}
