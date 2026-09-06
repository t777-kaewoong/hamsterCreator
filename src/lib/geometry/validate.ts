// 말판 검증 (PRD FR-9).
//
// [이 파일이 지키는 대원칙 — FR-9.6 "경고는 차단하지 않는다"]
// 여기 있는 함수들은 무엇이 잘못됐는지 "알려주기만" 합니다. 배치를 막거나, 문서를
// 자동으로 고치거나, 저장을 거부하지 않습니다. 수업 자료를 만들다 보면 일부러 규격을
// 벗어나는 경우(예: 일부러 끊어 놓은 길, 특수한 크기의 종이)가 있는데, 그때마다 앱이
// 막아서면 쓸 수 없는 도구가 됩니다. 그래서 검증 결과는 인스펙터 "검증" 섹션(§9.13)에
// 목록으로 보여줄 뿐이고, 무엇을 할지는 항상 교사가 정합니다.
//
// [순수 함수로 두는 이유]
// 이 파일은 React·캔버스·스토어를 전혀 모릅니다. MapDoc 하나를 받아 Issue 배열을
// 돌려줄 뿐이라, 나중에 시험 코드를 붙이거나 PDF 만들기 직전 검사에 재사용하기 쉽습니다.

import type { MapDoc, NodeCoord, Point, Stroke } from '@/lib/model/types'
import { LINE_WIDTH_MM, MIN_CURVE_RADIUS_MM, PITCH_MM, ROBOT_WIDTH_MM } from '@/lib/model/constants'
import { sampleStroke } from '@/features/canvas/strokeGeometry'

/** 문제의 심각도. §9.13이 좌측 색 막대를 오류/경고 두 가지로 구분합니다.
 *  - error: 이대로 인쇄하면 수업에서 실제로 문제가 되는 것(예: 로봇이 갈 수 없는 칸)
 *  - warn: 의도한 것일 수도 있으나 확인해 보는 게 좋은 것(예: 규격을 벗어난 선 굵기) */
export type IssueSeverity = 'error' | 'warn'

/** 검증 결과 한 건. */
export interface Issue {
  /** 같은 종류의 문제를 구분하는 코드. 화면 문구가 바뀌어도 이 값은 그대로 두세요
   *  (나중에 "이 경고는 다시 보지 않기" 같은 기능을 붙일 때 기준이 됩니다) */
  code:
    | 'unreachable'
    | 'pitch-off-spec'
    | 'line-width-off-spec'
    | 'no-start'
    | 'prop-covers-line'
    | 'curve-radius-too-small'
    | 'parallel-tracks-too-close'
  severity: IssueSeverity
  /** §9.13: 본문 caption 2줄까지. 한 문장으로, 무엇이 문제인지 바로 알 수 있게 씁니다 */
  message: string
  /** 이 문제가 일어난 격자 노드. 있으면 §9.13의 "클릭하면 해당 위치로 캔버스를 이동"에 씁니다.
   *  맵 전체에 해당하는 문제(규격 이탈 등)는 undefined */
  at?: NodeCoord
}

/**
 * 격자를 노드·엣지 그래프로 보고, 어느 노드에서 어느 노드로 갈 수 있는지 훑습니다.
 *
 * [왜 그래프인가] 셀 (c,r)의 중심이 곧 격자 노드이고(types.ts D2), edges에 기록된
 * 것만 실제로 이어진 길입니다(D5). 즉 말판은 그 자체로 그래프라서, 너비 우선 탐색(BFS)
 * 한 번이면 "출발점에서 갈 수 있는 칸"이 전부 나옵니다. 나중에 정답 코드 생성(FR-8,
 * board_forward() 나열)도 같은 그래프에서 최단 경로를 찾는 일이라 이 함수를 재사용합니다.
 *
 * @param from 탐색을 시작할 노드
 * @returns 그 노드에서 도달할 수 있는 모든 노드의 "c,r" 문자열 집합
 */
export function reachableNodes(doc: MapDoc, from: NodeCoord): Set<string> {
  const { cols, rows } = doc.board
  const key = (c: number, r: number) => `${c},${r}`

  // edges 배열을 매번 훑으면 느리므로(칸이 많은 A0 맵은 368칸) 먼저 집합으로 바꿔 둡니다.
  const hSet = new Set(doc.edges.h.map(([c, r]) => key(c, r)))
  const vSet = new Set(doc.edges.v.map(([c, r]) => key(c, r)))

  const seen = new Set<string>()
  const queue: NodeCoord[] = []

  const [fc, fr] = from
  if (fc < 0 || fc >= cols || fr < 0 || fr >= rows) return seen // 맵 밖에서 시작하면 갈 곳이 없음
  seen.add(key(fc, fr))
  queue.push(from)

  while (queue.length > 0) {
    const [c, r] = queue.shift()!

    // 네 방향 각각, "그 방향으로 나가는 선이 실제로 있는지"를 edges에서 확인합니다.
    // h의 [c,r]은 (c,r)~(c+1,r) 가로 연결, v의 [c,r]은 (c,r)~(c,r+1) 세로 연결입니다.
    const neighbors: NodeCoord[] = []
    if (hSet.has(key(c, r)) && c + 1 < cols) neighbors.push([c + 1, r]) // 동
    if (hSet.has(key(c - 1, r)) && c - 1 >= 0) neighbors.push([c - 1, r]) // 서
    if (vSet.has(key(c, r)) && r + 1 < rows) neighbors.push([c, r + 1]) // 남
    if (vSet.has(key(c, r - 1)) && r - 1 >= 0) neighbors.push([c, r - 1]) // 북

    for (const n of neighbors) {
      const k = key(n[0], n[1])
      if (seen.has(k)) continue
      seen.add(k)
      queue.push(n)
    }
  }

  return seen
}

/** ①·④ 검사에서 개별 Issue로 나열하는 최대 건수.
 *
 * [왜 자르는가] §9.13 검증 목록 항목은 한 건당 최소 44px입니다. 엣지를 몇 개만 그린
 * 상태에서 도달 불가 검사를 돌리면 이론상 칸 수만큼(A0는 368개까지) 쏟아질 수 있는데,
 * 그 목록을 다 펼치면 인스펙터가 스크롤만 하다 끝나는 무용지물이 됩니다. 10건이면
 * 화면 한 번에 훑어볼 수 있는 양이면서, 정말 심각한 상태(대부분이 끊겨 있음)라는 것도
 * 충분히 전달되는 수준이라 임의로 정했습니다. 넘치는 만큼은 요약 Issue 한 건으로 뭉칩니다. */
const MAX_LISTED_ISSUES = 10

/**
 * FR-9.1 도달 불가 검사, 그리고 그 전제가 되는 "출발점이 있는가" 검사.
 *
 * 출발점이 없으면 no-start(warn) 한 건만 내고 끝냅니다. 비교 기준(출발점)이 없는데
 * "여기서 못 간다"고 말할 수 없고, 무엇보다 새로 만든 맵(출발점 미지정이 기본 상태)을
 * 열자마자 칸 수만큼 오류가 쏟아지면 검증 섹션 자체를 못 믿게 됩니다.
 */
function checkReachability(doc: MapDoc): Issue[] {
  const { start } = doc.markers
  if (start === null) {
    // error가 아니라 warn인 이유: 말판을 만드는 중에는 출발점을 아직 안 찍은 상태가
    // 정상입니다(완성 전 중간 산출물). 완성된 말판에서만 실제 문제가 되므로 차단 없이
    // "확인해 보라"는 수준인 warn이 맞습니다.
    return [{ code: 'no-start', severity: 'warn', message: '출발점이 없습니다. M 도구로 지정하세요' }]
  }

  const key = (c: number, r: number) => `${c},${r}`

  // "엣지가 하나 이상 붙은 노드"만 검사 대상으로 추립니다. 엣지가 하나도 안 붙은 외딴
  // 노드는 애초에 "길"이 아니므로 도달 불가를 신고할 이유가 없습니다(예: "빈 격자"
  // 프리셋은 엣지가 하나도 없는데, 그걸 20건의 오류로 신고하면 안 됨). Map으로 (문자열
  // 키 → 좌표)를 같이 들고 있어서 나중에 문자열을 다시 숫자로 쪼갤 필요가 없게 합니다.
  const nodesWithEdge = new Map<string, NodeCoord>()
  const markNode = (c: number, r: number) => nodesWithEdge.set(key(c, r), [c, r])
  for (const [c, r] of doc.edges.h) {
    markNode(c, r)
    markNode(c + 1, r)
  }
  for (const [c, r] of doc.edges.v) {
    markNode(c, r)
    markNode(c, r + 1)
  }

  const reachable = reachableNodes(doc, start.cell)

  const issues: Issue[] = []
  let unreachableCount = 0
  for (const [nodeKey, node] of nodesWithEdge) {
    if (reachable.has(nodeKey)) continue
    unreachableCount++
    if (issues.length < MAX_LISTED_ISSUES) {
      const [c, r] = node
      issues.push({
        code: 'unreachable',
        severity: 'error',
        // 내부 인덱스는 0부터 시작하지만 교사에게 "0열 0행"은 헷갈리므로, 사람이 세는
        // 방식대로 1을 더해서 보여줍니다.
        message: `출발점에서 갈 수 없는 칸입니다 (${c + 1}열 ${r + 1}행)`,
        at: node,
      })
    }
  }
  if (unreachableCount > MAX_LISTED_ISSUES) {
    issues.push({
      code: 'unreachable',
      severity: 'error',
      message: `갈 수 없는 칸이 ${unreachableCount - MAX_LISTED_ISSUES}개 더 있습니다`,
    })
  }
  return issues
}

/**
 * FR-9.3 규격 이탈 검사(D6). pitch·lineWidth가 로보메이션 공식 실측값과 다르면 경고합니다.
 *
 * 왜 이게 중요한가: 햄스터S 로봇 코드는 board_forward() 한 번 호출로 "정확히 한 칸"을
 * 가도록 만들어져 있는데, 그 한 칸의 실제 거리가 이 pitch 값을 전제로 합니다. 칸 크기나
 * 선 굵기가 달라지면 정품 말판·타일과 어긋나거나, 학생이 만든 코드가 화면에서만 맞고
 * 실제 인쇄물에서는 안 맞는 상황이 생깁니다. 다만 의도적으로 다르게 만드는 경우도 있어
 * 차단하지 않고 경고만 합니다(FR-9.6).
 */
function checkBoardSpec(doc: MapDoc): Issue[] {
  const issues: Issue[] = []
  if (doc.board.pitch !== PITCH_MM) {
    issues.push({
      code: 'pitch-off-spec',
      severity: 'warn',
      message: `칸 크기가 ${doc.board.pitch}mm입니다. 공식 말판은 ${PITCH_MM}mm입니다`,
    })
  }
  if (doc.board.lineWidth !== LINE_WIDTH_MM) {
    issues.push({
      code: 'line-width-off-spec',
      severity: 'warn',
      message: `선 굵기가 ${doc.board.lineWidth}mm입니다. 공식 말판은 ${LINE_WIDTH_MM}mm입니다`,
    })
  }
  return issues
}

/** 축에 나란한 직사각형(mm) 하나. 프롭·엣지 선 영역을 같은 모양으로 표현해 겹침 판정에 씁니다. */
interface AxisAlignedRect {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

function rectsOverlap(a: AxisAlignedRect, b: AxisAlignedRect): boolean {
  // 그냥 맞닿기만 한 경우(경계선이 같은 경우)는 "덮었다"고 보지 않으므로 <, > 를 씁니다.
  return a.xMin < b.xMax && a.xMax > b.xMin && a.yMin < b.yMax && a.yMax > b.yMin
}

/**
 * FR-9.2 프롭이 격자선을 덮음 검사.
 *
 * 왜 이게 중요한가: 햄스터S는 바닥의 검은 선을 광센서로 읽어 주행합니다. 자유 배치
 * 오브젝트(아이콘·이미지)가 그 선 위에 얹히면 인쇄물에서 선이 끊긴 것처럼 보여 로봇이
 * 실제로 선을 놓칠 수 있습니다 — 이 검사는 그 상황을 미리 알려주기 위한 것입니다.
 */
function checkPropsOverLines(doc: MapDoc): Issue[] {
  const { pitch, lineWidth } = doc.board
  const halfLine = lineWidth / 2

  // D2: 셀 (c,r) 중심의 mm 좌표.
  const nodeCenter = (c: number, r: number): [number, number] => [c * pitch + pitch / 2, r * pitch + pitch / 2]

  // 실제로 존재하는 엣지만 "선 영역"(폭 lineWidth 띠) 사각형으로 미리 한 번에 바꿔
  // 둡니다. 프롭 개수만큼 반복문을 돌 때마다 mm 좌표를 다시 계산하지 않기 위해서입니다
  // (reachableNodes가 edges를 Set으로 미리 바꿔두는 것과 같은 이유 — A0 맵은 엣지가
  // 최대 수백 개, 프롭도 여러 개일 수 있어 매번 다시 계산하면 낭비).
  const strips: (AxisAlignedRect & { from: NodeCoord })[] = []
  for (const [c, r] of doc.edges.h) {
    const [x1, y] = nodeCenter(c, r)
    const [x2] = nodeCenter(c + 1, r)
    strips.push({ xMin: x1, xMax: x2, yMin: y - halfLine, yMax: y + halfLine, from: [c, r] })
  }
  for (const [c, r] of doc.edges.v) {
    const [x, y1] = nodeCenter(c, r)
    const [, y2] = nodeCenter(c, r + 1)
    strips.push({ xMin: x - halfLine, xMax: x + halfLine, yMin: y1, yMax: y2, from: [c, r] })
  }

  const issues: Issue[] = []
  let coveredCount = 0
  for (const prop of doc.props) {
    // 요구사항: prop.rot(회전)은 무시하고 축 정렬 사각형으로만 판정합니다. 회전까지
    // 정확히 반영하려면 다각형 교차 계산이 필요한데, 이 검사는 배치를 막는 게 아니라
    // "혹시 덮였는지 확인해 보라"는 경고일 뿐이라(FR-9.6) 대략적인 판정으로 충분하다고
    // 판단했습니다.
    const propRect: AxisAlignedRect = {
      xMin: prop.x,
      xMax: prop.x + prop.w,
      yMin: prop.y,
      yMax: prop.y + prop.h,
    }

    // 프롭 하나가 여러 엣지에 걸쳐도 Issue는 한 건만 냅니다. at에는 그중 "첫 번째로
    // 겹친" 엣지(=strips 배열에서 먼저 나온 엣지, h가 v보다 먼저)의 시작 노드를 담습니다.
    const hit = strips.find((s) => rectsOverlap(propRect, s))
    if (!hit) continue

    coveredCount++
    if (issues.length < MAX_LISTED_ISSUES) {
      issues.push({
        code: 'prop-covers-line',
        severity: 'warn',
        message: '오브젝트가 검은 선을 덮고 있습니다. 로봇이 선을 놓칠 수 있습니다',
        at: hit.from,
      })
    }
  }
  if (coveredCount > MAX_LISTED_ISSUES) {
    issues.push({
      code: 'prop-covers-line',
      severity: 'warn',
      message: `선을 덮은 오브젝트가 ${coveredCount - MAX_LISTED_ISSUES}개 더 있습니다`,
    })
  }
  return issues
}

/** 자유곡선 경고 위치를 기존 격자 기반 포커스 요청에 연결할 가장 가까운 보드 노드로 바꿉니다. */
function nearestBoardNode(doc: MapDoc, point: Point): NodeCoord {
  const { cols, rows, pitch } = doc.board
  return [
    Math.max(0, Math.min(cols - 1, Math.round((point[0] - pitch / 2) / pitch))),
    Math.max(0, Math.min(rows - 1, Math.round((point[1] - pitch / 2) / pitch))),
  ]
}

function circumradius(a: Point, b: Point, c: Point): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1])
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1])
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1])
  const twiceArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6 || twiceArea < 1e-6) return Number.POSITIVE_INFINITY
  return (ab * bc * ca) / (2 * twiceArea)
}

function minimumStrokeRadius(stroke: Stroke): { radius: number; at: Point } | null {
  if (stroke.kind === 'line') return null
  if (stroke.kind === 'circle') return { radius: Math.abs(stroke.r), at: [stroke.cx + stroke.r, stroke.cy] }
  if (stroke.kind === 'ellipse') {
    const major = Math.max(Math.abs(stroke.rx), Math.abs(stroke.ry))
    const minor = Math.min(Math.abs(stroke.rx), Math.abs(stroke.ry))
    const radius = major > 0 ? (minor * minor) / major : 0
    const at: Point = Math.abs(stroke.rx) >= Math.abs(stroke.ry)
      ? [stroke.cx + stroke.rx, stroke.cy]
      : [stroke.cx, stroke.cy + stroke.ry]
    return { radius, at }
  }
  if (stroke.kind === 'roundedRect') {
    const radius = Math.max(0, Math.min(stroke.radius, Math.abs(stroke.w) / 2, Math.abs(stroke.h) / 2))
    return { radius, at: [stroke.cx + stroke.w / 2 - radius, stroke.cy - stroke.h / 2 + radius] }
  }

  const sampled = sampleStroke(stroke)
  let minimum = Number.POSITIVE_INFINITY
  let at: Point = sampled[0] ?? [0, 0]
  for (let i = 1; i < sampled.length - 1; i++) {
    const radius = circumradius(sampled[i - 1], sampled[i], sampled[i + 1])
    if (radius < minimum) {
      minimum = radius
      at = sampled[i]
    }
  }
  return Number.isFinite(minimum) ? { radius: minimum, at } : null
}

/** FR-10.8: 도형의 해석해와 스플라인 표본의 외접원 반경을 같은 50mm 기준으로 검사합니다. */
function checkMinimumCurveRadius(doc: MapDoc): Issue[] {
  const issues: Issue[] = []
  for (const stroke of doc.strokes) {
    const result = minimumStrokeRadius(stroke)
    if (!result || result.radius >= MIN_CURVE_RADIUS_MM) continue
    issues.push({
      code: 'curve-radius-too-small',
      severity: 'warn',
      message: `곡률 반경이 약 ${Math.max(0, Math.round(result.radius))}mm입니다. ${MIN_CURVE_RADIUS_MM}mm 이상을 권장합니다`,
      at: nearestBoardNode(doc, result.at),
    })
    if (issues.length >= MAX_LISTED_ISSUES) break
  }
  return issues
}

interface TrackSegment {
  a: Point
  b: Point
  width: number
  strokeId: string
  index: number
  count: number
  closed: boolean
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  if (length2 < 1e-9) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
}

function parallelGap(a: TrackSegment, b: TrackSegment): number | null {
  const adx = a.b[0] - a.a[0]
  const ady = a.b[1] - a.a[1]
  const bdx = b.b[0] - b.a[0]
  const bdy = b.b[1] - b.a[1]
  const aLength = Math.hypot(adx, ady)
  const bLength = Math.hypot(bdx, bdy)
  if (aLength < 0.5 || bLength < 0.5) return null
  const ux = adx / aLength
  const uy = ady / aLength
  const cosine = Math.abs((adx * bdx + ady * bdy) / (aLength * bLength))
  // 표본 곡선의 미세한 각도 흔들림은 같은 평행 구간으로 보되, 교차로는 제외합니다.
  if (cosine < Math.cos((10 * Math.PI) / 180)) return null
  const project = (point: Point) => point[0] * ux + point[1] * uy
  const aMin = Math.min(project(a.a), project(a.b))
  const aMax = Math.max(project(a.a), project(a.b))
  const bMin = Math.min(project(b.a), project(b.b))
  const bMax = Math.max(project(b.a), project(b.b))
  if (Math.min(aMax, bMax) - Math.max(aMin, bMin) < 5) return null
  const centerDistance = Math.min(
    pointSegmentDistance(a.a, b.a, b.b),
    pointSegmentDistance(a.b, b.a, b.b),
    pointSegmentDistance(b.a, a.a, a.b),
    pointSegmentDistance(b.b, a.a, a.b),
  )
  return centerDistance - a.width / 2 - b.width / 2
}

/** FR-10.9: 표본 구간끼리 10도 이내로 평행하고 5mm 이상 나란히 달리는 부분만 검사합니다. */
function checkParallelTrackSpacing(doc: MapDoc): Issue[] {
  const segments: TrackSegment[] = []
  for (const stroke of doc.strokes) {
    const sampled = sampleStroke(stroke)
    const count = Math.max(0, sampled.length - 1)
    const closed = stroke.kind === 'circle' || stroke.kind === 'ellipse' || stroke.kind === 'roundedRect' ||
      (stroke.kind === 'spline' && stroke.closed)
    for (let index = 0; index < count; index++) {
      segments.push({ a: sampled[index], b: sampled[index + 1], width: stroke.width, strokeId: stroke.id, index, count, closed })
    }
  }

  const issues: Issue[] = []
  const reportedPairs = new Set<string>()
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]
      if (a.strokeId === b.strokeId) {
        const difference = Math.abs(a.index - b.index)
        if (difference <= 2 || (a.closed && a.count - difference <= 2)) continue
      }
      const pairKey = a.strokeId <= b.strokeId ? `${a.strokeId}|${b.strokeId}` : `${b.strokeId}|${a.strokeId}`
      if (reportedPairs.has(pairKey)) continue
      const gap = parallelGap(a, b)
      if (gap === null || gap >= ROBOT_WIDTH_MM) continue
      reportedPairs.add(pairKey)
      const at: Point = [(a.a[0] + a.b[0] + b.a[0] + b.b[0]) / 4, (a.a[1] + a.b[1] + b.a[1] + b.b[1]) / 4]
      issues.push({
        code: 'parallel-tracks-too-close',
        severity: 'warn',
        message: `평행한 선 가장자리 간격이 약 ${Math.max(0, Math.round(gap))}mm입니다. ${ROBOT_WIDTH_MM}mm 이상 띄우세요`,
        at: nearestBoardNode(doc, at),
      })
      if (issues.length >= MAX_LISTED_ISSUES) return issues
    }
  }
  return issues
}

/**
 * 맵 전체를 검사해 문제 목록을 돌려줍니다(FR-9).
 *
 * 결과는 심각도 순(error 먼저)으로 정렬해서 돌려줍니다 — §9.13의 검증 목록이 위에서부터
 * 읽히므로, 정말 고쳐야 하는 것이 항상 맨 위에 오게 하기 위해서입니다.
 *
 * 문제가 하나도 없으면 빈 배열입니다(§9.13: 0건이면 "문제 없음"만 표시하고 접음).
 */
export function validateMap(doc: MapDoc): Issue[] {
  // 만들어지는 순서 = 도달 불가/출발점 → 규격 이탈 → 프롭이 선을 덮음. 아래 sort는
  // error를 앞으로 당기기만 하고, 같은 심각도 안에서는 이 순서를 그대로 유지합니다
  // (Array.prototype.sort는 ES2019부터 명세상 안정 정렬이 보장되므로, 즉 순위가 같은
  // 항목끼리는 원래 순서가 바뀌지 않습니다 — FR-9 요구사항의 "만들어진 순서 유지"의 근거).
  const issues: Issue[] = [
    ...checkReachability(doc),
    ...checkBoardSpec(doc),
    ...checkPropsOverLines(doc),
    ...checkMinimumCurveRadius(doc),
    ...checkParallelTrackSpacing(doc),
  ]

  const severityRank: Record<IssueSeverity, number> = { error: 0, warn: 1 }
  return issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
}
