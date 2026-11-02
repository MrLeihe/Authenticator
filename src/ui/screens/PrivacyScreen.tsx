import { CardGroup, Note } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../i18n';
import { useAppStore } from '../store';

/**
 * 隐私与数据。
 *
 * 这一页原本长在设置页最底下：三行「版本 / 数据存放 / 网络请求」加一段
 * 「没有账号、没有云端、没有任何统计」。问题不在于说了假话，而在于
 * **它是宣言、不是设置项** —— 用户读一遍就永远不需要再读，却每次打开
 * 设置都要从它旁边滚过去，还占了半屏。
 *
 * 收进来的标准只有一条：只留「别人问起来你能指给他看」的事实 ——
 * 联不联网、密钥在哪、验证码在哪算、要了哪几个权限。至于产品态度，
 * 完整版在仓库的 docs/PRIVACY.md 里，这里放一个链接就够。
 */
const REPO_URL = 'https://github.com/MrLeihe/Authenticator';
const PRIVACY_URL = `${REPO_URL}/blob/main/docs/PRIVACY.md`;
const ISSUES_URL = `${REPO_URL}/issues`;

export function PrivacyScreen() {
  const t = useT();
  const back = useAppStore((s) => s.back);

  return (
    <div className="flex min-h-[280px] flex-col bg-bg pb-4">
      <ScreenHeader title={t('privacy.title')} onBack={back} />

      <div className="pt-3.5">
        <CardGroup title={t('privacy.section.promise')}>
          <Note title={t('privacy.network.title')} hint={t('privacy.network.hint')} />
          <Note title={t('privacy.local.title')} hint={t('privacy.local.hint')} />
          <Note title={t('privacy.offline.title')} hint={t('privacy.offline.hint')} />
        </CardGroup>

        <CardGroup title={t('privacy.section.permissions')}>
          <Note title={t('privacy.perm.storage')} hint={t('privacy.perm.storage.hint')} />
          <Note title={t('privacy.perm.tab')} hint={t('privacy.perm.tab.hint')} />
        </CardGroup>

        {/* 两件事都是「离开扩展去看」：一个条款、一个反馈入口。
            扩展本身不联网，所以这里只是普通的 a 标签，不额外走 tabs API */}
        <div className="mt-1 flex gap-2 px-4">
          <a
            className="flex h-10 flex-1 items-center justify-center rounded-[10px] border border-separator text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-surface-alt"
            href={PRIVACY_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('privacy.policy')}
          </a>
          <a
            className="flex h-10 flex-1 items-center justify-center rounded-[10px] border border-separator text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-surface-alt"
            href={ISSUES_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('privacy.feedback')}
          </a>
        </div>
      </div>
    </div>
  );
}
