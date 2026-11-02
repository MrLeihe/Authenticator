/**
 * 浮层的层数登记。
 *
 * 整屏子界面（`SheetView`）的 Esc「退一层」和浮层（弹窗、下拉菜单）的 Esc
 * 「关掉自己」都挂在 window 上。同一个 target 上的两个监听器谁也拦不住谁，
 * `stopPropagation` 只能挡住事件往别的节点走。所以退一层之前先问这一句：
 * 有浮层压在上面时，Esc 归浮层，整屏不许跟着一起退 —— 否则在设置页里按一下
 * Esc 会把「语言下拉」和整个设置页一起关掉。
 *
 * 弹窗用（`Dialog`），下拉菜单也用（`LanguageMenu`），所以抽成通用的一份，
 * 不塞进任何单一组件里。
 */
let overlays = 0;

/** 打开一层浮层，返回「关掉/卸载时」的清理函数 */
export function registerOverlay(): () => void {
  overlays += 1;
  return () => {
    overlays -= 1;
  };
}

export function hasOpenOverlay(): boolean {
  return overlays > 0;
}
