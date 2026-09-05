// 라벨·단위·오류 메시지가 붙는 기본 입력창입니다.
// 사용 위치 예: 인스펙터의 칸 크기(mm) 입력, 출력 계획기의 열×행 입력, 검색창.
// 숫자 입력(type="number")은 위/아래 화살표 키로 1씩, Shift와 함께 10씩 값을 바꿀 수 있습니다
// (브라우저 기본 스핀 버튼은 Shift 10단위를 지원하지 않아 직접 구현했습니다 — PRD §9.7).
import { forwardRef, useId, useRef } from 'react'
import type { InputHTMLAttributes, KeyboardEvent, MutableRefObject, ReactNode } from 'react'
import styles from './Input.module.css'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 입력창 위에 보여줄 라벨 글자 */
  label?: string
  /** 숫자 입력 오른쪽에 붙일 단위 글자 (예: 'mm', '칸') */
  unit?: string
  /** 오류 메시지. 있으면 테두리가 빨갛게 바뀌고 hint 대신 이 글자가 보입니다 */
  error?: string
  /** 보조 설명 글자. error가 없을 때만 보입니다 */
  hint?: string
  /** 입력창 왼쪽에 붙일 아이콘 (예: 팔레트 검색창의 돋보기, PRD §9.11). lucide-react 아이콘을
   *  16px 크기로 넣어주세요. 생략하면 기존과 동일하게 아이콘 없는 입력창입니다 */
  icon?: ReactNode
}

/**
 * 기본 입력창 컴포넌트.
 * <Input label="칸 크기" unit="mm" type="number" value={size} onChange={...} /> 처럼 씁니다.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, unit, error, hint, icon, className, id, type, onKeyDown, ...rest },
  forwardedRef,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const innerRef = useRef<HTMLInputElement | null>(null)

  // 부모가 넘긴 ref와, 화살표 키 처리를 위해 우리가 직접 쓰는 ref를 하나로 합칩니다.
  function setRefs(el: HTMLInputElement | null) {
    innerRef.current = el
    if (typeof forwardedRef === 'function') forwardedRef(el)
    else if (forwardedRef) (forwardedRef as MutableRefObject<HTMLInputElement | null>).current = el
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e)
    if (type !== 'number') return
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const el = innerRef.current
    if (!el) return
    e.preventDefault()

    const step = e.shiftKey ? 10 : 1
    const current = Number.parseFloat(el.value) || 0
    const next = e.key === 'ArrowUp' ? current + step : current - step

    // React가 controlled input의 값을 가로채므로, 네이티브 setter로 값을 바꾼 뒤
    // 'input' 이벤트를 직접 발생시켜야 부모의 onChange가 정상적으로 호출됩니다.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    nativeSetter?.call(el, String(next))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const rowClassNames = [styles.inputRow, error ? styles.inputRowError : ''].filter(Boolean).join(' ')
  const inputClassNames = [styles.input, type === 'number' ? 't-nums' : ''].filter(Boolean).join(' ')

  return (
    <div className={[styles.field, className ?? ''].filter(Boolean).join(' ')}>
      {label && (
        <label htmlFor={inputId} className={`${styles.label} t-label`}>
          {label}
        </label>
      )}
      <div className={rowClassNames}>
        {icon && (
          <span className={styles.leadingIcon} aria-hidden="true">
            {icon}
          </span>
        )}
        <input
          ref={setRefs}
          id={inputId}
          type={type}
          className={`${inputClassNames} t-body`}
          onKeyDown={handleKeyDown}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
        {unit && <span className={`${styles.unit} t-caption`}>{unit}</span>}
      </div>
      {error ? (
        <span className={`${styles.error} t-caption`}>{error}</span>
      ) : hint ? (
        <span className={`${styles.hint} t-caption`}>{hint}</span>
      ) : null}
    </div>
  )
})

export default Input
