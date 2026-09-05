// 격자 좌표 계산 헬퍼 (도구 동작 전용).
//
// viewport.ts는 "화면 픽셀 ↔ mm" 순수 변환만 담당합니다. 이 파일은 그렇게 구한 mm 값을
// 가지고 "몇 번째 칸인지", "어느 격자 노드에 가장 가까운지", "두 노드가 이어져 있는지"
// 같은 격자 전용 계산을 담당합니다. 도구 동작(toolInteractions.ts)이 이 계산에 크게
// 의존하므로, viewport.ts와 분리해서 이 파일만 보면 "좌표 → 칸/노드/엣지" 로직을
// 한눈에 알 수 있게 했습니다.
import type { Edges, NodeCoord } from '@/lib/model/types'

/** 격자 칸 하나의 (열, 행) 인덱스. */
export interface CellCoord {
  c: number
  r: number
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * mm 좌표가 어느 칸 위에 있는지 계산합니다. 격자 범위를 벗어나면 null.
 *
 * [계산 근거] 칸 (c,r)은 mm 범위 [c·pitch, (c+1)·pitch) × [r·pitch, (r+1)·pitch)를
 * 차지합니다(§5 D2의 칸 중심 공식을 뒤집으면 칸의 시작 경계가 c·pitch임을 알 수 있음).
 * 그래서 mm을 pitch로 나눈 정수 몫(버림)이 그대로 칸 인덱스입니다.
 */
export function cellAtMm(mx: number, my: number, cols: number, rows: number, pitch: number): CellCoord | null {
  const c = Math.floor(mx / pitch)
  const r = Math.floor(my / pitch)
  if (c < 0 || c >= cols || r < 0 || r >= rows) return null
  return { c, r }
}

/** cellAtMm과 같은 계산이지만, 범위를 벗어나면 null 대신 가장 가까운 가장자리 칸으로
 *  당겨옵니다(clamp). 영역 채우기(R) 드래그가 캔버스 가장자리를 넘어가도 자연스럽게
 *  끝 칸까지 채워지도록 하기 위해 씁니다. */
export function clampCellAtMm(mx: number, my: number, cols: number, rows: number, pitch: number): CellCoord {
  const c = clamp(Math.floor(mx / pitch), 0, cols - 1)
  const r = clamp(Math.floor(my / pitch), 0, rows - 1)
  return { c, r }
}

/**
 * mm 좌표에서 가장 가까운 격자 노드(=칸 중심, D2)를 찾습니다. 범위를 벗어나면 가장자리
 * 노드로 당겨옵니다.
 *
 * [계산 근거] 노드 (c,r)의 중심 mm은 c·pitch + pitch/2 입니다(drawBoard.ts의 nodeCenterMm과
 * 같은 공식). 이 식을 c에 대해 풀면 c = mx/pitch − 0.5 이므로, 그 값을 반올림하면
 * "가장 가까운 노드의 c"가 나옵니다. 자를 대고 눈금 사이 어디쯤인지 재는 것과 같습니다.
 */
export function nearestNode(mx: number, my: number, cols: number, rows: number, pitch: number): NodeCoord {
  const c = clamp(Math.round(mx / pitch - 0.5), 0, cols - 1)
  const r = clamp(Math.round(my / pitch - 0.5), 0, rows - 1)
  return [c, r]
}

/** 두 노드가 대각선이 아니라 상하좌우로 바로 붙어있는지. L 도구 드래그가 "지나간 인접
 *  노드 쌍"만 엣지로 잇도록 판별하는 데 씁니다(대각선은 무시). */
export function areAdjacent(a: NodeCoord, b: NodeCoord): boolean {
  const dc = Math.abs(a[0] - b[0])
  const dr = Math.abs(a[1] - b[1])
  return (dc === 1 && dr === 0) || (dc === 0 && dr === 1)
}

/** 인접한 두 노드 사이의 엣지 종류(h/v)와 좌표를 구합니다. areAdjacent(a,b)가 true일
 *  때만 호출하세요(그렇지 않으면 결과가 의미 없습니다).
 *  D5: h[c,r]/v[c,r]는 항상 "더 작은 쪽" 좌표를 c/r로 기록합니다. */
export function edgeBetween(a: NodeCoord, b: NodeCoord): { kind: 'h' | 'v'; c: number; r: number } {
  if (a[1] === b[1]) return { kind: 'h', c: Math.min(a[0], b[0]), r: a[1] }
  return { kind: 'v', c: a[0], r: Math.min(a[1], b[1]) }
}

function hasCoord(list: NodeCoord[], c: number, r: number): boolean {
  return list.some(([lc, lr]) => lc === c && lr === r)
}

/** edges.h 또는 edges.v에 (c,r) 엣지가 존재하는지 확인합니다. */
export function edgeExists(edges: Edges, kind: 'h' | 'v', c: number, r: number): boolean {
  return hasCoord(kind === 'h' ? edges.h : edges.v, c, r)
}

/**
 * 엣지를 켜거나(on=true) 끕니다(on=false). 이미 원하는 상태면 배열을 새로 만들지 않고
 * 원본 edges 객체를 그대로 돌려줍니다 — 호출부(toolInteractions.ts)가 "정말 바뀐 게
 * 있는지"를 참조 비교(!==)만으로 바로 알 수 있게 하기 위한 의도적인 설계입니다.
 */
export function setEdge(edges: Edges, kind: 'h' | 'v', c: number, r: number, on: boolean): Edges {
  const list = kind === 'h' ? edges.h : edges.v
  const exists = hasCoord(list, c, r)
  if (exists === on) return edges
  const nextList = on ? [...list, [c, r] as NodeCoord] : list.filter(([lc, lr]) => !(lc === c && lr === r))
  return kind === 'h' ? { ...edges, h: nextList } : { ...edges, v: nextList }
}

/** 엣지 토글(있으면 끄고 없으면 켬). L 도구의 단순 클릭 동작(FR-2.2)에 씁니다. */
export function toggleEdge(edges: Edges, kind: 'h' | 'v', c: number, r: number): Edges {
  return setEdge(edges, kind, c, r, !edgeExists(edges, kind, c, r))
}

/**
 * 두 mm 점 사이를 최대 maxStepMm 간격으로 선형 보간합니다. 시작점(from)은 포함하지 않고
 * 끝점(to)은 항상 포함합니다 — 호출부가 "직전 위치는 이미 처리했다"고 가정하기 때문입니다.
 * 두 점이 완전히 같으면(마우스가 안 움직였으면) 빈 배열을 돌려줍니다.
 *
 * [왜 필요한가 — 드래그 보간] pointermove 이벤트는 마우스를 빠르게 움직이면 간격이
 * 듬성듬성 옵니다. 직전 위치와 지금 위치 사이의 거리가 셀 하나보다 크면 그 사이
 * 칸(또는 노드)을 하나도 거치지 않고 건너뛰어 버립니다 — 실제로 캔버스를 가로로
 * 빠르게 드래그했을 때 5칸 중 2번째 칸이 빠지는 결함으로 나타났습니다. 이 함수로 그
 * 구간을 촘촘하게 쪼개 순서대로 샘플을 만들면, 호출부가 각 샘플 지점마다 칸/노드
 * 처리를 해서 아무 것도 건너뛰지 않습니다.
 *
 * [간격을 pitch/2로 고르는 이유는 toolInteractions.ts 호출부 주석 참고]
 */
export function interpolateMmPoints(
  fromMx: number,
  fromMy: number,
  toMx: number,
  toMy: number,
  maxStepMm: number,
): { mx: number; my: number }[] {
  const dx = toMx - fromMx
  const dy = toMy - fromMy
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return []
  // 거리를 maxStepMm "이하" 간격으로 나누려면 최소 이만큼의 구간이 필요합니다.
  // 올림(ceil)을 써야 각 구간이 확실히 maxStepMm을 넘지 않습니다(내림이면 마지막
  // 구간 하나가 더 길어질 수 있음).
  const steps = Math.max(1, Math.ceil(dist / maxStepMm))
  const points: { mx: number; my: number }[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    points.push({ mx: fromMx + dx * t, my: fromMy + dy * t })
  }
  return points
}

/**
 * 클릭 지점(mm)에서 가장 가까운 엣지 하나를 찾습니다(L 도구 단순 클릭 토글용, FR-2.2).
 *
 * 이 앱이 다루는 격자는 A4 5×4(20칸)~A0 23×16(368칸) 수준이라, 존재 가능한 엣지 후보를
 * 전부 순회해 거리 제곱을 비교해도(최악의 경우에도 수백 번) 클릭 한 번마다 도는 계산으로는
 * 전혀 부담이 없습니다. 그래서 별도의 공간 인덱스 없이 이중 for문으로 충분합니다.
 */
export function nearestEdgeToPoint(
  mx: number,
  my: number,
  cols: number,
  rows: number,
  pitch: number,
): { kind: 'h' | 'v'; c: number; r: number } | null {
  let best: { kind: 'h' | 'v'; c: number; r: number } | null = null
  let bestDistSq = Infinity

  // 가로 엣지 h[c,r]: 노드 (c,r)~(c+1,r) 중점 = ((c+1)·pitch, r·pitch+pitch/2)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const midX = (c + 1) * pitch
      const midY = r * pitch + pitch / 2
      const d = (mx - midX) ** 2 + (my - midY) ** 2
      if (d < bestDistSq) {
        bestDistSq = d
        best = { kind: 'h', c, r }
      }
    }
  }
  // 세로 엣지 v[c,r]: 노드 (c,r)~(c,r+1) 중점 = (c·pitch+pitch/2, (r+1)·pitch)
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const midX = c * pitch + pitch / 2
      const midY = (r + 1) * pitch
      const d = (mx - midX) ** 2 + (my - midY) ** 2
      if (d < bestDistSq) {
        bestDistSq = d
        best = { kind: 'v', c, r }
      }
    }
  }
  return best
}
