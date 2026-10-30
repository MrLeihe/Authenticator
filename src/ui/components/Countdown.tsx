interface CountdownProps {
  remaining: number;
  period: number;
  /** 剩余秒数 ≤ 这个值时环变橙，与验证码文字同步 */
  warnAt?: number;
  /** 直径。现代版式 32px、经典版式 28px、紧凑版式 20px */
  size?: number;
  /** 小尺寸塞不下数字，紧凑模式关掉 */
  showNumber?: boolean;
}

/**
 * 现代版式 32px、经典版式 28px、紧凑版式 20px（只画环不画数字）。
 *
 * 从 40 收到 32：40px 的环在 96px 行里几乎和 24px 的验证码一样重，
 * 视线每次扫到行尾都会先看到那个圈，而它只是"还剩几秒"的背景信息。
 * 32px 仍然装得下 11px 的两位数（环内净宽 28px），不至于糊在一起。
 */
const DEFAULT_SIZE = 32;
/**
 * 描边**不按直径等比放大**。
 *
 * 等比缩放在 32px 下会得到 2.6px 的粗圈，比验证码本身还重 —— 那正好反了：
 * 环是配角。所以正常尺寸封顶 2px，小环按同一比例缩，下限 1.4px
 * （再细就会出现亚像素抖动）。
 */
const DEFAULT_STROKE = 2;
const strokeFor = (size: number) =>
  Math.min(DEFAULT_STROKE, Math.max(1.4, (size * DEFAULT_STROKE) / DEFAULT_SIZE));

/**
 * 环心数字：32px 环 11px、28px 及以下 10px。
 *
 * 试过 12px：一位数好看，但还剩十几秒时两位数会顶到环内壁，
 * 环反而像被数字撑破。11px 是两种位数都留得住白的那一档。
 */
const numberSize = (size: number) => (size >= DEFAULT_SIZE ? 11 : 10);

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
          className="stroke-tick-track"
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
            urgent ? 'stroke-warn' : 'stroke-tick'
          }`}
        />
      </svg>
      {/* 数字跟着环走灰色：深色主题下 fg-muted 太暗，两位数几乎看不清。
          600 而不是 500：环内只有 12px，500 在 2 倍屏上会被抗锯齿啃掉一圈边，
          读起来比验证码"虚"一档；环是配角，但配角也得读得清 */}
      {showNumber && (
        <span
          className={`tnum absolute inset-0 flex items-center justify-center font-semibold leading-none ${
            urgent ? 'text-warn' : 'text-tick'
          }`}
          style={{ fontSize: numberSize(size) }}
        >
          {remaining}
        </span>
      )}
    </div>
  );
}
