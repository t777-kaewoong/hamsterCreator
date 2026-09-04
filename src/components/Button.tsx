// 앱 전체에서 쓰는 기본 버튼입니다.
// 사용 위치 예: 상단바 저장 버튼(primary), 모달 취소(ghost), 도구 레일 아이콘 버튼(icon),
// 위험한 동작(danger) — 출력 계획기의 "PDF 만들기", 시작 화면의 "삭제" 등.
// 수치는 PRD §9.7 버튼 표를 그대로 따릅니다.
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

/** 버튼의 색·역할. primary=주 동작, secondary=보조 동작, ghost=배경 없는 가벼운 버튼,
 *  danger=삭제 등 위험한 동작, icon=아이콘만 있는 정사각형 버튼 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'
/** 버튼 높이. sm=30px · md=36px(기본) · lg=44px */
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 버튼 색/역할. 지정하지 않으면 secondary(중립 버튼) */
  variant?: ButtonVariant
  /** 버튼 높이. 지정하지 않으면 md */
  size?: ButtonSize
  /** 좌우에 넣을 아이콘. lucide-react 아이콘 컴포넌트를 넣어주세요 (예: <Save />) */
  icon?: ReactNode
  /** icon을 글자 왼쪽에 둘지 오른쪽에 둘지. 기본 left */
  iconPosition?: 'left' | 'right'
  /** true면 버튼을 비활성 상태로 잠그고, 안쪽 아래에 좌→우로 채워지는 진행 막대를 보여줍니다 */
  loading?: boolean
}

/**
 * 기본 버튼 컴포넌트.
 * <Button variant="primary" icon={<Save size={18} />}>저장</Button> 처럼 씁니다.
 * <button>의 나머지 속성(onClick, type, disabled 등)은 그대로 전달됩니다.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconPosition = 'left',
    loading = false,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  // loading 중에는 클릭을 막기 위해 disabled도 함께 켭니다.
  const isDisabled = disabled || loading

  const classNames = [
    styles.button,
    styles[variant],
    styles[size],
    className ?? '',
    // 버튼 글자는 전역 타이포 유틸리티(.t-label = 13px/18, weight 500)를 그대로 씁니다.
    't-label',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type="button"
      className={classNames}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && iconPosition === 'left' && <span className={styles.icon}>{icon}</span>}
      {children != null && <span className={styles.label}>{children}</span>}
      {icon && iconPosition === 'right' && <span className={styles.icon}>{icon}</span>}
      {loading && (
        <span className={styles.progressTrack} aria-hidden="true">
          <span className={styles.progressBar} />
        </span>
      )}
    </button>
  )
})

export default Button
