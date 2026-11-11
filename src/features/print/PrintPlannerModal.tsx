// PDF 저장 화면(옛 "출력 계획기", PRD §9.14 → docs/14 §2.3).
//
// [2026-11-11 후기 11차 — "용지 설정이 복잡하다"]
// 예전에는 왼쪽에 용지 9종 × 방향 2 = 18장 카드 목록, 위에 크기 입력·정렬이 있었습니다. 교사가 실제로
// 정하는 것은 "어떤 종이에 뽑을까" 하나뿐이라 용지는 드롭다운 하나, 방향은 가로/세로 두 칸(장수가
// 적은 쪽 자동 선택 + 추천 표시)으로 줄였습니다. 맵 크기는 인스펙터에서 바꿉니다.
// 이름도 실제로 하는 일대로 "PDF 저장"입니다(브라우저 인쇄는 하지 않음).
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileDown, Scissors } from 'lucide-react'
import { Button, Input, Modal, Segmented, useToast } from '@/components'
import { useEditorStore } from '@/features/editor/editorStore'
import { renderMapThumbnail } from '@/features/start/thumbnail'
import { PAPER_SIZES } from '@/lib/model/constants'
import { downloadSingleSheetPdf, downloadTiledMapPdf } from '@/lib/pdf/generateMapPdf'
import { createPrintPlanOptions } from '@/lib/print/plan'
import type { PrintPlanOption } from '@/lib/print/plan'
import styles from './PrintPlannerModal.module.css'

type Orientation = 'landscape' | 'portrait'

function orientationLabel(orientation: Orientation): string {
  return orientation === 'landscape' ? '가로' : '세로'
}

/** 같은 용지의 가로·세로 중 더 나은 쪽. 곡선 교차가 없는 쪽 → 장수 → 이음매 → 남는 칸 순서. */
function betterOf(a: PrintPlanOption, b: PrintPlanOption): PrintPlanOption {
  const key = (o: PrintPlanOption) => [Number(o.curveCrossings > 0), o.sheets, o.seams, o.wasteCells]
  const ka = key(a)
  const kb = key(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? a : b
  return a.orientation === 'landscape' ? a : b
}

function PlanPreview({ plan, cols, rows, thumbnail }: { plan: PrintPlanOption; cols: number; rows: number; thumbnail: string }) {
  const ratio = cols / rows
  return (
    <div className={styles.previewFrame}>
      <svg className={styles.previewSvg} viewBox={`0 0 ${cols} ${rows}`} style={{ aspectRatio: String(ratio) }} role="img" aria-label="종이 나눔 미리보기">
        <rect width={cols} height={rows} className={styles.previewPaper} />
        {thumbnail && <image href={thumbnail} width={cols} height={rows} preserveAspectRatio="xMidYMid meet" opacity="0.42" />}
        {plan.regions.map((region) => (
          <g key={region.index}>
            <rect x={region.startCol} y={region.startRow} width={region.cols} height={region.rows} className={styles.previewRegion} />
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

/** PDF에 함께 넣을 부가 요소(docs/05 §3.6). 후기 11차: 열 때마다 모두 해제(docs/14 §2.3). */
interface PdfExtras {
  assemblyGuide: boolean
  cropMarks: boolean
  scaleRuler: boolean
  notice: boolean
}
const DEFAULT_EXTRAS: PdfExtras = { assemblyGuide: false, cropMarks: false, scaleRuler: false, notice: false }

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
  const [sheet, setSheet] = useState('A4')
  const [orientation, setOrientation] = useState<Orientation>('landscape')
  const [seam, setSeam] = useState<'butt' | 'overlap'>('butt')
  const [overlap, setOverlap] = useState('5')
  const [creating, setCreating] = useState(false)
  const [extras, setExtras] = useState<PdfExtras>(DEFAULT_EXTRAS)
  const wasOpenRef = useRef(false)

  const options = useMemo(() => (doc ? createPrintPlanOptions(doc) : []), [doc])
  const pair = useMemo(() => {
    const landscape = options.find((o) => o.sheet === sheet && o.orientation === 'landscape')
    const portrait = options.find((o) => o.sheet === sheet && o.orientation === 'portrait')
    return { landscape, portrait }
  }, [options, sheet])
  const recommended = pair.landscape && pair.portrait ? betterOf(pair.landscape, pair.portrait) : (pair.landscape ?? pair.portrait)
  const selected = (orientation === 'landscape' ? pair.landscape : pair.portrait) ?? recommended
  // 썸네일은 맵 비율 그대로 만들어야 미리보기에서 원이 타원으로 찌그러지지 않습니다.
  const thumbnail = useMemo(() => {
    if (!doc || !open) return ''
    const w = 480
    return renderMapThumbnail(doc, w, Math.max(40, Math.round((w * doc.board.rows) / doc.board.cols)))
  }, [doc, open])

  useEffect(() => {
    if (open && !wasOpenRef.current && doc) {
      // 처음에는 지금 편집 중인 용지·방향(캔버스에 종이 경계로 보이던 그대로)을 골라 둡니다.
      // 새 문서는 A4 가로입니다. 체크 4개는 늘 해제한 채로 엽니다(후기 11차 7-3).
      const known = PAPER_SIZES.some((p) => p.id === doc.print.sheet)
      setSheet(known ? doc.print.sheet : 'A4')
      setOrientation(doc.print.orientation)
      setSeam(doc.print.seam)
      setOverlap(String(doc.print.overlap || 5))
      setExtras(DEFAULT_EXTRAS)
    }
    wasOpenRef.current = open
  }, [open, doc])

  if (!doc || !selected) return null

  /** 용지를 바꾸면 그 용지에서 장수가 적은 방향을 자동으로 고릅니다. */
  function changeSheet(next: string) {
    setSheet(next)
    const l = options.find((o) => o.sheet === next && o.orientation === 'landscape')
    const p = options.find((o) => o.sheet === next && o.orientation === 'portrait')
    const best = l && p ? betterOf(l, p) : (l ?? p)
    if (best) setOrientation(best.orientation)
  }

  async function createPdf() {
    const current = useEditorStore.getState().doc
    if (!current || creating || !selected) return
    const overlapMm = seam === 'overlap' ? Math.max(1, Number(overlap) || 5) : 0
    const nextDoc = {
      ...current,
      print: {
        ...current.print,
        sheet: selected.sheet,
        orientation: selected.orientation,
        layout: selected.sheets === 1 ? ('single' as const) : ('tiled' as const),
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
      show({ message: 'PDF를 저장했습니다' })
      setOpen(false)
    } catch (error) {
      show({ message: error instanceof Error ? error.message : 'PDF를 만들지 못했습니다', tone: 'danger' })
    } finally {
      setCreating(false)
    }
  }

  const multi = selected.sheets > 1
  const bothOrientations = Boolean(pair.landscape && pair.portrait)
  const orientationOptions = (['landscape', 'portrait'] as const)
    .filter((o) => (o === 'landscape' ? pair.landscape : pair.portrait))
    .map((o) => ({
      value: o,
      label: bothOrientations && recommended?.orientation === o ? `${orientationLabel(o)} · 추천` : orientationLabel(o),
    }))

  const footer = (
    <div className={styles.footerContent}>
      <span className="t-caption">
        {selected.sheetLabel} {orientationLabel(selected.orientation)} {selected.sheets}장
        {multi && extras.assemblyGuide ? ' + 조립 안내도 1장' : ''}
      </span>
      <div className={styles.footerActions}>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          취소
        </Button>
        <Button variant="primary" icon={<FileDown size={16} />} loading={creating} onClick={createPdf}>
          {creating ? '만드는 중…' : 'PDF 저장'}
        </Button>
      </div>
    </div>
  )

  return (
    <Modal open={open} onClose={() => !creating && setOpen(false)} title="PDF 저장" width="min(880px, 94vw)" footer={footer}>
      <div className={styles.planner}>
        <div className={styles.settings}>
          <label className={styles.field}>
            <span className="t-label">용지</span>
            <select className={styles.select} value={sheet} onChange={(e) => changeSheet(e.target.value)} aria-label="용지">
              {/* PAPER_SIZES는 A4·A3·A2·A1·A0 다음 B4·B3·B2·B1 순서입니다(constants.ts). */}
              {PAPER_SIZES.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paper.label} ({paper.widthMm}×{paper.heightMm}mm)
                </option>
              ))}
            </select>
          </label>

          <div className={styles.field}>
            <span className="t-label">방향</span>
            <Segmented
              fullWidth
              options={orientationOptions}
              value={selected.orientation}
              onChange={(v) => setOrientation(v as Orientation)}
              aria-label="용지 방향"
            />
          </div>

          <div className={styles.resultCard}>
            <strong className={styles.resultCount}>{selected.sheets}장</strong>
            <span className="t-caption">
              {multi ? `가로 ${selected.tilesX} × 세로 ${selected.tilesY} · 이음매 ${selected.seams}곳` : '한 장에 다 들어가요'}
            </span>
          </div>

          {multi && (
            <div className={styles.field}>
              <span className={`${styles.fieldTitle} t-label`}>
                <Scissors size={14} />
                이음매 방식
              </span>
              <Segmented
                fullWidth
                options={[
                  { value: 'butt', label: '맞대기' },
                  { value: 'overlap', label: '겹치기' },
                ]}
                value={seam}
                onChange={(value) => setSeam(value as 'butt' | 'overlap')}
                aria-label="이음매 방식"
              />
              {seam === 'overlap' && (
                <Input type="number" min="1" max="10" value={overlap} onChange={(event) => setOverlap(event.target.value)} unit="mm" aria-label="겹치기 폭" />
              )}
              <p className={`${styles.seamHint} t-caption`}>
                오른쪽·아래 장의 <b>자르기</b> 점선 한 줄만 자르고, 왼쪽·위 장 위에 얹어 붙이세요.
              </p>
            </div>
          )}

          <fieldset className={styles.extras}>
            <legend className="t-label">PDF에 넣을 것</legend>
            <ExtraCheck label="조립 안내도" hint="붙이는 순서 그림 1쪽" checked={extras.assemblyGuide} disabled={!multi} onChange={(v) => setExtras({ ...extras, assemblyGuide: v })} />
            <ExtraCheck label="맞춤 표시" hint="이음 변 가운데 삼각 표시" checked={extras.cropMarks} disabled={!multi} onChange={(v) => setExtras({ ...extras, cropMarks: v })} />
            <ExtraCheck label="50mm 확인 자" hint="인쇄 후 자로 재서 크기 확인" checked={extras.scaleRuler} onChange={(v) => setExtras({ ...extras, scaleRuler: v })} />
            <ExtraCheck label="안내 문구" hint="“실제 크기(100%)로 인쇄” 문구" checked={extras.notice} onChange={(v) => setExtras({ ...extras, notice: v })} />
          </fieldset>
        </div>

        <div className={styles.previewPane}>
          <div className={styles.previewHeader}>
            <strong className="t-h2">
              {selected.sheetLabel} {orientationLabel(selected.orientation)} · {selected.sheets}장
            </strong>
            {selected.curveCrossings > 0 && (
              <span className={styles.crossingNotice}>
                <AlertTriangle size={14} />
                곡선이 이음매를 지나는 곳 {selected.curveCrossings}
              </span>
            )}
          </div>
          <PlanPreview plan={selected} cols={doc.board.cols} rows={doc.board.rows} thumbnail={thumbnail} />
          <p className={`${styles.previewNote} t-caption`}>
            {multi ? '파선이 종이 이음매예요. 칸 크기는 실제 50mm 그대로 인쇄됩니다.' : '칸 크기는 실제 50mm 그대로 인쇄됩니다.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
