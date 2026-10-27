// 종이 한 장 단위로 격자선·진입로를 채우거나 비웁니다(docs/09 §2.2).
//
// [왜 필요한가 — 2026-10-27 "격자선을 원하는 종이에만"]
// 예전 일괄 버튼은 맵 전체에만 동작해서, 종이를 여러 장 붙인 맵에서 한 장에만 격자를 깔 방법이
// 없었습니다. 종이 경계는 화면의 종이 파선·출력 계획기와 같은 계산(findPrintPlan)을 써야
// 화면에서 본 "1-2번 종이"와 실제로 채워지는 범위가 같습니다.
import type { Edges, MapDoc, NodeCoord, Stub } from './types'
import { setStub, stubExists } from './stubs'
import { edgeExists, setEdge } from '@/features/canvas/gridMath'
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

/**
 * 이 종이 네 변의 격자점에 진입로(반 칸 선)를 넣습니다(docs/10). 맵 바깥 테두리뿐 아니라 **이웃 종이와
 * 맞닿는 변**에도 넣어, 종이를 따로 쓰거나 이음매 쪽으로 선을 내보낼 수 있게 합니다. 이음매를 건너는
 * 온전한 격자선이 이미 있으면 그 자리는 이미 이어져 있으므로 넣지 않습니다.
 */
export function addSheetStubs(doc: MapDoc, region: SheetRegion): Stub[] {
  const { cols, rows } = doc.board
  const c0 = region.startCol
  const c1 = region.startCol + region.cols - 1
  const r0 = region.startRow
  const r1 = region.startRow + region.rows - 1
  let stubs = doc.stubs
  const add = (stub: Stub, crossing: { kind: 'h' | 'v'; c: number; r: number } | null) => {
    if (crossing && edgeExists(doc.edges, crossing.kind, crossing.c, crossing.r)) return
    stubs = setStub(stubs, stub, true)
  }
  for (let c = c0; c <= c1; c++) {
    add({ node: [c, r0], dir: 'N' }, r0 > 0 ? { kind: 'v', c, r: r0 - 1 } : null)
    add({ node: [c, r1], dir: 'S' }, r1 < rows - 1 ? { kind: 'v', c, r: r1 } : null)
  }
  for (let r = r0; r <= r1; r++) {
    add({ node: [c0, r], dir: 'W' }, c0 > 0 ? { kind: 'h', c: c0 - 1, r } : null)
    add({ node: [c1, r], dir: 'E' }, c1 < cols - 1 ? { kind: 'h', c: c1, r } : null)
  }
  return stubs
}

/** 종이 경계(이음매)가 지나는 칸 경계 번호. 세로 이음매는 열, 가로 이음매는 행 번호입니다. */
export function seamCuts(doc: MapDoc): { columns: Set<number>; rows: Set<number> } {
  const plan = findPrintPlan(doc)
  return { columns: new Set(plan?.columnCuts ?? []), rows: new Set(plan?.rowCuts ?? []) }
}

/** 이 격자선 토막이 종이 이음매를 건너는지. h(c,r)은 c+1열 경계, v(c,r)은 r+1행 경계를 지납니다. */
export function crossesSeam(doc: MapDoc, kind: 'h' | 'v', c: number, r: number): boolean {
  const cuts = seamCuts(doc)
  return kind === 'h' ? cuts.columns.has(c + 1) : cuts.rows.has(r + 1)
}

/**
 * 이음매를 건너는 토막의 **한쪽 절반**만 켜거나 끕니다(docs/10). 절반 = 그 종이 쪽 격자점에서
 * 이음매까지의 진입로. 두 절반이 다 켜지면 온전한 격자선 하나로 합치고, 하나라도 꺼지면 남은 쪽은
 * 진입로로 남깁니다. side 'a'는 왼쪽·위 격자점, 'b'는 오른쪽·아래 격자점 쪽 절반입니다.
 * on을 주지 않으면 지금 상태를 뒤집습니다.
 */
export function setSeamHalf(
  doc: MapDoc,
  kind: 'h' | 'v',
  c: number,
  r: number,
  side: 'a' | 'b',
  on?: boolean,
): Pick<MapDoc, 'edges' | 'stubs'> {
  const stubA: Stub = { node: [c, r], dir: kind === 'h' ? 'E' : 'S' }
  const stubB: Stub = { node: kind === 'h' ? [c + 1, r] : [c, r + 1], dir: kind === 'h' ? 'W' : 'N' }
  const full = edgeExists(doc.edges, kind, c, r)
  let halfA = full || stubExists(doc.stubs, stubA)
  let halfB = full || stubExists(doc.stubs, stubB)
  if (side === 'a') halfA = on ?? !halfA
  else halfB = on ?? !halfB
  const both = halfA && halfB
  return {
    edges: setEdge(doc.edges, kind, c, r, both),
    stubs: setStub(setStub(doc.stubs, stubA, halfA && !both), stubB, halfB && !both),
  }
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
