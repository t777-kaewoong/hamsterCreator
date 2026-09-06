import { sampleStroke } from '@/features/canvas/strokeGeometry'
import { PAPER_SIZES } from '@/lib/model/constants'
import type { MapDoc, Point, Stroke } from '@/lib/model/types'

export type PrintPlanSort = 'sheets' | 'seams' | 'waste'

export interface TileRegion {
  index: number
  row: number
  column: number
  startCol: number
  startRow: number
  cols: number
  rows: number
}

export interface PrintPlanOption {
  id: string
  sheet: string
  sheetLabel: string
  orientation: 'portrait' | 'landscape'
  pageWidthMm: number
  pageHeightMm: number
  capacityCols: number
  capacityRows: number
  tilesX: number
  tilesY: number
  sheets: number
  seams: number
  wasteCells: number
  curveCrossings: number
  columnCuts: number[]
  rowCuts: number[]
  regions: TileRegion[]
}

interface PartitionResult {
  cuts: number[]
  cost: number
}

function prefersLaterCuts(candidate: number[], previous: number[]): boolean {
  for (let index = 0; index < Math.min(candidate.length, previous.length); index++) {
    if (candidate[index] !== previous[index]) return candidate[index] > previous[index]
  }
  return candidate.length > previous.length
}

function segmentCrossesVertical(points: Point[], x: number): boolean {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]
    const b = points[index]
    if ((a[0] < x && b[0] >= x) || (b[0] < x && a[0] >= x)) return true
  }
  return false
}

function segmentCrossesHorizontal(points: Point[], y: number): boolean {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]
    const b = points[index]
    if ((a[1] < y && b[1] >= y) || (b[1] < y && a[1] >= y)) return true
  }
  return false
}

function seamCost(strokes: Stroke[], axis: 'x' | 'y', positionMm: number): number {
  let crossings = 0
  for (const stroke of strokes) {
    const points = sampleStroke(stroke)
    if (axis === 'x' ? segmentCrossesVertical(points, positionMm) : segmentCrossesHorizontal(points, positionMm)) {
      crossings += 1
    }
  }
  return crossings
}

/**
 * 지정한 시트 수를 유지하면서 가능한 모든 셀 경계 중 곡선 교차가 가장 적은 분할을 찾습니다.
 * 조각 수는 ceil(total/capacity)로 고정하므로 곡선을 피하려고 용지를 더 쓰지는 않습니다.
 */
function bestPartition(
  totalCells: number,
  capacity: number,
  crossingCost: (cutCell: number) => number,
): PartitionResult {
  const pieces = Math.max(1, Math.ceil(totalCells / capacity))
  if (pieces === 1) return { cuts: [], cost: 0 }

  type State = { cost: number; cuts: number[] }
  let states = new Map<number, State>([[0, { cost: 0, cuts: [] }]])

  for (let piece = 1; piece <= pieces; piece++) {
    const next = new Map<number, State>()
    for (const [start, state] of states) {
      const remainingPieces = pieces - piece
      const minEnd = start + 1
      const maxEnd = Math.min(totalCells, start + capacity)
      for (let end = minEnd; end <= maxEnd; end++) {
        const remaining = totalCells - end
        if (remaining < remainingPieces || remaining > remainingPieces * capacity) continue
        const isFinal = end === totalCells
        const cost = state.cost + (isFinal ? 0 : crossingCost(end))
        const cuts = isFinal ? state.cuts : [...state.cuts, end]
        const previous = next.get(end)
        if (!previous || cost < previous.cost || (cost === previous.cost && prefersLaterCuts(cuts, previous.cuts))) {
          next.set(end, { cost, cuts })
        }
      }
    }
    states = next
  }

  return states.get(totalCells) ?? { cuts: [], cost: Number.POSITIVE_INFINITY }
}

function spans(total: number, cuts: number[]): Array<{ start: number; size: number }> {
  const boundaries = [0, ...cuts, total]
  return boundaries.slice(0, -1).map((start, index) => ({ start, size: boundaries[index + 1] - start }))
}

function buildRegions(cols: number, rows: number, columnCuts: number[], rowCuts: number[]): TileRegion[] {
  const columnSpans = spans(cols, columnCuts)
  const rowSpans = spans(rows, rowCuts)
  const regions: TileRegion[] = []
  for (let row = 0; row < rowSpans.length; row++) {
    for (let column = 0; column < columnSpans.length; column++) {
      const x = columnSpans[column]
      const y = rowSpans[row]
      regions.push({
        index: regions.length + 1,
        row,
        column,
        startCol: x.start,
        startRow: y.start,
        cols: x.size,
        rows: y.size,
      })
    }
  }
  return regions
}

export function createPrintPlanOptions(doc: MapDoc, sort: PrintPlanSort = 'sheets'): PrintPlanOption[] {
  const { cols, rows, pitch } = doc.board
  const options: PrintPlanOption[] = []

  for (const paper of PAPER_SIZES) {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const pageWidthMm = orientation === 'landscape' ? paper.widthMm : paper.heightMm
      const pageHeightMm = orientation === 'landscape' ? paper.heightMm : paper.widthMm
      const capacityCols = Math.floor(pageWidthMm / pitch)
      const capacityRows = Math.floor(pageHeightMm / pitch)
      if (capacityCols < 1 || capacityRows < 1) continue

      const columnPlan = bestPartition(cols, capacityCols, (cut) => seamCost(doc.strokes, 'x', cut * pitch))
      const rowPlan = bestPartition(rows, capacityRows, (cut) => seamCost(doc.strokes, 'y', cut * pitch))
      const tilesX = columnPlan.cuts.length + 1
      const tilesY = rowPlan.cuts.length + 1
      const sheets = tilesX * tilesY
      const seams = (tilesX - 1) * tilesY + (tilesY - 1) * tilesX
      const wasteCells = sheets * capacityCols * capacityRows - cols * rows

      options.push({
        id: `${paper.id}-${orientation}`,
        sheet: paper.id,
        sheetLabel: paper.label,
        orientation,
        pageWidthMm,
        pageHeightMm,
        capacityCols,
        capacityRows,
        tilesX,
        tilesY,
        sheets,
        seams,
        wasteCells,
        curveCrossings: columnPlan.cost + rowPlan.cost,
        columnCuts: columnPlan.cuts,
        rowCuts: rowPlan.cuts,
        regions: buildRegions(cols, rows, columnPlan.cuts, rowPlan.cuts),
      })
    }
  }

  const metric = (option: PrintPlanOption) => {
    if (sort === 'seams') return option.seams
    if (sort === 'waste') return option.wasteCells
    return option.sheets
  }

  return options.sort((a, b) =>
    Number(a.curveCrossings > 0) - Number(b.curveCrossings > 0)
    || metric(a) - metric(b)
    || a.sheets - b.sheets
    || a.seams - b.seams
    || a.wasteCells - b.wasteCells
    || a.sheet.localeCompare(b.sheet)
    || a.orientation.localeCompare(b.orientation),
  )
}

export function findPrintPlan(doc: MapDoc): PrintPlanOption | null {
  const options = createPrintPlanOptions(doc, 'sheets')
  return options.find((option) => option.sheet === doc.print.sheet && option.orientation === doc.print.orientation) ?? null
}
