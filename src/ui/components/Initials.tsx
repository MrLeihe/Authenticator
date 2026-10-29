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

export function Initials({ issuer, account, size = 28 }: InitialsProps) {
  const text = initialOf(issuer, account);
  const index = (hash(issuer || account) % PALETTE_SIZE) + 1;

  return (
    <div
      className="flex shrink-0 select-none items-center justify-center rounded-[8px] font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        // 色值只在 globals.css 里定义，这里只引用变量
        backgroundColor: `rgb(var(--avatar-${index}))`,
      }}
      aria-hidden="true"
    >
      {text}
    </div>
  );
}
