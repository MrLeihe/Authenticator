import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { Boundary } from './App';
import '@/ui/styles/globals.css';
import { syncTheme } from '@/ui/theme';

// 挂载前先落一次底色，避免先白后黑闪一下。
// 用 syncTheme 而不是 applyTheme：这一步只要写一次 class，不需要监听器 ——
// 真正的"跟随系统"由 App 里的 useEffect 用 applyTheme 接管，
// 两边都注册监听器的话，系统一换主题就有两个回调抢着写同一个 class。
syncTheme('light');

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
