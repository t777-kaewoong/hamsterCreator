// 종이 한 장 단위로 격자선·진입로를 채우거나 비웁니다(docs/09 §2.2).
//
// [왜 필요한가 — 2026-10-27 "격자선을 원하는 종이에만"]
// 예전 일괄 버튼은 맵 전체에만 동작해서, 종이를 여러 장 붙인 맵에서 한 장에만 격자를 깔 방법이
// 없었습니다. 종이 경계는 화면의 종이 파선·출력 계획기와 같은 계산(findPrintPlan)을 써야
// 화면에서 본 "1-2번 종이"와 실제로 채워지는 범위가 같습니다.
import type { Edges, MapDoc, NodeCoord, Stub } from './types'
import { allBoundaryStubs, setStub } from './stubs'
import { findPrintPlan } from '@/lib/print/plan'

export interface SheetRegion {
  /** 화면·PDF와 같은 "행-열" 번호(1-1, 1-2 …) */
  code: string
  row: number
  column: number
  startCol: number
  startRow: number
  cols: number
  rows: number
}

/** 지금 맵의 종이 목록. 계획을 못 세우면 맵 전체를 한 장으로 봅니다. */
export function sheetRegions(doc: MapDoc): { regions: SheetRegion[]; tilesX: number; tilesY: number } {
  const plan = findPrintPlan(doc)
  if (!plan) {
    return {
      regions: [{ code: '1-1', row: 0, column: 0, startCol: 0, startRow: 0, cols: doc.board.cols, rows: doc.board.rows }],
      tilesX: 1,
      tilesY: 1,
    }
  }
  return {
    regions: plan.regions.map((region) => ({ ...region, code: `${region.row + 1}-${region.column + 1}` })),
    tilesX: plan.tilesX,
    tilesY: plan.tilesY,
  }
}

function inside(region: SheetRegion, c: number, r: number): boolean {
  return c >= region.startCol && c < region.startCol + region.cols && r >= region.startRow && r < region.startRow + region.rows
}

function key(c: number, r: number): string {
  return `${c},${r}`
}

/**
 * 종이 안 격자점끼리 모두 잇습니다. 이웃 종이 쪽 격자점에 이미 선이 있으면 이음매를 건너 그 점과도
 * 이어서, 종이 경계에서 선이 끊기지 않게 합니다(이웃이 비어 있으면 잇지 않음).
 */
export function fillSheetEdges(doc: MapDoc, region: SheetRegion): Edges {
  const { cols, rows } = doc.board
  const h = new Set(doc.edges.h.map(([c, r]) => key(c, r)))
  const v = new Set(doc.edges.v.map(([c, r]) => key(c, r)))
  const linked = new Set<string>()
  for (const [c, r] of doc.edges.h) linked.add(key(c, r)).add(key(c + 1, r))
  for (const [c, r] of doc.edges.v) linked.add(key(c, r)).add(key(c, r + 1))

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 가로 c,r ↔ c+1,r
      if (c + 1 < cols) {
        const a = inside(region, c, r)
        const b = inside(region, c + 1, r)
        if ((a && b) || (a && linked.has(key(c + 1, r))) || (b && linked.has(key(c, r)))) h.add(key(c, r))
      }
      // 세로 c,r ↔ c,r+1
      if (r + 1 < rows) {
        const a = inside(region, c, r)
        const b = inside(region, c, r + 1)
        if ((a && b) || (a && linked.has(key(c, r + 1))) || (b && linked.has(key(c, r)))) v.add(key(c, r))
      }
    }
  }
  const toCoords = (set: Set<string>): NodeCoord[] => [...set].map((k) => k.split(',').map(Number) as NodeCoord)
  return { h: toCoords(h), v: toCoords(v) }
}

/** 이 종이에 걸친 맵 바깥 경계 격자점에 진입로를 넣습니다(이미 있는 것은 그대로). */
export function addSheetStubs(doc: MapDoc, region: SheetRegion): Stub[] {
  let stubs = doc.stubs
  for (const stub of allBoundaryStubs(doc.board.cols, doc.board.rows)) {
    if (inside(region, stub.node[0], stub.node[1])) stubs = setStub(stubs, stub, true)
  }
  return stubs
}

/** 이 종이 안 격자점에 닿는 선(이음매를 건너는 선 포함)과 진입로를 모두 지웁니다. */
export function clearSheet(doc: MapDoc, region: SheetRegion): Pick<MapDoc, 'edges' | 'stubs'> {
  return {
    edges: {
      h: doc.edges.h.filter(([c, r]) => !inside(region, c, r) && !inside(region, c + 1, r)),
      v: doc.edges.v.filter(([c, r]) => !inside(region, c, r) && !inside(region, c, r + 1)),
    },
    stubs: doc.stubs.filter((stub) => !inside(region, stub.node[0], stub.node[1])),
  }
}
