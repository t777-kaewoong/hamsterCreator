// 격자선 긋기(L) 도구가 "지금 누르면 어느 토막이 바뀌는지" 고르는 규칙 (docs/14 §2.5).
//
// [2026-11-11 후기 11차 — "격자선 긋기 사용법이 헷갈림"]
// 예전에는 클릭 대상이 "가장 가까운 격자선 토막의 **가운데 점**"으로 정해져서, 종이 가장자리의
// 진입로(반 칸 선)를 눌러도 엉뚱한 세로 토막이 바뀌었고, 진입로는 종이 **바깥**을 눌러야만 켜졌습니다.
// 이제는 화면에 실제로 그어지는(또는 그어질) 선분과 커서 사이의 거리로 고릅니다. 그래서
// "선이 있는(있을) 자리를 누르면 그 선이 바뀐다" 하나만 알면 됩니다. 바깥 클릭 진입로도 그대로 받습니다.
//
// 이 파일은 순수 계산만 합니다. 커서를 올렸을 때 미리 보여 주기(toolInteractions의 호버)와
// 실제 클릭 적용이 같은 함수를 써야, 보인 것과 바뀌는 것이 어긋나지 않습니다.
import type { MapDoc, Stub } from '@/lib/model/types'
import { setStub, stubExists, toggleStub } from '@/lib/model/stubs'
import { crossesSeam, setSeamHalf } from '@/lib/model/sheetLines'
import { edgeExists, setEdge, stubAtPoint, toggleEdge } from './gridMath'

export type LineTarget =
  | { type: 'edge'; kind: 'h' | 'v'; c: number; r: number }
  /** 종이 이음매를 건너는 토막의 한쪽 절반(docs/10). a = 왼쪽·위 격자점 쪽 */
  | { type: 'half'; kind: 'h' | 'v'; c: number; r: number; side: 'a' | 'b' }
  | { type: 'stub'; stub: Stub }

/** 선분에서 이만큼(칸 크기 비율) 안쪽을 누르면 그 선분으로 봅니다. 0.4 × 50mm = 20mm. */
const PICK_RATIO = 0.4

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

/** 격자점 (c, r)의 중심(mm). */
function node(c: number, r: number, pitch: number): [number, number] {
  return [c * pitch + pitch / 2, r * pitch + pitch / 2]
}

/** 진입로 선분: 격자점에서 그 방향으로 반 칸. */
function stubSegment(stub: Stub, pitch: number): [number, number, number, number] {
  const [x, y] = node(stub.node[0], stub.node[1], pitch)
  const half = pitch / 2
  if (stub.dir === 'W') return [x, y, x - half, y]
  if (stub.dir === 'E') return [x, y, x + half, y]
  if (stub.dir === 'N') return [x, y, x, y - half]
  return [x, y, x, y + half]
}

/** (mx, my)를 눌렀을 때 바뀔 토막. 아무 토막에도 가깝지 않으면 null. */
export function lineTargetAt(doc: MapDoc, mx: number, my: number): LineTarget | null {
  const { cols, rows, pitch } = doc.board
  const width = cols * pitch
  const height = rows * pitch
  // 종이 바깥 반 칸 안은 예전처럼 그 변의 진입로입니다.
  if (mx < 0 || my < 0 || mx > width || my > height) {
    const stub = stubAtPoint(mx, my, cols, rows, pitch)
    return stub ? { type: 'stub', stub } : null
  }

  let best: LineTarget | null = null
  let bestDist = pitch * PICK_RATIO
  const consider = (target: LineTarget, seg: [number, number, number, number]) => {
    const d = distToSegment(mx, my, ...seg)
    if (d < bestDist) {
      bestDist = d
      best = target
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const [x0, y0] = node(c, r, pitch)
      consider({ type: 'edge', kind: 'h', c, r }, [x0, y0, x0 + pitch, y0])
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const [x0, y0] = node(c, r, pitch)
      consider({ type: 'edge', kind: 'v', c, r }, [x0, y0, x0, y0 + pitch])
    }
  }
  // 종이 가장자리 진입로(격자점 → 종이 끝 반 칸)도 화면 안쪽에 그려지므로 후보입니다.
  for (let r = 0; r < rows; r++) {
    consider({ type: 'stub', stub: { node: [0, r], dir: 'W' } }, stubSegment({ node: [0, r], dir: 'W' }, pitch))
    consider({ type: 'stub', stub: { node: [cols - 1, r], dir: 'E' } }, stubSegment({ node: [cols - 1, r], dir: 'E' }, pitch))
  }
  for (let c = 0; c < cols; c++) {
    consider({ type: 'stub', stub: { node: [c, 0], dir: 'N' } }, stubSegment({ node: [c, 0], dir: 'N' }, pitch))
    consider({ type: 'stub', stub: { node: [c, rows - 1], dir: 'S' } }, stubSegment({ node: [c, rows - 1], dir: 'S' }, pitch))
  }

  const picked = best as LineTarget | null
  // 이음매를 건너는 토막은 누른 쪽 절반만 다룹니다(docs/10).
  if (picked && picked.type === 'edge' && crossesSeam(doc, picked.kind, picked.c, picked.r)) {
    const seamMm = (picked.kind === 'h' ? picked.c + 1 : picked.r + 1) * pitch
    const side = (picked.kind === 'h' ? mx : my) < seamMm ? 'a' : 'b'
    return { type: 'half', kind: picked.kind, c: picked.c, r: picked.r, side }
  }
  return picked
}

/** 그 토막이 지금 켜져 있는지. */
export function lineTargetExists(doc: MapDoc, target: LineTarget): boolean {
  if (target.type === 'edge') return edgeExists(doc.edges, target.kind, target.c, target.r)
  if (target.type === 'stub') return stubExists(doc.stubs, target.stub)
  if (edgeExists(doc.edges, target.kind, target.c, target.r)) return true
  const stub: Stub =
    target.side === 'a'
      ? { node: [target.c, target.r], dir: target.kind === 'h' ? 'E' : 'S' }
      : { node: target.kind === 'h' ? [target.c + 1, target.r] : [target.c, target.r + 1], dir: target.kind === 'h' ? 'W' : 'N' }
  return stubExists(doc.stubs, stub)
}

/** 화면에 미리 보여 줄 선분(mm). */
export function lineTargetSegment(doc: MapDoc, target: LineTarget): [number, number, number, number] {
  const { pitch } = doc.board
  if (target.type === 'stub') return stubSegment(target.stub, pitch)
  const [x0, y0] = node(target.c, target.r, pitch)
  const x1 = target.kind === 'h' ? x0 + pitch : x0
  const y1 = target.kind === 'h' ? y0 : y0 + pitch
  if (target.type === 'edge') return [x0, y0, x1, y1]
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  return target.side === 'a' ? [x0, y0, mx, my] : [mx, my, x1, y1]
}

/**
 * 누른 결과 문서. erase면 끄기만, 아니면 켜고 끄기를 뒤집습니다.
 * 바뀐 것이 없으면 같은 문서 객체를 돌려줍니다.
 */
export function applyLineTarget(doc: MapDoc, target: LineTarget, erase: boolean): MapDoc {
  if (target.type === 'edge') {
    const edges = erase ? setEdge(doc.edges, target.kind, target.c, target.r, false) : toggleEdge(doc.edges, target.kind, target.c, target.r)
    return edges === doc.edges ? doc : { ...doc, edges }
  }
  if (target.type === 'stub') {
    const stubs = erase ? setStub(doc.stubs, target.stub, false) : toggleStub(doc.stubs, target.stub)
    return stubs === doc.stubs ? doc : { ...doc, stubs }
  }
  if (erase && !lineTargetExists(doc, target)) return doc
  return { ...doc, ...setSeamHalf(doc, target.kind, target.c, target.r, target.side, erase ? false : undefined) }
}
