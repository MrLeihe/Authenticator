interface CountdownProps {
  remaining: number;
  period: number;
  /** 剩余秒数 ≤ 这个值时环变橙，与验证码文字同步 */
  warnAt?: number;
  /** 直径，紧凑模式用更小的环 */
  size?: number;
  /** 小尺寸塞不下数字，紧凑模式关掉 */
  showNumber?: boolean;
}

/** 正常模式 28px：一行里除了验证码就数它显眼，24px 在 2 倍屏上细得看不见 */
const DEFAULT_SIZE = 28;
/** 描边按尺寸等比缩，28px 下是 2.6px；固定值会让小环显得像粗黑圈 */
const strokeFor = (size: number) => Math.max(1.4, (size * 2.6) / DEFAULT_SIZE);

/**
 * 环形倒计时。
 *
 * 环靠 CSS `transition: stroke-dashoffset 1s linear` 走完一整圈，
 * JS 每秒只改一次目标值 —— 不逐帧计算，20 个账户也只付出 20 次样式写入。
 */
export function Countdown({
  remaining,
  period,
  warnAt = 4,
  size = DEFAULT_SIZE,
  showNumber = true,
}: CountdownProps) {
  const safePeriod = period > 0 ? period : 30;
  const ratio = Math.min(1, Math.max(0, remaining / safePeriod));
  const stroke = strokeFor(size);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - ratio);
  const urgent = remaining <= warnAt;
  const center = size / 2;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-separator"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-[stroke-dashoffset] duration-1000 ease-linear ${
            urgent ? 'stroke-warn' : 'stroke-code'
          }`}
        />
      </svg>
      {/* 数字和环同色：深色主题下 fg-muted 太暗，两位数几乎看不清 */}
      {showNumber && (
        <span
          className={`tnum absolute inset-0 flex items-center justify-center text-[10px] font-medium leading-none ${
            urgent ? 'text-warn' : 'text-code'
          }`}
        >
          {remaining}
        </span>
      )}
    </div>
  );
}
