// 편집기 상단바 (PRD §9.9).
//
// 좌측: 뒤로가기 · 파일명(클릭하면 그 자리에서 편집) · 규격 칩 · 저장 상태 칩
// 중앙: 실행취소 / 다시 실행 (실행취소 스택은 다음 단계에서 만들 예정이라 지금은 항상 비활성)
// 우측: 저장 · 미리보기 · 정답 · 인쇄
//
// 이 단계에서는 버튼 동작을 실제 기능에 연결하지 않습니다. 파일명 편집만 예외로,
// editorStore의 doc.meta.title을 실제로 바꾸는 진짜 동작입니다(그 외 버튼은 토스트만 띄움).
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronLeft, Save, Undo2, Redo2, Eye, Printer, ListChecks } from 'lucide-react'
import { Button, StatusChip, Tooltip, useToast } from '@/components'
import { PAPER_SIZES } from '@/lib/model/constants'
import type { MapDoc } from '@/lib/model/types'
import { useEditorStore } from './editorStore'
import styles from './TopBar.module.css'

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

export default function TopBar() {
  const { show } = useToast()
  const doc = useEditorStore((s) => s.doc)
  const setDoc = useEditorStore((s) => s.setDoc)
  const canOverwrite = useEditorStore((s) => s.canOverwrite)
  const saveState = useEditorStore((s) => s.saveState)
  const setSaveState = useEditorStore((s) => s.setSaveState)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  // 이번 단계에서 실제로 연결되지 않은 버튼들의 공통 동작.
  function notConnectedYet() {
    show({ message: '다음 단계에서 연결됩니다' })
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
            onClick={notConnectedYet}
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
        {/* 실행취소 스택은 다음 단계에서 만듭니다. 그동안은 되돌릴 것이 없으니 비활성 상태입니다. */}
        <Tooltip content="실행취소" shortcut="Ctrl+Z" placement="bottom">
          <Button variant="icon" icon={<Undo2 size={18} />} aria-label="실행취소" disabled />
        </Tooltip>
        <Tooltip content="다시 실행" shortcut="Ctrl+Shift+Z" placement="bottom">
          <Button variant="icon" icon={<Redo2 size={18} />} aria-label="다시 실행" disabled />
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
        <Button variant="secondary" icon={<ListChecks size={18} />} onClick={notConnectedYet}>
          정답
        </Button>
        {/* PRD §9.9: 인쇄가 화면에서 유일한 primary 버튼 — 최종 목적지를 하나만 남긴다 */}
        <Button variant="primary" icon={<Printer size={18} />} onClick={notConnectedYet}>
          인쇄
        </Button>
      </div>
    </header>
  )
}
