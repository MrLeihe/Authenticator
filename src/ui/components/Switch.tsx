/**
 * iOS 风格开关。
 *
 * 为什么不用 `<input type="checkbox">`：
 * 复选框在设置页里是一颗 16px 的小方块，和"这一项现在是开还是关"的语义相比太小，
 * 而且浏览器会按操作系统主题画成各种样子。开关的轨道本身就是状态指示，
 * 扫一眼就能读出所有项的开合，不需要逐行读文字。
 *
 * 用 `<button role="switch">` 而不是 input：键盘上 Space/Enter 天然可切换，
 * 读屏会念出 "switch, on/off"，比 checkbox 更贴合这个语义。
 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ${
        checked ? 'bg-accent' : 'bg-separator'
      }`}
      onClick={() => onChange(!checked)}
    >
      {/* `left-0` 不能省：绝对定位元素只给 top 不给 left 时，横向落在"静态位置"
          ——按钮里没有文字，静态位置由行盒推出来，实测落在 22px 处，
          再叠上 translate-x-[20px] 就会把滑块推出轨道右侧，整颗开关只剩一条绿胶囊 */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
