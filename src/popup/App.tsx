import { getExtensionVersion } from '@/platform/env';

/**
 * P0 脚手架自检页。
 * 作用只有一个：确认 Tailwind 语义色、字体、圆角、等宽数字全部生效。
 * P2 开始会被真正的 ListScreen 替换。
 */
export default function App() {
  const version = getExtensionVersion();

  const swatches: Array<[string, string]> = [
    ['bg', 'bg-bg'],
    ['surface', 'bg-surface'],
    ['accent', 'bg-accent'],
    ['warn', 'bg-warn'],
    ['success', 'bg-success'],
    ['danger', 'bg-danger'],
  ];

  return (
    <div className="min-h-[220px] bg-bg">
      <header className="flex h-14 items-center justify-between px-4">
        <h1 className="text-[18px] font-semibold">验证码</h1>
        <span className="tnum text-xs text-fg-muted">
          {version === 'dev' ? '开发预览' : `v${version}`}
        </span>
      </header>

      <main className="space-y-3 px-4 pb-4">
        <section className="rounded-card bg-surface p-4">
          <p className="text-sm font-medium">脚手架就绪</p>
          <p className="mt-1 text-xs text-fg-muted">
            P0 脚手架 + P1 核心算法已就绪 · RFC 6238 六组向量全绿
          </p>

          <div className="mt-3 flex items-end gap-3">
            <span className="font-digit text-digit tabular-nums text-accent" dir="ltr">
              288 139
            </span>
            <span className="pb-1 text-xs text-fg-muted">3+3 分组 · 等宽</span>
          </div>
        </section>

        <section className="rounded-card bg-surface p-4">
          <p className="mb-2 text-xs text-fg-muted">色板自检</p>
          <div className="flex gap-2">
            {swatches.map(([label, cls]) => (
              <div key={label} className="flex-1">
                <div className={`h-8 rounded-input ${cls} border border-separator`} />
                <p className="mt-1 truncate text-[10px] text-fg-muted">{label}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
