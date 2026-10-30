import { useEffect, useState } from 'react';
import { dismissPasswordHint, isPasswordHintDue } from '@/platform/ui-hint';
import { useT } from '../i18n';
import { useAppStore } from '../store';
import { CloseIcon, LockIcon } from './Icons';

/**
 * 「还没设密码」提示条。
 *
 * 这条是首次引导被砍掉之后的补偿：不再在用户没弄懂产品之前拦一屏逼他做决定，
 * 但也**不能假装这件事不存在** —— 一个没有密码的验证器，拿到电脑的人打开就能看码。
 *
 * 三条克制的做法：
 * - 只在**已经有账户**时出现。空列表上提醒"别人能看到验证码"没有意义，那里也没有码。
 * - 点一下直奔设置，不再解释一遍道理（设置里 `PasswordSection` 有完整的说明）。
 * - 关掉之后 7 天再来一次。永久消失等于没写过。
 */
export function PasswordHintBanner() {
  const t = useT();
  const openSheet = useAppStore((s) => s.openSheet);
  /** 存储是异步的：先当作不显示，读到了再冒出来，避免每条列表都闪一下 */
  const [due, setDue] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let alive = true;
    void isPasswordHintDue().then((visible) => {
      if (alive) setDue(visible);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!due || closed) return null;

  const dismiss = () => {
    // 先收起来再写盘：写盘失败也不该让一条已经点掉的提示又跳回来
    setClosed(true);
    void dismissPasswordHint();
  };

  return (
    /* 一张浅蓝小卡，而不是通栏色带：列表现在是白卡，通栏条会把
       "灰底 → 白卡 → 色带" 三层压成一条，反而看不出层次 */
    <div className="mx-4 mt-2 flex items-start gap-1.5 rounded-[12px] bg-accent/[0.08] pl-3 pr-1 py-1.5">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 py-1 text-left"
        onClick={() => openSheet({ kind: 'settings' })}
      >
        <LockIcon size={13} className="mt-[3px] shrink-0 text-accent" />
        <span className="text-[12px] leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">{t('banner.password.title')}</span>
          {' — '}
          {t('banner.password.body')}
        </span>
      </button>
      <button
        type="button"
        aria-label={t('banner.password.dismiss')}
        title={t('banner.password.dismiss')}
        className="mt-0.5 shrink-0 rounded-[6px] p-1 text-fg-muted transition-colors duration-150 hover:bg-surface-alt hover:text-fg"
        onClick={dismiss}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
