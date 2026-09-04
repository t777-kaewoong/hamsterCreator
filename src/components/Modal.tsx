// 화면 가운데 뜨는 모달 창입니다.
// 사용 위치 예: 출력 계획기(PRD §9.14), 확인이 꼭 필요한 드문 상황.
// PRD U7 원칙에 따라 이 앱은 "정말 삭제할까요?" 같은 확인 모달을 최대한 피하고
// 실행취소로 대신하므로, Modal은 주로 출력 계획기 같은 "작업 화면"으로 쓰입니다.
// Esc로 닫히고, 열려 있는 동안 Tab이 모달 밖으로 나가지 않습니다(포커스 트랩).
import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import Button from './Button'
import styles from './Modal.module.css'

export interface ModalProps {
  /** true면 모달을 보여줍니다 */
  open: boolean
  /** 닫아야 할 때(Esc, 오버레이 클릭, 닫기 버튼) 호출됩니다 */
  onClose: () => void
  /** 헤더에 보여줄 제목 */
  title: string
  /** 푸터에 넣을 버튼들 (우측 정렬로 배치됩니다) */
  footer?: ReactNode
  /** 패널 폭. 숫자면 px, 문자열이면 그대로 CSS 값으로 씁니다. 기본 480px */
  width?: number | string
  children: ReactNode
}

// 포커스 트랩 대상으로 삼을 "포커스 가능한" 요소들의 셀렉터.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 모달 창.
 * <Modal open={open} onClose={close} title="출력 계획" footer={<Button ...>}>내용</Modal>
 */
export default function Modal({ open, onClose, title, footer, width = 480, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  // 열릴 때: 이전 포커스를 기억해두고 패널 안 첫 요소로 포커스를 옮깁니다.
  // 닫힐 때: body 스크롤 잠금을 풀고 이전 포커스로 되돌립니다.
  useEffect(() => {
    if (!open) return

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden' // 열려 있는 동안 뒤 배경 스크롤 잠금

    const panel = panelRef.current
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(firstFocusable ?? panel)?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      // 포커스 트랩: Tab이 패널 밖으로 나가지 않게 양 끝에서 반대쪽으로 되돌립니다.
      const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
      previouslyFocusedRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  function handleOverlayClick(e: MouseEvent<HTMLDivElement>) {
    // 오버레이 자체를 클릭했을 때만 닫습니다 — 패널 안을 클릭한 게 버블링된 경우는 무시.
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 id={titleId} className="t-h1">
            {title}
          </h2>
          <Button variant="icon" size="md" icon={<X size={18} />} onClick={onClose} aria-label="닫기" />
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>
  )
}
