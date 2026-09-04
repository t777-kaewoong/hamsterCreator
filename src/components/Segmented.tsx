// 여러 선택지 중 하나를 고르는 세그먼트 컨트롤(이음매 있는 버튼 묶음)입니다.
// 사용 위치 예: 출력 계획기의 "격자 크기로 / 실물 크기로", "이음매 방식(맞대기/겹치기)".
// 좌우 화살표 키로 다른 항목을 바로 선택할 수 있습니다(PRD §9.7).
import { useId } from 'react'
import type { KeyboardEvent } from 'react'
import styles from './Segmented.module.css'

export interface SegmentedOption {
  /** 값. onChange로 그대로 전달됩니다 */
  value: string
  /** 화면에 보이는 글자 */
  label: string
}

export interface SegmentedProps {
  /** 선택지 목록 */
  options: SegmentedOption[]
  /** 현재 선택된 값 */
  value: string
  /** 선택이 바뀔 때 호출됩니다 */
  onChange: (value: string) => void
  /** 스크린리더용 그룹 이름 (예: "이음매 방식") */
  'aria-label'?: string
}

/**
 * 세그먼트 컨트롤.
 * <Segmented options={[{value:'h',label:'가로'},{value:'v',label:'세로'}]} value={dir} onChange={setDir} />
 */
export default function Segmented({ options, value, onChange, 'aria-label': ariaLabel }: SegmentedProps) {
  // 화살표 키로 이동한 뒤 포커스를 옮기려면 각 항목이 고유한 id를 가져야 합니다.
  // 같은 화면에 세그먼트가 여러 개 있어도 겹치지 않도록 useId로 그룹별 접두어를 만듭니다.
  const groupId = useId()
  const itemId = (v: string) => `${groupId}-${v}`

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const currentIndex = options.findIndex((o) => o.value === value)
    const delta = e.key === 'ArrowRight' ? 1 : -1
    // 양끝에서 반대쪽으로 순환합니다.
    const nextIndex = (currentIndex + delta + options.length) % options.length
    const next = options[nextIndex]
    if (next) {
      onChange(next.value)
      // 포커스도 선택된 항목으로 옮겨줘야 계속 화살표 키로 이동할 수 있습니다.
      document.getElementById(itemId(next.value))?.focus()
    }
  }

  return (
    <div className={styles.track} role="radiogroup" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            id={itemId(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={[styles.item, selected ? styles.itemSelected : '', 't-label'].filter(Boolean).join(' ')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
