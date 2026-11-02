import type { ReactNode } from 'react';

/**
 * 设置页那套「灰底 + 白卡 + 卡外标题」的分组板式。
 *
 * 抽出来是因为隐私页要长成同一个样子：两页都从设置进来，进出之间
 * 如果卡片的圆角、标题缩进、分隔线位置差一档，看起来就像换了个 App。
 * 版式只留这一份，各页只负责往里塞内容。
 */
export function CardGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      {/* 标题比卡内文字再靠左 8px：缩进 24px，卡内文字 32px。
          完全对齐时标题看着像卡里的第一行内容，分组的分界感反而没了；
          再往左（px-5 = 20px）就贴到卡片圆角上了。
          颜色和字重也提一档：13px/600 + --fg-secondary，
          纯 --fg-muted 做标题太虚，一页扫下来抓不住有哪几组 */}
      <h2 className="mb-2 px-6 text-[13px] font-semibold text-fg-secondary">{title}</h2>
      <div className="card-divide mx-4 overflow-hidden rounded-card bg-surface">{children}</div>
    </section>
  );
}

/** 左边名词、右边事实的一行，用于「版本 1.0.0」这类不可操作的信息 */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      {/* 标签和旁边那些可点的行同档 14px：同一张卡里一边 14、一边 13，
          看着像两套字号拼起来。事实本身退到 13px 次要色，跟分段的当前值一个调子 */}
      <span className="text-[14px] text-fg">{label}</span>
      <span className="text-[13px] text-fg-muted">{value}</span>
    </div>
  );
}

/** 卡内的一块正文：标题 + 一段说明，说明紧贴标题下一行 */
export function Note({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-4 py-3.5">
      <span className="block text-[14px] text-fg">{title}</span>
      <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{hint}</p>
    </div>
  );
}
