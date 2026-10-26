// 편집기 좌측 도구 레일 (PRD §9.10, 아이콘·단축키는 §9.6 매핑 표).
//
// 세로로 늘어선 아이콘 버튼 목록입니다. 버튼을 클릭하거나 키보드 단축키를 누르면
// editorStore의 activeTool이 바뀝니다. 이번 단계에서는 "도구를 고른다"까지만 동작하고,
// 고른 도구가 캔버스에서 실제로 무엇을 하는지는 다음 단계(캔버스 뷰포트)에서 만듭니다.
import { Fragment, useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  MousePointer2,
  Grid3x3,
  Stamp,
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

/**
 * 도구 묶음(docs/06 §2.1). 묶음 사이에 구분선을 긋습니다.
 * "무엇을 하는 도구인가"로 나눴습니다 — 고르기 / 길 그리기 / 꾸미기 / 미션 / 지우기.
 * 예전에는 격자 도구 8개 + 곡선 도구 3개 두 묶음뿐이라 지우개가 가운데, 출발·도착이
 * 꾸미기 도구 사이에 섞여 있었습니다(2026-10-26 후기 11번).
 */
const TOOL_GROUPS: ToolDef[][] = [
  [{ id: 'select', key: 'v', label: '선택', icon: MousePointer2 }],
  [
    { id: 'lineDraw', key: 'l', label: '격자선 긋기', icon: Grid3x3 },
    { id: 'pen', key: 'p', label: '펜 (직선·곡선)', icon: PenTool },
    { id: 'freeDraw', key: 'd', label: '자유 그리기', icon: Pencil },
    { id: 'shape', key: 'o', label: '도형', icon: Circle },
  ],
  [
    { id: 'stamp', key: 'b', label: '타일 배치', icon: Stamp },
    { id: 'eyedropper', key: 'i', label: '타일 집기', icon: Pipette },
    { id: 'text', key: 't', label: '글자', icon: Type },
  ],
  [{ id: 'marker', key: 'm', label: '출발·도착·장애물', icon: Flag }],
  [{ id: 'eraser', key: 'e', label: '지우개', icon: Eraser }],
]

const ALL_TOOLS = TOOL_GROUPS.flat()

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

      // R 키는 예전에 "영역 채우기 도구"와 "타일 회전"이 겹쳤지만, 영역 채우기가 타일 도구의
      // Shift+드래그로 합쳐지면서(docs/06 §2.2) 이제 회전 하나뿐입니다(toolInteractions.ts).

      e.preventDefault()
      setTool(tool.id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setTool])

  return (
    <nav className={styles.rail} aria-label="도구">
      {TOOL_GROUPS.map((group, index) => (
        <Fragment key={group[0].id}>
          {index > 0 && <div className={styles.divider} role="separator" />}
          {group.map((tool) => (
            <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={setTool} />
          ))}
        </Fragment>
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
      </button>
    </Tooltip>
  )
}
