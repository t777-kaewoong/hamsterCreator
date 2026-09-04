// 가로로 길게 나열되는 알약 모양 탭입니다.
// 사용 위치 예: 팔레트 패널의 테마 전환(던전·숲·얼음·모험·사탕·공룡·아이콘·트랙·내 이미지, PRD §9.11).
// 항목이 많아 화면 폭을 넘길 수 있으므로 가로 스크롤이 되고, 스크롤바는 숨기고
// 더 있다는 걸 알리는 12px 그라데이션 페이드를 양 끝에 둡니다(PRD §9.7).
import { useEffect, useRef, useState } from 'react'
import styles from './TabPills.module.css'

export interface TabPillOption {
  /** 값. onChange로 그대로 전달됩니다 */
  value: string
  /** 화면에 보이는 글자 */
  label: string
}

export interface TabPillsProps {
  /** 탭 목록 */
  options: TabPillOption[]
  /** 현재 선택된 값 */
  value: string
  /** 선택이 바뀔 때 호출됩니다 */
  onChange: (value: string) => void
  /** 스크린리더용 그룹 이름 */
  'aria-label'?: string
}

/**
 * 탭 필(가로 스크롤 알약 탭).
 * <TabPills options={themeTabs} value={theme} onChange={setTheme} />
 */
export default function TabPills({ options, value, onChange, 'aria-label': ariaLabel }: TabPillsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 스크롤이 끝(양쪽)에 닿았는지에 따라 페이드를 숨깁니다 — 더 스크롤할 게 없는데
  // 페이드가 보이면 "숨겨진 항목이 있다"는 잘못된 신호를 주기 때문입니다.
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateFade() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    updateFade()
    const el = scrollRef.current
    if (!el) return
    // 항목 목록이 바뀌거나 창 크기가 바뀌어도 다시 계산합니다.
    const observer = new ResizeObserver(updateFade)
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length])

  return (
    <div className={styles.wrapper}>
      <div
        ref={scrollRef}
        className={styles.scroller}
        role="tablist"
        aria-label={ariaLabel}
        onScroll={updateFade}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={selected}
              className={[styles.pill, selected ? styles.pillSelected : '', 't-label'].filter(Boolean).join(' ')}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {canScrollLeft && <div className={`${styles.fade} ${styles.fadeLeft}`} aria-hidden="true" />}
      {canScrollRight && <div className={`${styles.fade} ${styles.fadeRight}`} aria-hidden="true" />}
    </div>
  )
}
