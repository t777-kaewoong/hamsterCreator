// 앱의 진입점. index.html 의 <div id="root"> 안에 App 컴포넌트를 렌더링합니다.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// 토스트 알림 프로바이더. 앱 전체를 감싸야 어느 화면에서든 useToast()를 쓸 수 있습니다.
import { ToastProvider } from './components'
// 전역 CSS(디자인 토큰 + 리셋 + 타이포그래피). 앱 전체에 한 번만 불러오면 됩니다.
import './styles/global.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
)
