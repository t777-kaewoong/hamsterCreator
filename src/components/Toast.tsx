// 화면 하단 중앙에 잠깐 떴다 사라지는 알림(토스트)과, 어디서든 그걸 띄울 수 있는
// useToast() 훅입니다. main.tsx나 App.tsx 최상단을 <ToastProvider>로 한 번 감싸면
// 그 아래 어느 컴포넌트에서든 const { show } = useToast() 로 알림을 띄울 수 있습니다.
// 동시에 1개만 보여주며, 새 토스트가 오면 기존 것을 즉시 교체합니다(PRD §9.7).
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './Toast.module.css'

export type ToastTone = 'default' | 'danger'

export interface ToastAction {
  /** 액션 버튼 글자 (예: '실행취소') */
  label: string
  /** 액션 버튼을 눌렀을 때 실행할 동작 */
  onClick: () => void
}

export interface ToastOptions {
  /** 표시할 메시지 */
  message: string
  /** 색 톤. 기본 default(검정), danger는 오류 알림용 */
  tone?: ToastTone
  /** 있으면 토스트 안에 실행 버튼이 붙고, 자동 소멸 시간이 3초→6초로 늘어납니다 */
  action?: ToastAction
}

const DEFAULT_DURATION_MS = 3000
const WITH_ACTION_DURATION_MS = 6000

interface ToastContextValue {
  show: (options: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/** 토스트를 띄우는 함수(show)를 돌려주는 훅. 반드시 <ToastProvider> 안에서 써야 합니다. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast()는 <ToastProvider> 안의 컴포넌트에서만 쓸 수 있습니다.')
  }
  return ctx
}

interface ActiveToast extends ToastOptions {
  id: number
}

/** 앱 최상단(main.tsx 또는 App.tsx)에 한 번 감싸두는 프로바이더. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const show = useCallback((options: ToastOptions) => {
    // 새 토스트가 오면 기존 타이머를 지우고 즉시 교체합니다(동시에 1개만, PRD §9.7).
    window.clearTimeout(timerRef.current)
    const id = Date.now()
    setToast({ ...options, id })

    const duration = options.action ? WITH_ACTION_DURATION_MS : DEFAULT_DURATION_MS
    timerRef.current = window.setTimeout(() => setToast(null), duration)
  }, [])

  function handleActionClick() {
    if (!toast?.action) return
    toast.action.onClick()
    window.clearTimeout(timerRef.current)
    setToast(null)
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className={styles.viewport}>
        {toast && (
          // key로 id를 줘서, 토스트가 바뀔 때마다 요소가 새로 마운트되어
          // 진입 애니메이션(아래에서 12px 올라오며 등장)이 매번 다시 재생됩니다.
          <div
            key={toast.id}
            className={[styles.toast, toast.tone === 'danger' ? styles.danger : ''].filter(Boolean).join(' ')}
            role="status"
            aria-live="polite"
          >
            <span className={`${styles.message} t-body`}>{toast.message}</span>
            {toast.action && (
              <button type="button" className={`${styles.action} t-label`} onClick={handleActionClick}>
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
