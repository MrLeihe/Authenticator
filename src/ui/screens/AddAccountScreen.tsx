import { useEffect, useRef, useState } from 'react';
import { detectImportKind } from '@/core/backup';
import { findOtpauthUris, parseOtpauth } from '@/core/otpauth';
import type { OtpAuthParams } from '@/core/otpauth';
import { capturePageQr } from '@/platform/capture';
import { decodeQrFile } from '@/platform/qr';
import { AccountForm } from '../components/AccountForm';
import { Button, SecondaryButton } from '../components/Button';
import { ChevronRightIcon, QrCodeIcon, ScreenIcon } from '../components/Icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/TextInput';
import { describeError, useMessage } from '../errors';
import type { Message } from '../errors';
import { useT } from '../i18n';
import { useAppStore } from '../store';

/**
 * 添加账户。两条路：手动输入 / 扫码。
 *
 * 两条路做成同级的两格，而不是"表单为主 + 页脚挂一个切换"：
 * 扫码是这个扩展最常用的进法，藏在「取消」下面等于把它降成页脚动作。
 * 但**默认落哪一格仍由入口决定** —— 空态和引导页点进来就是来扫码的，
 * 不该让它们先看一眼空白表单。
 *
 * 扫码这条路**不做任何自动保存**：识别出来的东西要先填进表单让人看一眼再确认。
 * 一张截图里可能是别人的账户，也可能是三个月前作废的密钥，
 * 直接落盘等于替用户做了决定。
 */
export function AddAccountScreen({
  mode: initialMode,
  autoscan,
}: {
  /** 进来先落在哪一栏。空态的三张卡点进来时，用户手上是什么已经知道了 */
  mode?: 'manual' | 'scan' | undefined;
  /** 进来就顺手截一次当前页面 —— 求助页说的就是"网站正显示新二维码" */
  autoscan?: boolean | undefined;
}) {
  const t = useT();
  const closeSheet = useAppStore((s) => s.closeSheet);
  const addAccount = useAppStore((s) => s.addAccount);
  const [mode, setMode] = useState<'manual' | 'scan'>(initialMode ?? 'manual');
  const [prefill, setPrefill] = useState<OtpAuthParams | null>(null);

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      <ScreenHeader title={t(prefill ? 'add.title-confirm' : 'add.title')} onBack={closeSheet} />

      {/* 确认页不给切换控件：这时候要决定的是"保存还是不保存"，
          不是"换一条路再来一次"。想重扫的话，取消就回到扫码那格 */}
      {prefill ? (
        <div className="flex-1 px-4 py-3">
          <p className="mb-3 rounded-[8px] bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-fg">
            {t('add.scan-notice')}
          </p>
          <AccountForm
            key="prefilled"
            initial={prefill}
            submitKey="add.save"
            onSubmit={addAccount}
            onCancel={() => {
              setPrefill(null);
              setMode('scan');
            }}
          />
        </div>
      ) : (
        <>
          <div className="px-4 pt-3">
            <Segmented
              ariaLabel={t('add.tabs')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'manual' as const, label: t('add.manual') },
                { value: 'scan' as const, label: t('add.scan'), icon: <QrCodeIcon size={13} /> },
              ]}
            />
          </div>

          <div className="flex-1 px-4 py-3">
            {/* 手动表单**不卸载**：填到一半想去看看二维码在哪、再回来，
                敲进去的密钥得还在。`hidden` 的元素拿不到焦点，
                所以藏在后面时也不会把焦点从扫码那格抢走 */}
            <div hidden={mode !== 'manual'}>
              <AccountForm
                key="blank"
                submitKey="add.save"
                onSubmit={addAccount}
                onCancel={closeSheet}
              />
            </div>

            {mode === 'scan' && <ScanPane autoscan={autoscan} onParsed={setPrefill} />}
          </div>
        </>
      )}
    </div>
  );
}

/** 扫码面板：当前页面 / 图片（选择 / 拖放 / 粘贴）+ 兜底的 otpauth 链接 */
function ScanPane({
  autoscan,
  onParsed,
}: {
  autoscan?: boolean | undefined;
  onParsed: (params: OtpAuthParams) => void;
}) {
  const t = useT();
  const openSheet = useAppStore((s) => s.openSheet);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);
  const [text, setText] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  /**
   * 三处解码出口共用一句话的落点。
   * 转到导入页不是错误 —— 那一条已经在那边继续了，这里不该再留一行红字。
   */
  const report = (cause: unknown, at: ScanError['at']) => {
    if (cause instanceof RedirectedToImport) return;
    setError({ message: describeError(cause), at });
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const content = await decodeQrFile(file);
      onParsed(readContent(content));
    } catch (cause) {
      report(cause, 'file');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 从识别出来的文本里取参数。
   * 二维码里可能是纯地址，也可能是"地址 + 一段说明"，所以先挑再解析。
   *
   * 例外是迁移码：`otpauth-migration://` 里装着**一批**账户（Google
   * Authenticator 导出手机账户时给的就是它），一个表单装不下，也不能只收
   * 第一条就把其余几条悄悄丢掉。这里交给导入页 —— 它本来就有"预览 →
   * 确认 → 合并"的全套流程，只是平时从文件进来。
   */
  const readContent = (content: string): OtpAuthParams => {
    if (detectImportKind(content) === 'migration') {
      openSheet({ kind: 'import', text: content });
      throw new RedirectedToImport();
    }
    const first = findOtpauthUris(content)[0];
    return parseOtpauth(first ?? content);
  };

  /**
   * 直接读当前标签页上的二维码。
   *
   * 这是这个扩展最顺手的一条路 —— 用户就是在"网站把二维码摆在屏幕上"的
   * 那一刻点开图标的，答案已经在眼前了。截不到（chrome:// 这类页面）或者
   * 页面里没有码时，错误留在原地，下面的上传/粘贴照样能用。
   */
  const scanPage = async () => {
    setError(null);
    setScanning(true);
    try {
      onParsed(readContent(await capturePageQr()));
    } catch (cause) {
      report(cause, 'scan');
    } finally {
      setScanning(false);
    }
  };

  // 从求助引导页进来时自动跑一次：那一页说的正是"网站现在显示新二维码"。
  // 只跑一次，不跟着依赖变化 —— 失败了要留给用户自己决定是否重试
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoscan || autoRan.current) return;
    autoRan.current = true;
    void scanPage();
  });

  // 粘贴图片：截图之后直接 Ctrl/Cmd+V，比"另存为再选文件"少三步。
  // 故意不写依赖数组：`handleFile` 每次渲染都是新的闭包，
  // 而这些都是轻量的监听器，重挂一次的开销远小于维护一份 useCallback 依赖
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith('image/'),
      );
      if (file) {
        event.preventDefault();
        void handleFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  return (
    <div className="space-y-3">
      {/* 第一顺位是"直接读当前页面"：打开扩展的那一刻，二维码通常就摆在屏幕上。
          截不到也没关系，下面两条路（图片 / 粘贴）一直在 */}
      <div>
        <Button disabled={scanning} onClick={() => void scanPage()}>
          <ScreenIcon size={16} />
          {t(scanning ? 'scan.page.busy' : 'scan.page')}
        </Button>
        <p className="mt-1.5 text-center text-[11px] leading-relaxed text-fg-muted">
          {t('scan.page.hint')}
        </p>
        {error?.at === 'scan' && <ErrorLine message={error.message} />}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span className="h-px flex-1 bg-separator" />
        {t('common.or')}
        <span className="h-px flex-1 bg-separator" />
      </div>

      <div
        className={`flex flex-col items-center justify-center rounded-[12px] border-2 border-dashed px-4 py-7 text-center transition-colors duration-150 ${
          dragging ? 'border-accent bg-accent/5' : 'border-separator'
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFile(event.dataTransfer.files[0]);
        }}
      >
        <p className="text-[13px] font-medium">{t('add.drop-title')}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{t('add.drop-hint')}</p>
        <SecondaryButton
          className="mt-3 w-auto px-4"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {t(busy ? 'add.reading' : 'add.pick-image')}
        </SecondaryButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            // 清空 value，否则连续选同一张图不会再触发 change
            event.target.value = '';
          }}
        />
      </div>

      {error?.at === 'file' && <ErrorLine message={error.message} />}

      {/* 第四种进法（手里只有一串链接）比前三种冷得多，折起来只留一行。
          一直铺着三行文本框，会把「扫描当前页面」挤到要滚动才看得全 */}
      <div className="border-t border-separator pt-2.5">
        <button
          type="button"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((open) => !open)}
          className="flex w-full items-center gap-1 py-1 text-[12px] font-medium text-accent transition-colors duration-150 hover:text-accent-press"
        >
          <ChevronRightIcon
            size={14}
            className={`shrink-0 transition-transform duration-150 ${pasteOpen ? 'rotate-90' : ''}`}
          />
          {t('add.paste-toggle')}
        </button>

        {pasteOpen && (
          <div className="mt-2">
            <textarea
              aria-label={t('add.paste-label')}
              value={text}
              rows={3}
              placeholder="otpauth://totp/..."
              spellCheck={false}
              // 展开这一行的人目的很明确，光标直接进去，少一次点击
              autoFocus
              onChange={(event) => setText(event.target.value)}
              className="w-full resize-none rounded-[8px] bg-surface-alt px-3 py-2 font-digit text-[12px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
            />
            <SecondaryButton
              className="mt-2"
              disabled={!text.trim()}
              onClick={() => {
                setError(null);
                try {
                  onParsed(readContent(text));
                } catch (cause) {
                  report(cause, 'file');
                }
              }}
            >
              {t('add.parse')}
            </SecondaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

interface ScanError {
  message: Message;
  /** 这句话是说给哪一块听的：扫描按钮和拖放区分属两段，混在一起会指错地方 */
  at: 'scan' | 'file';
}

/**
 * 识别出来的其实是迁移码，已经转到导入页。
 * 它走的是异常通道，因为 `readContent` 的返回类型是"一个账户的参数"，
 * 而迁移码装的是一批 —— 用它来中断，比让每个调用点都判断返回值要少出错。
 */
class RedirectedToImport extends Error {
  constructor() {
    super('redirected to import');
    this.name = 'RedirectedToImport';
  }
}

function ErrorLine({ message }: { message: Message }) {
  const text = useMessage();
  return (
    <p role="alert" className="mt-2 text-[11px] leading-relaxed text-danger">
      {text(message)}
    </p>
  );
}
