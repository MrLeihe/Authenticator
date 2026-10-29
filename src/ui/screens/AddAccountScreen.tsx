import { useEffect, useRef, useState } from 'react';
import { findOtpauthUris, parseOtpauth } from '@/core/otpauth';
import type { OtpAuthParams } from '@/core/otpauth';
import { decodeQrFile } from '@/platform/qr';
import { AccountForm } from '../components/AccountForm';
import { SecondaryButton } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { describeError, useMessage } from '../errors';
import type { Message } from '../errors';
import { useT } from '../i18n';
import { useAppStore } from '../store';

/**
 * 添加账户。两条路：手动输入 / 扫码。
 *
 * 扫码这条路**不做任何自动保存**：识别出来的东西要先填进表单让人看一眼再确认。
 * 一张截图里可能是别人的账户，也可能是三个月前作废的密钥，
 * 直接落盘等于替用户做了决定。
 */
export function AddAccountScreen() {
  const t = useT();
  const closeSheet = useAppStore((s) => s.closeSheet);
  const addAccount = useAppStore((s) => s.addAccount);
  const [mode, setMode] = useState<'manual' | 'scan'>('manual');
  const [prefill, setPrefill] = useState<OtpAuthParams | null>(null);

  return (
    <div className="flex min-h-[280px] flex-col bg-bg">
      <ScreenHeader title={t(prefill ? 'add.title-confirm' : 'add.title')} onBack={closeSheet} />

      <div className="flex-1 px-4 py-3">
        {prefill ? (
          <>
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
          </>
        ) : mode === 'manual' ? (
          <>
            <AccountForm
              key="blank"
              submitKey="add.save"
              onSubmit={addAccount}
              onCancel={closeSheet}
            />
            <div className="mt-4 border-t border-separator pt-3">
              <SecondaryButton onClick={() => setMode('scan')}>
                {t('add.switch-scan')}
              </SecondaryButton>
            </div>
          </>
        ) : (
          <ScanPane
            onParsed={(params) => setPrefill(params)}
            onManual={() => setMode('manual')}
          />
        )}
      </div>
    </div>
  );
}

/** 扫码面板：图片（选择 / 拖放 / 粘贴）+ 直接粘贴 otpauth 地址 */
function ScanPane({
  onParsed,
  onManual,
}: {
  onParsed: (params: OtpAuthParams) => void;
  onManual: () => void;
}) {
  const t = useT();
  const message = useMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const content = await decodeQrFile(file);
      onParsed(readContent(content));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 从识别出来的文本里取参数。
   * 二维码里可能是纯地址，也可能是"地址 + 一段说明"，所以先挑再解析。
   */
  const readContent = (content: string): OtpAuthParams => {
    const first = findOtpauthUris(content)[0];
    return parseOtpauth(first ?? content);
  };

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

      {error && (
        <p role="alert" className="text-[11px] leading-relaxed text-danger">
          {message(error)}
        </p>
      )}

      <div className="border-t border-separator pt-3">
        <label htmlFor="otpauth-text" className="mb-1.5 block text-[12px] font-medium text-fg-muted">
          {t('add.paste-label')}
        </label>
        <textarea
          id="otpauth-text"
          value={text}
          rows={3}
          placeholder="otpauth://totp/..."
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          className="w-full resize-none rounded-[8px] bg-surface-alt px-3 py-2 font-digit text-[12px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
        />
        <div className="mt-2 flex gap-2">
          <SecondaryButton
            disabled={!text.trim()}
            onClick={() => {
              setError(null);
              try {
                onParsed(readContent(text));
              } catch (cause) {
                setError(describeError(cause));
              }
            }}
          >
            {t('add.parse')}
          </SecondaryButton>
          <SecondaryButton onClick={onManual}>{t('add.manual')}</SecondaryButton>
        </div>
      </div>
    </div>
  );
}
