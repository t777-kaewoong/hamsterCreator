// 용지 한 장이 담을 수 있는 칸 수 계산.
//
// 출력 계획기(plan.ts)와 캔버스의 "종이 붙이기" 버튼, 인쇄 버튼이 모두 같은 기준을 써야
// 화면에서 본 종이 경계와 실제 PDF가 어긋나지 않습니다. 그래서 한곳에 모았습니다.
import { PAPER_SIZES } from '@/lib/model/constants'
import type { MapDoc } from '@/lib/model/types'

export interface SheetCapacity {
  /** 한 장에 들어가는 가로 칸 수. A4 가로 = 5 */
  cols: number
  /** 한 장에 들어가는 세로 칸 수. A4 가로 = 4 */
  rows: number
}

/**
 * 지금 문서의 용지·방향으로 한 장에 들어가는 칸 수.
 * 용지 폭을 칸 크기로 나눠 내림합니다(A4 가로 297mm ÷ 50mm = 5칸).
 * 목록에 없는 용지면 A4로 봅니다 — 버튼이 아예 동작하지 않는 것보다 낫기 때문입니다.
 */
export function sheetCapacity(doc: MapDoc): SheetCapacity {
  const paper = PAPER_SIZES.find((p) => p.id === doc.print.sheet) ?? PAPER_SIZES[0]
  const landscape = doc.print.orientation === 'landscape'
  const widthMm = landscape ? paper.widthMm : paper.heightMm
  const heightMm = landscape ? paper.heightMm : paper.widthMm
  return {
    cols: Math.max(1, Math.floor(widthMm / doc.board.pitch)),
    rows: Math.max(1, Math.floor(heightMm / doc.board.pitch)),
  }
}

/** 맵 전체가 지금 용지 한 장에 실물 크기로 들어가는지. */
export function fitsOneSheet(doc: MapDoc): boolean {
  const cap = sheetCapacity(doc)
  return doc.board.cols <= cap.cols && doc.board.rows <= cap.rows
}

/**
 * print.layout을 맵 크기에 맞게 자동으로 맞춘 문서를 돌려줍니다.
 *
 * [왜 사용자가 고르지 않게 했는가 — 2026-09-28 후기 반영]
 * "단일장/나눠 인쇄"는 사실 맵 크기와 용지로 정해지는 값입니다. 예전에는 사용자가 골라야
 * 했고, 단일장인데 맵이 용지보다 크면 인쇄 버튼이 오류로 끝났습니다. 값 자체는 파일
 * 호환을 위해 계속 저장하지만, 크기가 바뀔 때마다 여기서 다시 맞춥니다.
 */
export function withAutoLayout(doc: MapDoc): MapDoc {
  const layout = fitsOneSheet(doc) ? 'single' : 'tiled'
  if (doc.print.layout === layout) return doc
  return { ...doc, print: { ...doc.print, layout } }
}
