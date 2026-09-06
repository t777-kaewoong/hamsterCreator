import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Scissors } from 'lucide-react'
import { Button, Input, Modal, Segmented, useToast } from '@/components'
import { useEditorStore } from '@/features/editor/editorStore'
import { renderMapThumbnail } from '@/features/start/thumbnail'
import { resizeMapDoc } from '@/lib/model/resize'
import { downloadSingleSheetPdf, downloadTiledMapPdf } from '@/lib/pdf/generateMapPdf'
import { createPrintPlanOptions } from '@/lib/print/plan'
import type { PrintPlanOption, PrintPlanSort } from '@/lib/print/plan'
import styles from './PrintPlannerModal.module.css'

type InputMode = 'grid' | 'physical'

function orientationLabel(plan: PrintPlanOption): string {
  return plan.orientation === 'landscape' ? '가로' : '세로'
}

function PlanDiagram({ plan, cols, rows, thumbnail }: { plan: PrintPlanOption; cols: number; rows: number; thumbnail: string }) {
  const scale = Math.min(80 / cols, 80 / rows)
  const mapWidth = cols * scale
  const mapHeight = rows * scale
  const offsetX = (84 - mapWidth) / 2
  const offsetY = (84 - mapHeight) / 2
  return (
    <svg className={styles.diagram} viewBox="0 0 84 84" role="img" aria-label={`${plan.tilesX}×${plan.tilesY}장 분할 도식`}>
      <rect x={offsetX} y={offsetY} width={mapWidth} height={mapHeight} rx="4" className={styles.diagramPaper} />
      {thumbnail && <image href={thumbnail} x={offsetX} y={offsetY} width={mapWidth} height={mapHeight} preserveAspectRatio="xMidYMid meet" opacity="0.35" />}
      {plan.regions.map((region) => {
        const x = offsetX + region.startCol * scale
        const y = offsetY + region.startRow * scale
        const width = region.cols * scale
        const height = region.rows * scale
        return <rect key={region.index} x={x} y={y} width={width} height={height} className={styles.diagramRegion} />
      })}
    </svg>
  )
}

function PlanPreview({ plan, cols, rows, thumbnail }: { plan: PrintPlanOption; cols: number; rows: number; thumbnail: string }) {
  const ratio = cols / rows
  return (
    <div className={styles.previewFrame}>
      <svg className={styles.previewSvg} viewBox={`0 0 ${cols} ${rows}`} style={{ aspectRatio: String(ratio) }} role="img" aria-label="선택한 출력 계획 미리보기">
        <rect width={cols} height={rows} className={styles.previewPaper} />
        {thumbnail && <image href={thumbnail} width={cols} height={rows} preserveAspectRatio="none" opacity="0.42" />}
        {plan.regions.map((region) => (
          <g key={region.index}>
            <rect
              x={region.startCol}
              y={region.startRow}
              width={region.cols}
              height={region.rows}
              className={styles.previewRegion}
            />
            <rect x={region.startCol + 0.12} y={region.startRow + 0.12} width="0.62" height="0.42" rx="0.1" className={styles.previewBadge} />
            <text x={region.startCol + 0.43} y={region.startRow + 0.42} textAnchor="middle" className={styles.previewNumber}>
              {region.row + 1}-{region.column + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function PrintPlannerModal() {
  const open = useEditorStore((state) => state.printPlannerOpen)
  const setOpen = useEditorStore((state) => state.setPrintPlannerOpen)
  const doc = useEditorStore((state) => state.doc)
  const { show } = useToast()
  const [inputMode, setInputMode] = useState<InputMode>('grid')
  const [sort, setSort] = useState<PrintPlanSort>('sheets')
  const [selectedId, setSelectedId] = useState('')
  const [firstDraft, setFirstDraft] = useState('')
  const [secondDraft, setSecondDraft] = useState('')
  const [seam, setSeam] = useState<'butt' | 'overlap'>('butt')
  const [overlap, setOverlap] = useState('5')
  const [creating, setCreating] = useState(false)
  const wasOpenRef = useRef(false)

  const options = useMemo(() => doc ? createPrintPlanOptions(doc, sort) : [], [doc, sort])
  const selected = options.find((option) => option.id === selectedId) ?? options[0]
  const thumbnail = useMemo(() => doc && open ? renderMapThumbnail(doc, 180, 140) : '', [doc, open])

  useEffect(() => {
    if (open && !wasOpenRef.current && doc) {
      setSelectedId('')
      setInputMode('grid')
      setFirstDraft(String(doc.board.cols))
      setSecondDraft(String(doc.board.rows))
      setSeam(doc.print.seam)
      setOverlap(String(doc.print.overlap || 5))
    }
    wasOpenRef.current = open
  }, [open, doc])

  useEffect(() => {
    if (options.length > 0 && !options.some((option) => option.id === selectedId)) setSelectedId(options[0].id)
  }, [options, selectedId])

  if (!doc || !selected) return null

  function changeInputMode(value: string) {
    const nextMode = value as InputMode
    setInputMode(nextMode)
    if (nextMode === 'grid') {
      setFirstDraft(String(doc!.board.cols))
      setSecondDraft(String(doc!.board.rows))
    } else {
      setFirstDraft(String(doc!.board.cols * doc!.board.pitch))
      setSecondDraft(String(doc!.board.rows * doc!.board.pitch))
    }
  }

  function applySize() {
    const current = useEditorStore.getState().doc
    if (!current) return
    const first = Number(firstDraft)
    const second = Number(secondDraft)
    if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) return
    const cols = inputMode === 'grid' ? Math.round(first) : Math.max(1, Math.round(first / current.board.pitch))
    const rows = inputMode === 'grid' ? Math.round(second) : Math.max(1, Math.round(second / current.board.pitch))
    if (cols === current.board.cols && rows === current.board.rows) return
    useEditorStore.getState().commitDoc(resizeMapDoc(current, cols, rows))
  }

  async function createPdf() {
    const current = useEditorStore.getState().doc
    if (!current || creating) return
    const overlapMm = seam === 'overlap' ? Math.max(1, Number(overlap) || 5) : 0
    const nextDoc = {
      ...current,
      print: {
        ...current.print,
        sheet: selected.sheet,
        orientation: selected.orientation,
        layout: selected.sheets === 1 ? 'single' as const : 'tiled' as const,
        seam,
        overlap: overlapMm,
      },
    }
    setCreating(true)
    try {
      if (selected.sheets === 1) await downloadSingleSheetPdf(nextDoc)
      else await downloadTiledMapPdf(nextDoc, selected)
      useEditorStore.getState().commitDoc(nextDoc)
      show({ message: 'PDF를 내려받았습니다' })
      setOpen(false)
    } catch (error) {
      show({ message: error instanceof Error ? error.message : 'PDF를 만들지 못했습니다', tone: 'danger' })
    } finally {
      setCreating(false)
    }
  }

  const footer = (
    <div className={styles.footerContent}>
      <span className="t-caption">
        {selected.sheetLabel} {orientationLabel(selected)} {selected.sheets}장
        {selected.sheets > 1 ? ' + 조립 안내도 1장' : ' · 이음매 없음'}
      </span>
      <div className={styles.footerActions}>
        <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
        <Button variant="primary" loading={creating} onClick={createPdf}>{creating ? '만드는 중…' : 'PDF 만들기'}</Button>
      </div>
    </div>
  )

  return (
    <Modal open={open} onClose={() => !creating && setOpen(false)} title="출력 계획기" width="min(940px, 92vw)" footer={footer}>
      <div className={styles.planner}>
        <div className={styles.inputBar}>
          <Segmented
            options={[{ value: 'grid', label: '격자 크기로' }, { value: 'physical', label: '실물 크기로' }]}
            value={inputMode}
            onChange={changeInputMode}
            aria-label="출력 크기 입력 방식"
          />
          <div className={styles.sizeInputs}>
            <Input
              type="number"
              min="1"
              value={firstDraft}
              onChange={(event) => setFirstDraft(event.target.value)}
              onBlur={applySize}
              unit={inputMode === 'grid' ? '열' : 'mm'}
              aria-label={inputMode === 'grid' ? '열' : '가로 길이'}
            />
            <span aria-hidden="true">×</span>
            <Input
              type="number"
              min="1"
              value={secondDraft}
              onChange={(event) => setSecondDraft(event.target.value)}
              onBlur={applySize}
              unit={inputMode === 'grid' ? '행' : 'mm'}
              aria-label={inputMode === 'grid' ? '행' : '세로 길이'}
            />
          </div>
          <label className={`${styles.sortField} t-label`}>
            정렬
            <select value={sort} onChange={(event) => setSort(event.target.value as PrintPlanSort)}>
              <option value="sheets">장수 최소</option>
              <option value="seams">이음매 최소</option>
              <option value="waste">낭비 최소</option>
            </select>
          </label>
        </div>

        <div className={styles.main}>
          <div className={styles.optionList} role="listbox" aria-label="용지 출력 계획">
            {options.map((option, index) => {
              const active = option.id === selected.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${styles.optionCard} ${active ? styles.optionSelected : ''}`}
                  onClick={() => setSelectedId(option.id)}
                >
                  <PlanDiagram plan={option} cols={doc.board.cols} rows={doc.board.rows} thumbnail={thumbnail} />
                  <span className={styles.optionInfo}>
                    <span className={styles.optionTitle}>
                      <strong className="t-label">{option.sheetLabel} {orientationLabel(option)}</strong>
                      <span className={`${styles.countBadge} t-micro`}>{option.sheets}장</span>
                    </span>
                    <span className="t-caption">이음매 {option.seams}곳 · 낭비 {option.wasteCells}칸</span>
                    <span className={styles.chips}>
                      {option.wasteCells === 0 && <span className={styles.okChip}><Check size={12} />딱 맞음</span>}
                      {option.seams === 0 && <span className={styles.okChip}><Check size={12} />이음매 없음</span>}
                      {option.curveCrossings > 0 && <span className={styles.warnChip}><AlertTriangle size={12} />곡선 교차 {option.curveCrossings}</span>}
                    </span>
                  </span>
                  {index === 0 && <span className={`${styles.recommended} t-micro`}>추천</span>}
                </button>
              )
            })}
          </div>

          <div className={styles.previewPane}>
            <div className={styles.previewHeader}>
              <div>
                <strong className="t-h2">{selected.sheetLabel} {orientationLabel(selected)} · {selected.tilesX}×{selected.tilesY}장</strong>
                <p className="t-caption">파선은 실제 셀 경계에 놓이는 시트 이음매입니다.</p>
              </div>
              {selected.curveCrossings > 0 && <span className={styles.crossingNotice}><AlertTriangle size={14} />피할 수 없는 곡선 교차 {selected.curveCrossings}곳</span>}
            </div>
            <PlanPreview plan={selected} cols={doc.board.cols} rows={doc.board.rows} thumbnail={thumbnail} />
            <div className={styles.seamControls}>
              <span className="t-label"><Scissors size={15} />이음매 방식</span>
              <Segmented
                options={[{ value: 'butt', label: '맞대기' }, { value: 'overlap', label: '겹치기' }]}
                value={seam}
                onChange={(value) => setSeam(value as 'butt' | 'overlap')}
                aria-label="이음매 방식"
              />
              {seam === 'overlap' && (
                <Input type="number" min="1" max="10" value={overlap} onChange={(event) => setOverlap(event.target.value)} unit="mm" aria-label="겹치기 폭" />
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
