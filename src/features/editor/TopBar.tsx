// 편집기 상단바 (PRD §9.9).
//
// 좌측: 뒤로가기 · 파일명(클릭하면 그 자리에서 편집) · 규격 칩 · 저장 상태 칩
// 중앙: 실행취소 / 다시 실행 — editorStore의 undoStack/redoStack과 직접 연결됩니다.
//       (M1-4) 스택이 비어있으면 버튼이 자동으로 비활성화됩니다.
// 우측: 저장 · 미리보기 · 정답 · 인쇄
//
// 이 단계에서는 실행취소/재실행·파일명 편집·뒤로가기만 실제 기능에 연결합니다(그 외
// 버튼은 토스트만 띄움). PRD §9.16: "실행취소 | 토스트 없음. 상단바 버튼 상태만 갱신" —
// 그래서 undo()/redo()는 토스트를 띄우지 않고 버튼 disabled 상태만 자연스럽게 바뀝니다.
//
// [뒤로가기(M1-5c)] 시작 화면 ↔ 편집기 전환은 editorStore에 상태를 두지 않고(다른
// 작업자가 그 파일을 동시에 수정 중이라 손대지 않기로 했습니다) App.tsx의 로컬
// useState로 관리합니다. 그래서 이 컴포넌트는 "어디로 돌아갈지"를 모르고, 그냥
// App.tsx가 내려주는 onBack()만 부릅니다. 저장 안 된 변경이 있으면 곧장 나가지 않고
// 먼저 Modal로 확인을 받습니다(작업 지시: window.confirm 대신 기존 Modal 컴포넌트 재사용).
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronLeft, Save, Undo2, Redo2, Eye, Printer, ListChecks } from 'lucide-react'
import { Button, Modal, StatusChip, Tooltip, useToast } from '@/components'
import { PAPER_SIZES } from '@/lib/model/constants'
import type { MapDoc } from '@/lib/model/types'
import { downloadSingleSheetPdf } from '@/lib/pdf/generateMapPdf'
import { useEditorStore } from './editorStore'
import styles from './TopBar.module.css'

export interface TopBarProps {
  /** 뒤로가기(좌측 ChevronLeft) 클릭이 최종적으로 승인됐을 때 호출됩니다.
   *  저장 안 된 변경이 있으면 이 함수를 바로 부르지 않고 확인 모달을 먼저 띄웁니다. */
  onBack: () => void
}

/** 지금 포커스가 글자 입력 요소에 있는지. Ctrl+Z로 텍스트 입력창의 되돌리기를 하는 중에
 *  맵 전체가 같이 되돌아가면 안 되므로, 입력창에 포커스가 있으면 단축키를 무시합니다. */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.hasAttribute('contenteditable')
}

/** 좌측 규격 칩에 보여줄 문구를 만듭니다. 예: "A4 · 5×4 · 250×200mm"
 *  PRD §9.9의 예시는 "A4 · 5×4"만 보여주지만, 이 프로젝트의 요구사항대로 격자 수와
 *  실물 mm 크기를 함께 보여주도록 §9.8 프리셋 카드 칩("A4 · 5×4칸 · 250×200mm") 형식을 따랐습니다. */
function formatSizeChip(doc: MapDoc): string {
  const paper = PAPER_SIZES.find((p) => p.id === doc.print.sheet)
  const sheetLabel = paper?.label ?? doc.print.sheet
  const widthMm = doc.board.cols * doc.board.pitch
  const heightMm = doc.board.rows * doc.board.pitch
  return `${sheetLabel} · ${doc.board.cols}×${doc.board.rows} · ${widthMm}×${heightMm}mm`
}

export default function TopBar({ onBack }: TopBarProps) {
  const { show } = useToast()
  const doc = useEditorStore((s) => s.doc)
  const setDoc = useEditorStore((s) => s.setDoc)
  const canOverwrite = useEditorStore((s) => s.canOverwrite)
  const saveState = useEditorStore((s) => s.saveState)
  const setSaveState = useEditorStore((s) => s.setSaveState)
  const undoStack = useEditorStore((s) => s.undoStack)
  const redoStack = useEditorStore((s) => s.redoStack)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const setPrintPlannerOpen = useEditorStore((s) => s.setPrintPlannerOpen)
  const setAnswerOpen = useEditorStore((s) => s.setAnswerOpen)

  // Ctrl+Z / Ctrl+Shift+Z (맥에서는 Cmd). 도구 레일 단축키(ToolRail.tsx)와 마찬가지로
  // 입력창에 포커스가 있으면 무시합니다.
  useEffect(() => {
    // 이 파일은 위에서 React의 KeyboardEvent<T>를 이미 import했으므로(파일명 입력창용),
    // 여기서는 window가 실제로 주는 DOM 이벤트 타입임을 globalThis로 명시합니다.
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 'z') return
      if (isTypingTarget(document.activeElement)) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  // 뒤로가기 확인 모달. saveState가 'unsaved'일 때만 이 모달을 거칩니다 — 저장된 상태라면
  // 되돌릴 게 없으므로 바로 나갑니다(PRD U7: 확인 모달은 정말 필요할 때만).
  const [confirmBackOpen, setConfirmBackOpen] = useState(false)
  const [isCreatingPdf, setIsCreatingPdf] = useState(false)

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  // 이번 단계에서 실제로 연결되지 않은 버튼들의 공통 동작.
  function notConnectedYet() {
    show({ message: '다음 단계에서 연결됩니다' })
  }

  async function handlePrint() {
    if (!doc || isCreatingPdf) return
    if (doc.print.layout === 'tiled') {
      setPrintPlannerOpen(true)
      return
    }
    setIsCreatingPdf(true)
    try {
      await downloadSingleSheetPdf(doc)
      show({ message: 'PDF를 내려받았습니다' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF를 만들지 못했습니다'
      show({ message, tone: 'danger' })
    } finally {
      setIsCreatingPdf(false)
    }
  }

  function handleBackClick() {
    if (saveState === 'unsaved') {
      setConfirmBackOpen(true)
      return
    }
    onBack()
  }

  function confirmLeaveWithoutSaving() {
    setConfirmBackOpen(false)
    onBack()
  }

  function startEditingTitle() {
    if (!doc) return
    setTitleDraft(doc.meta.title)
    setEditingTitle(true)
  }

  function commitTitle() {
    if (!doc) {
      setEditingTitle(false)
      return
    }
    const title = titleDraft.trim()
    setDoc({ ...doc, meta: { ...doc.meta, title, updatedAt: new Date().toISOString() } })
    setSaveState('unsaved')
    setEditingTitle(false)
  }

  function handleTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitTitle()
    else if (e.key === 'Escape') setEditingTitle(false)
  }

  const displayTitle = doc?.meta.title || '(제목 없음)'

  return (
    <header className={styles.bar}>
      <div className={styles.leftGroup}>
        <Tooltip content="뒤로가기" placement="bottom">
          <Button
            variant="icon"
            icon={<ChevronLeft size={18} />}
            aria-label="뒤로가기"
            onClick={handleBackClick}
          />
        </Tooltip>

        {editingTitle ? (
          <input
            ref={titleInputRef}
            className={`${styles.fileNameInput} t-label`}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={handleTitleKeyDown}
          />
        ) : (
          <button
            type="button"
            className={`${styles.fileName} t-label`}
            onClick={startEditingTitle}
            title={displayTitle}
          >
            {displayTitle}
          </button>
        )}

        {doc && <span className={`${styles.sizeChip} t-micro`}>{formatSizeChip(doc)}</span>}

        <StatusChip status={saveState} />
      </div>

      <div className={styles.centerGroup}>
        <Tooltip content="실행취소" shortcut="Ctrl+Z" placement="bottom">
          <Button
            variant="icon"
            icon={<Undo2 size={18} />}
            aria-label="실행취소"
            disabled={undoStack.length === 0}
            onClick={undo}
          />
        </Tooltip>
        <Tooltip content="다시 실행" shortcut="Ctrl+Shift+Z" placement="bottom">
          <Button
            variant="icon"
            icon={<Redo2 size={18} />}
            aria-label="다시 실행"
            disabled={redoStack.length === 0}
            onClick={redo}
          />
        </Tooltip>
      </div>

      <div className={styles.rightGroup}>
        <Button variant="secondary" icon={<Save size={18} />} onClick={notConnectedYet}>
          {canOverwrite ? '저장' : '내려받기'}
        </Button>

        <span className={styles.divider} aria-hidden="true" />

        <Button variant="ghost" icon={<Eye size={18} />} onClick={notConnectedYet}>
          미리보기
        </Button>
        <Button variant="secondary" icon={<ListChecks size={18} />} onClick={() => setAnswerOpen(true)} disabled={!doc}>
          정답
        </Button>
        {/* PRD §9.9: 인쇄가 화면에서 유일한 primary 버튼 — 최종 목적지를 하나만 남긴다 */}
        <Button
          variant="primary"
          icon={<Printer size={18} />}
          onClick={handlePrint}
          disabled={!doc || isCreatingPdf}
          aria-busy={isCreatingPdf}
        >
          {isCreatingPdf ? '만드는 중…' : '인쇄'}
        </Button>
      </div>

      <Modal
        open={confirmBackOpen}
        onClose={() => setConfirmBackOpen(false)}
        title="저장하지 않은 변경사항"
        width={400}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmBackOpen(false)}>
              취소
            </Button>
            <Button variant="danger" onClick={confirmLeaveWithoutSaving}>
              저장하지 않고 나가기
            </Button>
          </>
        }
      >
        <p className="t-body">
          지금 나가면 저장하지 않은 변경 내용이 사라집니다. 그래도 시작 화면으로 돌아갈까요?
        </p>
      </Modal>
    </header>
  )
}
