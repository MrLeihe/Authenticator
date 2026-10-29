import { useState } from 'react';
import { SetPasswordForm } from '../components/SetPasswordForm';
import { PrimaryButton, TextButton } from '../components/Button';
import { ShieldIcon } from '../components/Icons';
import { useAppStore } from '../store';

/**
 * 首次引导。只做一件事：让用户决定要不要密码，然后建库。
 *
 * 「不要密码」也是一等选项，不是藏起来的高级设置：
 * 强制所有人设密码会让一部分人写 `12345678`，反而更不安全。
 */
export function OnboardScreen() {
  const createVault = useAppStore((s) => s.createVault);
  const [mode, setMode] = useState<'intro' | 'password'>('intro');
  const [error, setError] = useState<string | null>(null);

  const start = async (password?: string) => {
    setError(null);
    try {
      await createVault(password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败，请重试');
    }
  };

  return (
    <div className="flex min-h-[280px] flex-col bg-bg px-5 py-6">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-alt text-accent">
        <ShieldIcon size={22} />
      </span>
      <h1 className="text-[17px] font-semibold tracking-tight">先给验证码上一把锁</h1>
      <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
        账户数据只加密保存在这台电脑上，不同步、不上传，也没有服务器能看到你的密钥。
      </p>

      {mode === 'intro' ? (
        <>
          <ul className="mt-4 space-y-2 text-[12px] leading-relaxed">
            <Point title="设一个密码">打开扩展时要先解锁，别人拿到电脑也看不到验证码</Point>
            <Point title="会给你一个恢复码">忘记密码时用它拿回数据，只显示一次，请当场记下</Point>
            <Point title="也可以先不设">数据同样加密存放，只是打开时不再问密码</Point>
          </ul>

          {error && <p className="mt-3 text-[11px] text-danger">{error}</p>}

          <div className="mt-auto space-y-2 pt-5">
            <PrimaryButton onClick={() => setMode('password')}>设置密码</PrimaryButton>
            <TextButton className="w-full py-1.5" onClick={() => void start()}>
              先不用密码，直接开始
            </TextButton>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <SetPasswordForm onSubmit={(password) => start(password)} />
          <TextButton className="mt-3 w-full" onClick={() => setMode('intro')}>
            返回
          </TextButton>
        </div>
      )}
    </div>
  );
}

function Point({ title, children }: { title: string; children: string }) {
  return (
    <li className="flex gap-2">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span>
        <span className="font-medium">{title}</span>
        <span className="text-fg-muted"> — {children}</span>
      </span>
    </li>
  );
}
