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

/** PDF에 함께 넣을 부가 요소(docs/05 §3.6 — 2026-09-29 후기 "출력할지 말지 체크박스"). */
interface PdfExtras {
  assemblyGuide: boolean
  cropMarks: boolean
  scaleRuler: boolean
  notice: boolean
}
const DEFAULT_EXTRAS: PdfExtras = { assemblyGuide: true, cropMarks: true, scaleRuler: true, notice: true }

/**
 * 종이 여백 설명 한 줄(2026-09-29 후기 "여백이 너무 넓은 것 아닌가?").
 *
 * 여백은 의도된 값입니다. 칸 크기 50mm를 지키면 A4 가로(297mm)에는 5칸(250mm)까지만
 * 들어가서 좌우에 23.5mm씩 남습니다. 공식 playbot_A4.pdf도 같은 배치입니다.
 * 맵을 늘려 채우면 칸이 50mm가 아니게 되어 로봇 이동 거리·정품 타일과 어긋납니다.
 */
function marginNote(plan: PrintPlanOption, pitch: number): string {
  const first = plan.regions[0]
  const sideMm = (plan.pageWidthMm - first.cols * pitch) / 2
  const topMm = (plan.pageHeightMm - first.rows * pitch) / 2
  const fmt = (mm: number) => (Number.isInteger(mm) ? String(mm) : mm.toFixed(1))
  return `종이 여백 좌우 ${fmt(sideMm)}mm · 위아래 ${fmt(topMm)}mm — 칸을 실제 50mm로 지키려고 남는 부분입니다(공식 말판과 같음)`
}

function ExtraCheck({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label
      className={`${styles.extraItem} ${disabled ? styles.extraDisabled : ''}`}
      title={disabled ? '여러 장으로 나눌 때만 들어갑니다' : undefined}
    >
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.extraText}>
        <span className="t-label">{label}</span>
        <span className="t-caption">{hint}</span>
      </span>
    </label>
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
  // PDF에 함께 넣을 것들(docs/05 §3.6). 열 때마다 문서에 저장된 값으로 다시 채웁니다.
  const [extras, setExtras] = useState<PdfExtras>(DEFAULT_EXTRAS)
  const wasOpenRef = useRef(false)
  const optionListRef = useRef<HTMLDivElement>(null)

  const options = useMemo(() => doc ? createPrintPlanOptions(doc, sort) : [], [doc, sort])
  const selected = options.find((option) => option.id === selectedId) ?? options[0]
  const thumbnail = useMemo(() => doc && open ? renderMapThumbnail(doc, 180, 140) : '', [doc, open])

  useEffect(() => {
    if (open && !wasOpenRef.current && doc) {
      // 처음에는 지금 편집 중인 용지(캔버스에 종이 경계로 보이던 그 계획)를 골라 둡니다.
      // A4를 이어 붙여 만든 맵인데 "장수 최소" 1순위라는 이유로 B3가 먼저 골라져 있으면,
      // 교사가 화면에서 본 종이 나눔과 PDF가 달라집니다(2026-09-28). 다른 용지는 목록에서
      // 여전히 고를 수 있고, "추천" 표시도 그대로 1순위에 붙습니다.
      setSelectedId(`${doc.print.sheet}-${doc.print.orientation}`)
      setInputMode('grid')
      setFirstDraft(String(doc.board.cols))
      setSecondDraft(String(doc.board.rows))
      setSeam(doc.print.seam)
      setOverlap(String(doc.print.overlap || 5))
      setExtras({
        assemblyGuide: doc.print.assemblyGuide !== false,
        cropMarks: doc.print.cropMarks,
        scaleRuler: doc.print.scaleRuler,
        notice: doc.print.notice !== false,
      })
    }
    wasOpenRef.current = open
  }, [open, doc])

  useEffect(() => {
    if (options.length > 0 && !options.some((option) => option.id === selectedId)) setSelectedId(options[0].id)
  }, [options, selectedId])

  // 골라 둔 "지금 용지" 카드가 목록 아래쪽에 있으면 열자마자 보이도록 스크롤합니다.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      optionListRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, selectedId])

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
        ...extras,
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
        {selected.sheets > 1 ? (extras.assemblyGuide ? ' + 조립 안내도 1장' : '') : ' · 이음매 없음'}
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
          <div ref={optionListRef} className={styles.optionList} role="listbox" aria-label="용지 출력 계획">
            {options.map((option, index) => {
              const active = option.id === selected.id
              const isCurrentPaper = option.id === `${doc.print.sheet}-${doc.print.orientation}`
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
                      {isCurrentPaper && <span className={styles.currentChip}>편집 중인 용지</span>}
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
                <p className={`${styles.marginNote} t-caption`}>{marginNote(selected, doc.board.pitch)}</p>
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
            <fieldset className={styles.extras}>
              <legend className="t-label">PDF에 넣을 것</legend>
              <ExtraCheck
                label="조립 안내도"
                hint="여러 장을 이어 붙이는 순서 그림 1쪽"
                checked={extras.assemblyGuide}
                disabled={selected.sheets <= 1}
                onChange={(v) => setExtras({ ...extras, assemblyGuide: v })}
              />
              <ExtraCheck
                label="재단선·맞춤 표시"
                hint="자를 선과 이어 붙일 삼각 표시"
                checked={extras.cropMarks}
                disabled={selected.sheets <= 1}
                onChange={(v) => setExtras({ ...extras, cropMarks: v })}
              />
              <ExtraCheck
                label="50mm 확인 자"
                hint="인쇄 후 자로 재서 크기 확인"
                checked={extras.scaleRuler}
                onChange={(v) => setExtras({ ...extras, scaleRuler: v })}
              />
              <ExtraCheck
                label="안내 문구·시트 번호"
                hint="“실제 크기(100%)로 인쇄” 문구와 1-1 번호"
                checked={extras.notice}
                onChange={(v) => setExtras({ ...extras, notice: v })}
              />
            </fieldset>
          </div>
        </div>
      </div>
    </Modal>
  )
}
