const PALETTE_SIZE = 8;

/** 稳定的字符串散列，同一账户每次打开颜色都一样 */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 取一个字符作头像：中文取首字，英文取首字母大写 */
export function initialOf(issuer: string, account: string): string {
  const source = issuer.trim() || account.trim();
  if (!source) return '?';
  const first = Array.from(source)[0] ?? '?';
  return /[a-z]/.test(first) ? first.toUpperCase() : first;
}

interface InitialsProps {
  issuer: string;
  account: string;
  size?: number;
}

/**
 * 首字头像。
 *
 * 圆形而不是圆角方块：方形头像在列表里会形成一排"色块矩阵"，
 * 视觉重量比账户名还大；圆形更接近 iOS 通讯录，也更容易和右侧的圆环呼应。
 *
 * 尺寸 26px 对齐参考实现的实测值；字号取 0.46 倍 —— 比方块时期略大，
 * 因为圆形比方形的可用内切区域小，同样的字会显得偏小。
 */
export function Initials({ issuer, account, size = 26 }: InitialsProps) {
  const text = initialOf(issuer, account);
  const index = (hash(issuer || account) % PALETTE_SIZE) + 1;

  return (
    <div
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        // 色值只在 globals.css 里定义，这里只引用变量
        backgroundColor: `rgb(var(--avatar-${index}))`,
      }}
      aria-hidden="true"
    >
      {text}
    </div>
  );
}
