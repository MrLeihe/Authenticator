import { ListScreen } from '@/ui/screens/ListScreen';

/**
 * 顶层路由。P2 只有列表一屏，P3 会按 vault 状态切到
 * locked（要密码）/ onboard（首次引导）/ list。
 */
export default function App() {
  return <ListScreen />;
}
