// 지우개(E) 도구가 "커서 아래에서 무엇을 지울지" 고르는 규칙 (2026-09-29, docs/05 §3.3).
//
// [왜 새로 만들었는가 — 후기 "지우개 사용하기가 어렵다"]
// 예전 지우개는 칸 타일만 지웠고, 격자선은 Alt를 누른 채 **노드에서 노드로** 끌어야
// 지워졌습니다. 한 칸의 + 모양을 ㅏ 모양으로 바꾸려면(왼쪽 팔 하나만 지우기) Alt를
// 알아야 하고, 끄는 방향도 정확해야 했습니다. 곡선·글자·자유 배치 그림은 아예 못 지웠습니다.
//
// 이제 규칙은 하나입니다: **눈에 보이는 것 중 맨 위에 있는 것을 지운다.**
//   글자 → 자유 배치 그림 → 칸 타일 → 격자선 한 토막 → 곡선 → 경계 진입로
// 이 순서는 화면에 그려지는 순서(drawBoard.ts)를 거꾸로 따른 것입니다.
//
// 격자선 한 토막 = 이웃한 두 노드 사이 선(데이터 모델의 edge). + 모양의 왼쪽 팔을 누르면
// 그 노드와 왼쪽 노드 사이 선이 지워져 ㅏ가 됩니다.
//
// 끌어서 지울 때는 **처음 누른 것과 같은 종류만** 지웁니다. 선을 따라 문지르다가 옆 타일까지
// 지워지면 오히려 불편하기 때문입니다. 빈 곳에서 시작하면 종류를 가리지 않습니다.
import type { Direction, MapDoc, Stub } from '@/lib/model/types'
import { setStub, stubExists } from '@/lib/model/stubs'
import { edgeExists, setEdge, stubAtPoint } from './gridMath'
import { hitTest } from './hitTest'
import { distanceToStroke } from './strokeGeometry'

export type EraseTarget =
  | { kind: 'label'; index: number }
  | { kind: 'prop'; index: number }
  | { kind: 'cell'; index: number }
  | { kind: 'edge'; edge: 'h' | 'v'; c: number; r: number }
  | { kind: 'stroke'; id: string }
  | { kind: 'stub'; stub: Stub }

/** 끌어서 지울 때 묶는 종류. 'any'는 가리지 않음. */
export type EraseGroup = 'object' | 'line' | 'curve' | 'any'

export function eraseGroupOf(target: EraseTarget): Exclude<EraseGroup, 'any'> {
  if (target.kind === 'edge' || target.kind === 'stub') return 'line'
  if (target.kind === 'stroke') return 'curve'
  return 'object'
}

/** 선을 "누른 것"으로 볼 여유(mm). 선 굵기 절반 바깥으로 이만큼 더 봐 줍니다.
 *  축소 화면에서 8mm 선의 정중앙만 누르게 하면 사실상 맞히기 어렵습니다. */
const LINE_HIT_SLACK_MM = 4

/**
 * 점에서 가장 가까운 격자선 토막(존재 여부는 보지 않음).
 * 가장 가까운 노드를 기준으로, 가로로 더 벗어났으면 그쪽 가로 토막, 세로로 더 벗어났으면
 * 세로 토막을 고릅니다. 그래서 + 의 오른쪽 팔을 누르면 항상 오른쪽 토막이 잡힙니다.
 */
function edgeNearPoint(doc: MapDoc, mx: number, my: number): { edge: 'h' | 'v'; c: number; r: number; offMm: number } | null {
  const { cols, rows, pitch, lineWidth } = doc.board
  const c0 = Math.min(cols - 1, Math.max(0, Math.round((mx - pitch / 2) / pitch)))
  const r0 = Math.min(rows - 1, Math.max(0, Math.round((my - pitch / 2) / pitch)))
  const dx = mx - (c0 * pitch + pitch / 2)
  const dy = my - (r0 * pitch + pitch / 2)
  const reach = lineWidth / 2 + LINE_HIT_SLACK_MM
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (Math.abs(dy) > reach) return null
    const c = dx < 0 ? c0 - 1 : c0
    if (c < 0 || c > cols - 2) return null
    return { edge: 'h', c, r: r0, offMm: Math.abs(dy) }
  }
  if (Math.abs(dx) > reach) return null
  const r = dy < 0 ? r0 - 1 : r0
  if (r < 0 || r > rows - 2) return null
  return { edge: 'v', c: c0, r, offMm: Math.abs(dx) }
}

/** 점 아래에서 지울 대상을 찾습니다. group을 주면 그 종류 안에서만 찾습니다. */
export function findEraseTarget(doc: MapDoc, mx: number, my: number, group: EraseGroup = 'any'): EraseTarget | null {
  const allow = (g: Exclude<EraseGroup, 'any'>) => group === 'any' || group === g

  if (allow('object')) {
    const hit = hitTest(doc, mx, my)
    if (hit && (hit.kind === 'label' || hit.kind === 'prop' || hit.kind === 'cell')) return hit
  }

  if (allow('line')) {
    const near = edgeNearPoint(doc, mx, my)
    if (near && edgeExists(doc.edges, near.edge, near.c, near.r)) return { kind: 'edge', edge: near.edge, c: near.c, r: near.r }
  }

  if (allow('curve')) {
    for (let i = doc.strokes.length - 1; i >= 0; i--) {
      const stroke = doc.strokes[i]
      if (distanceToStroke(stroke, [mx, my]) <= stroke.width / 2 + LINE_HIT_SLACK_MM / 2) return { kind: 'stroke', id: stroke.id }
    }
  }

  if (allow('line')) {
    const stub = stubAtPoint(mx, my, doc.board.cols, doc.board.rows, doc.board.pitch)
    if (stub && stubExists(doc.stubs, stub)) return { kind: 'stub', stub }
  }

  return null
}

/** 대상을 지운 새 문서. 이미 없으면 원래 문서를 그대로 돌려줍니다. */
export function applyErase(doc: MapDoc, target: EraseTarget): MapDoc {
  switch (target.kind) {
    case 'label':
      return { ...doc, labels: doc.labels.filter((_, i) => i !== target.index) }
    case 'prop':
      return { ...doc, props: doc.props.filter((_, i) => i !== target.index) }
    case 'cell': {
      if (doc.cells[target.index] === null) return doc
      const cells = doc.cells.slice()
      cells[target.index] = null
      return { ...doc, cells }
    }
    case 'edge': {
      const edges = setEdge(doc.edges, target.edge, target.c, target.r, false)
      return edges === doc.edges ? doc : { ...doc, edges }
    }
    case 'stroke':
      return { ...doc, strokes: doc.strokes.filter((s) => s.id !== target.id) }
    case 'stub': {
      const stubs = setStub(doc.stubs, target.stub, false)
      return stubs === doc.stubs ? doc : { ...doc, stubs }
    }
  }
}

/** 진입로가 노드에서 뻗는 방향의 단위 벡터(화면 강조용). */
export function stubVector(dir: Direction): [number, number] {
  if (dir === 'N') return [0, -1]
  if (dir === 'S') return [0, 1]
  if (dir === 'W') return [-1, 0]
  return [1, 0]
}
