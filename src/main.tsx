// 앱의 진입점. index.html 의 <div id="root"> 안에 App 컴포넌트를 렌더링합니다.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// 전역 CSS(디자인 토큰 + 리셋 + 타이포그래피). 앱 전체에 한 번만 불러오면 됩니다.
import './styles/global.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
