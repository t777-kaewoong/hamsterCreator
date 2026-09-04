// 앱의 진입점. index.html 의 <div id="root"> 안에 App 컴포넌트를 렌더링합니다.
// 전역 CSS(디자인 토큰)가 생기면 여기서 import 하면 됩니다.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
