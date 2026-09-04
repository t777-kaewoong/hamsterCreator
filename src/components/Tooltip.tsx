// 마우스를 올리거나 포커스가 갔을 때 400ms 뒤에 나타나는 설명 풍선입니다.
// 사용 위치 예: 도구 레일 아이콘 버튼 위(단축키 칩 포함), 팔레트 타일 이름 표시.
// 위치 계산은 별도 라이브러리 없이 간단한 절대 위치(placement별 CSS)로 처리합니다(PRD §9.7).
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  /** 풍선 안에 보여줄 설명 글자 */
  content: ReactNode
  /** 있으면 설명 뒤에 단축키 칩으로 붙습니다 (예: 'Ctrl+S') */
  shortcut?: string
  /** 풍선이 뜨는 방향. 기본 top */
  placement?: 'top' | 'right' | 'bottom' | 'left'
  /** 마우스를 올릴 대상(보통 아이콘 버튼 하나) */
  children: ReactNode
}

const SHOW_DELAY_MS = 400

/**
 * 툴팁. 자식 하나를 감싸서 그 위에 마우스를 올리면 400ms 후 설명을 보여줍니다.
 * <Tooltip content="저장" shortcut="Ctrl+S"><Button variant="icon" icon={<Save/>} /></Tooltip>
 */
export default function Tooltip({ content, shortcut, placement = 'top', children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  function scheduleShow() {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)
  }

  function hideNow() {
    // 사라짐은 지연 없이 즉시 처리합니다(PRD §9.7).
    window.clearTimeout(timerRef.current)
    setVisible(false)
  }

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={scheduleShow}
      onMouseLeave={hideNow}
      onFocus={scheduleShow}
      onBlur={hideNow}
    >
      {children}
      {visible && (
        <span className={`${styles.bubble} ${styles[placement]}`} role="tooltip">
          <span className="t-caption">{content}</span>
          {shortcut && <span className={`${styles.shortcut} t-micro`}>{shortcut}</span>}
        </span>
      )}
    </span>
  )
}
