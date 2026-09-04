// 현재 저장 상태를 보여주는 작은 알약 칩입니다.
// 사용 위치 예: 상단바 우측(저장됨 / 저장 중 / 저장 안 됨).
// 왼쪽 점 색으로 상태를 표시하고, "저장 중"일 때만 점이 1.2초 주기로 깜빡입니다(PRD §9.7).
import styles from './StatusChip.module.css'

export type StatusChipStatus = 'saved' | 'saving' | 'unsaved'

export interface StatusChipProps {
  /** 저장 상태 */
  status: StatusChipStatus
  /** 표시할 글자. 생략하면 상태별 기본 한글 문구를 씁니다 */
  label?: string
}

const DEFAULT_LABEL: Record<StatusChipStatus, string> = {
  saved: '저장됨',
  saving: '저장 중',
  unsaved: '저장 안 됨',
}

/**
 * 저장 상태 칩.
 * <StatusChip status="saving" /> 처럼 쓰면 "저장 중" 문구와 깜빡이는 주황 점이 보입니다.
 */
export default function StatusChip({ status, label }: StatusChipProps) {
  return (
    <span className={`${styles.chip} t-micro`} role="status">
      <span className={[styles.dot, styles[status]].join(' ')} aria-hidden="true" />
      {label ?? DEFAULT_LABEL[status]}
    </span>
  )
}
