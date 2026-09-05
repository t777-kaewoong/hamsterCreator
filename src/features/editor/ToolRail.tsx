// 편집기 좌측 도구 레일 (PRD §9.10, 아이콘·단축키는 §9.6 매핑 표).
//
// 세로로 늘어선 아이콘 버튼 목록입니다. 버튼을 클릭하거나 키보드 단축키를 누르면
// editorStore의 activeTool이 바뀝니다. 이번 단계에서는 "도구를 고른다"까지만 동작하고,
// 고른 도구가 캔버스에서 실제로 무엇을 하는지는 다음 단계(캔버스 뷰포트)에서 만듭니다.
import { useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  MousePointer2,
  Grid3x3,
  Stamp,
  PaintBucket,
  Pipette,
  Eraser,
  Type,
  Flag,
  PenTool,
  Pencil,
  Circle,
} from 'lucide-react'
import { Tooltip } from '@/components'
import { useEditorStore } from './editorStore'
import type { ToolId } from './editorStore'
import styles from './ToolRail.module.css'

interface ToolDef {
  id: ToolId
  /** 키보드 단축키 한 글자 (대소문자 구분 없음) */
  key: string
  /** 툴팁에 보여줄 도구 이름 */
  label: string
  icon: LucideIcon
}

// 격자 도구 그룹 (V L B R I E T M) — PRD §9.6
const GRID_TOOLS: ToolDef[] = [
  { id: 'select', key: 'v', label: '선택', icon: MousePointer2 },
  { id: 'lineDraw', key: 'l', label: '격자선 긋기', icon: Grid3x3 },
  { id: 'stamp', key: 'b', label: '타일 배치', icon: Stamp },
  { id: 'fill', key: 'r', label: '영역 채우기', icon: PaintBucket },
  { id: 'eyedropper', key: 'i', label: '타일 집기', icon: Pipette },
  { id: 'eraser', key: 'e', label: '지우개', icon: Eraser },
  { id: 'text', key: 't', label: '글자', icon: Type },
  { id: 'marker', key: 'm', label: '출발·도착', icon: Flag },
]

// 자유곡선 도구 그룹 (P D O) — PRD §9.6
const CURVE_TOOLS: ToolDef[] = [
  { id: 'pen', key: 'p', label: '곡선 펜', icon: PenTool },
  { id: 'freeDraw', key: 'd', label: '자유 그리기', icon: Pencil },
  { id: 'shape', key: 'o', label: '도형', icon: Circle },
]

const ALL_TOOLS = [...GRID_TOOLS, ...CURVE_TOOLS]

/** 지금 포커스가 글자를 입력받는 요소(입력창·텍스트영역·contentEditable)에 있는지 확인합니다.
 *  이럴 때는 "l"을 눌러 파일명을 고치다가 도구가 바뀌어버리면 안 되므로 단축키를 무시합니다. */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.hasAttribute('contenteditable')
}

export default function ToolRail() {
  const activeTool = useEditorStore((s) => s.activeTool)
  const setTool = useEditorStore((s) => s.setTool)

  // 키보드 단축키. 입력창에 포커스가 있거나 Ctrl/Alt/Cmd가 눌려 있으면(다른 브라우저
  // 단축키와 겹치는 것을 피하기 위해) 무시합니다.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(document.activeElement)) return

      const key = e.key.toLowerCase()
      const tool = ALL_TOOLS.find((t) => t.key === key)
      if (!tool) return

      // [PRD 충돌] §9.6 도구 레일 표는 R을 "영역 채우기 도구로 전환"에 씁니다. 그런데
      // FR-3.4는 같은 R을 "타일 배치 중 90도 회전"에 씁니다. 스탬프(B)로 무언가를 찍으려는
      // 중에 R을 누르면 회전이어야 자연스러우므로, 그 상황에서는 여기서 도구를 바꾸지
      // 않고 캔버스 쪽 키보드 핸들러(toolInteractions.ts의 handleKeyDown)에게 맡깁니다.
      //
      // activeTool은 useEditorStore.getState()로 그 자리에서 바로 읽습니다 — 이 컴포넌트가
      // 구독 중인 activeTool(위 destructure)은 React가 리렌더를 끝내야 갱신되는 값이라,
      // 팔레트 클릭(도구를 'stamp'로 바꿈) 직후 아주 짧은 순간에는 아직 이전 값을 가리킬
      // 수 있습니다. 키 하나로 즉시 판단해야 하는 이 분기에서는 그 틈이 있으면 안 됩니다.
      if (tool.id === 'fill' && useEditorStore.getState().activeTool === 'stamp') return

      e.preventDefault()
      setTool(tool.id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setTool])

  return (
    <nav className={styles.rail} aria-label="도구">
      {GRID_TOOLS.map((tool) => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={setTool} />
      ))}

      {/* 격자 도구 / 자유곡선 도구 그룹 구분선 (PRD §9.10) */}
      <div className={styles.divider} role="separator" />

      {CURVE_TOOLS.map((tool) => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={setTool} />
      ))}
    </nav>
  )
}

function ToolButton({
  tool,
  active,
  onSelect,
}: {
  tool: ToolDef
  active: boolean
  onSelect: (id: ToolId) => void
}) {
  const Icon = tool.icon
  const isShape = tool.id === 'shape'

  return (
    <Tooltip content={tool.label} shortcut={tool.key.toUpperCase()} placement="right">
      <button
        type="button"
        className={`${styles.toolButton} ${active ? styles.active : ''}`}
        aria-label={tool.label}
        aria-pressed={active}
        onClick={() => onSelect(tool.id)}
      >
        <Icon size={22} />
        {/* 도형 도구는 길게 누르면 하위 메뉴(직선·원·타원·라운드 사각)가 열릴 예정임을
            나타내는 삼각 표시입니다(PRD §9.10). 하위 메뉴 자체는 도형 도구를 실제로
            구현하는 단계에서 만듭니다 — 지금은 표시만 하고 동작은 없습니다. */}
        {isShape && <span className={styles.submenuMark} aria-hidden="true" />}
      </button>
    </Tooltip>
  )
}
