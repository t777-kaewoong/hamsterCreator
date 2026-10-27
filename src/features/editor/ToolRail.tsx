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
  /** 버튼 아래에 늘 보이는 짧은 이름(4글자 안팎). docs/08 §3.1 */
  short: string
  icon: LucideIcon
}

/**
 * 도구 묶음(docs/08 §3.1 — 유사 프로그램 조사 반영). 묶음 사이에 구분선을 긋습니다.
 * - 선택은 맨 위(Excalidraw·Photoshop 공통).
 * - 길 그리기: 격자선 · 펜(직선·곡선·자유) · 도형 · 지우개. 지우개는 그리기 도구 바로 옆에 둡니다
 *   (그림판·맵 편집기 관례, 2026-10-27 후기 "지우개를 펜 근처로").
 * - 꾸미기: 타일 · 타일 집기 · 글자.  - 미션: 출발·도착·장애물.
 * 위에서 아래가 말판을 만드는 순서(길 → 꾸미기 → 미션)와 같습니다.
 */
const TOOL_GROUPS: ToolDef[][] = [
  [{ id: 'select', key: 'v', label: '선택', short: '선택', icon: MousePointer2 }],
  [
    { id: 'lineDraw', key: 'l', label: '격자선 긋기', short: '격자선', icon: Grid3x3 },
    { id: 'pen', key: 'p', label: '펜 (직선·곡선·자유)', short: '펜', icon: PenTool },
    { id: 'shape', key: 'o', label: '도형', short: '도형', icon: Circle },
    { id: 'eraser', key: 'e', label: '지우개', short: '지우개', icon: Eraser },
  ],
  [
    { id: 'stamp', key: 'b', label: '타일 배치', short: '타일', icon: Stamp },
    { id: 'eyedropper', key: 'i', label: '타일 집기', short: '집기', icon: Pipette },
    { id: 'text', key: 't', label: '글자', short: '글자', icon: Type },
  ],
  [{ id: 'marker', key: 'm', label: '출발·도착·장애물', short: '출발·도착', icon: Flag }],
]

const ALL_TOOLS = TOOL_GROUPS.flat()

/** 자유 그리기(D)는 레일에 버튼이 없고 펜의 "자유" 모드입니다(docs/08 §3.2). D 키는 그대로 받습니다. */
const FREE_DRAW_KEY = 'd'

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

  // 펜 버튼을 누르면 마지막에 쓰던 펜 모드로 돌아갑니다(자유였으면 자유 그리기).
  function handleSelect(id: ToolId) {
    if (id === 'pen' && useEditorStore.getState().penMode === 'free') setTool('freeDraw')
    else setTool(id)
  }

  // 키보드 단축키. 입력창에 포커스가 있거나 Ctrl/Alt/Cmd가 눌려 있으면(다른 브라우저
  // 단축키와 겹치는 것을 피하기 위해) 무시합니다.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(document.activeElement)) return

      const key = e.key.toLowerCase()
      if (key === FREE_DRAW_KEY) {
        e.preventDefault()
        setTool('freeDraw')
        return
      }
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
            <ToolButton
              key={tool.id}
              tool={tool}
              // 펜 버튼은 자유 모드(freeDraw)일 때도 켜짐으로 보입니다.
              active={activeTool === tool.id || (tool.id === 'pen' && activeTool === 'freeDraw')}
              onSelect={handleSelect}
            />
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
        <Icon size={20} aria-hidden="true" />
        <span className={`${styles.toolLabel} t-micro`}>{tool.short}</span>
      </button>
    </Tooltip>
  )
}
