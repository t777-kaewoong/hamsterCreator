// 자유곡선의 공용 기하 계산.
// 화면 렌더링·히트테스트·향후 PDF 벡터 출력과 검증이 같은 곡선을 바라봐야 하므로,
// Catmull-Rom 보간과 샘플링을 한 파일에 모읍니다(PRD FR-10.1·10.2, §9.18).
import type { Point, SplineStroke, Stroke } from '@/lib/model/types'
import type { Viewport } from './viewport'

const SPLINE_SAMPLES_PER_SEGMENT = 16

function cubicBezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  const u2 = u * u
  const t2 = t * t
  return [
    u2 * u * p0[0] + 3 * u2 * t * p1[0] + 3 * u * t2 * p2[0] + t2 * t * p3[0],
    u2 * u * p0[1] + 3 * u2 * t * p1[1] + 3 * u * t2 * p2[1] + t2 * t * p3[1],
  ]
}

/** 한 정점의 자동/사용자 지정 베지어 핸들을 절대 mm 좌표로 돌려줍니다. */
export function splineControlHandles(stroke: SplineStroke, index: number): { in: Point; out: Point } {
  const { points, closed } = stroke
  const point = points[index]
  const lastIndex = points.length - 1
  const prev = closed ? points[(index - 1 + points.length) % points.length] : points[Math.max(0, index - 1)]
  const next = closed ? points[(index + 1) % points.length] : points[Math.min(lastIndex, index + 1)]
  // Catmull-Rom을 cubic Bezier로 바꿀 때 접선 벡터는 (next-prev)/6입니다. 사용자 지정
  // 핸들이 없는 예전 문서는 이 값을 써서 M1.5a와 같은 곡선을 유지합니다.
  const automatic: Point = [(next[0] - prev[0]) / 6, (next[1] - prev[1]) / 6]
  const custom = stroke.handles?.[index]
  const inOffset = custom?.in ?? [-automatic[0], -automatic[1]]
  const outOffset = custom?.out ?? automatic
  return {
    in: [point[0] + inOffset[0], point[1] + inOffset[1]],
    out: [point[0] + outOffset[0], point[1] + outOffset[1]],
  }
}

/** Stroke를 화면·판정에 함께 쓸 조밀한 꺾은선으로 바꿉니다. */
export function sampleStroke(stroke: Stroke): Point[] {
  if (stroke.kind === 'line') return stroke.points.slice()
  if (stroke.kind === 'roundedRect') {
    const halfW = Math.max(0, stroke.w) / 2
    const halfH = Math.max(0, stroke.h) / 2
    const radius = Math.max(0, Math.min(stroke.radius, halfW, halfH))
    const left = stroke.cx - halfW
    const right = stroke.cx + halfW
    const top = stroke.cy - halfH
    const bottom = stroke.cy + halfH
    if (radius === 0) {
      return [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]
    }

    const result: Point[] = []
    const cornerSteps = 16
    const appendCorner = (cx: number, cy: number, startAngle: number) => {
      for (let i = 0; i <= cornerSteps; i++) {
        const angle = startAngle + (i / cornerSteps) * (Math.PI / 2)
        result.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius])
      }
    }
    appendCorner(right - radius, top + radius, -Math.PI / 2)
    appendCorner(right - radius, bottom - radius, 0)
    appendCorner(left + radius, bottom - radius, Math.PI / 2)
    appendCorner(left + radius, top + radius, Math.PI)
    result.push(result[0])
    return result
  }
  if (stroke.kind === 'circle' || stroke.kind === 'ellipse') {
    const steps = 96
    const cx = stroke.cx
    const cy = stroke.cy
    const rx = stroke.kind === 'circle' ? stroke.r : stroke.rx
    const ry = stroke.kind === 'circle' ? stroke.r : stroke.ry
    const result: Point[] = []
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2
      result.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry])
    }
    return result
  }

  const { points, closed } = stroke
  if (points.length < 2) return points.slice()
  const segmentCount = closed ? points.length : points.length - 1
  const result: Point[] = [points[0]]
  for (let i = 0; i < segmentCount; i++) {
    const nextIndex = (i + 1) % points.length
    const p0 = points[i]
    const p1 = splineControlHandles(stroke, i).out
    const p2 = splineControlHandles(stroke, nextIndex).in
    const p3 = points[nextIndex]
    for (let step = 1; step <= SPLINE_SAMPLES_PER_SEGMENT; step++) {
      result.push(cubicBezierPoint(p0, p1, p2, p3, step / SPLINE_SAMPLES_PER_SEGMENT))
    }
  }
  return result
}

/** 실제 인쇄 굵기를 유지한 검정 경로를 그립니다. 자유곡선은 끝과 이음이 round입니다. */
export function drawStrokePath(ctx: CanvasRenderingContext2D, viewport: Viewport, stroke: Stroke): void {
  if (stroke.kind === 'circle' || stroke.kind === 'ellipse') {
    const center = viewport.mapToScreen(stroke.cx, stroke.cy)
    const rx = viewport.mmToPx(stroke.kind === 'circle' ? stroke.r : stroke.rx)
    const ry = viewport.mmToPx(stroke.kind === 'circle' ? stroke.r : stroke.ry)
    ctx.beginPath()
    ctx.ellipse(center.x, center.y, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    return
  }

  if (stroke.kind === 'roundedRect') {
    const halfW = Math.max(0, stroke.w) / 2
    const halfH = Math.max(0, stroke.h) / 2
    const radius = Math.max(0, Math.min(stroke.radius, halfW, halfH))
    const topLeft = viewport.mapToScreen(stroke.cx - halfW, stroke.cy - halfH)
    const w = viewport.mmToPx(halfW * 2)
    const h = viewport.mmToPx(halfH * 2)
    const r = viewport.mmToPx(radius)
    ctx.beginPath()
    ctx.moveTo(topLeft.x + r, topLeft.y)
    ctx.arcTo(topLeft.x + w, topLeft.y, topLeft.x + w, topLeft.y + h, r)
    ctx.arcTo(topLeft.x + w, topLeft.y + h, topLeft.x, topLeft.y + h, r)
    ctx.arcTo(topLeft.x, topLeft.y + h, topLeft.x, topLeft.y, r)
    ctx.arcTo(topLeft.x, topLeft.y, topLeft.x + w, topLeft.y, r)
    ctx.closePath()
    ctx.stroke()
    return
  }

  const sampled = sampleStroke(stroke)
  if (sampled.length < 2) return
  const start = viewport.mapToScreen(sampled[0][0], sampled[0][1])
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  for (let i = 1; i < sampled.length; i++) {
    const point = viewport.mapToScreen(sampled[i][0], sampled[i][1])
    ctx.lineTo(point.x, point.y)
  }
  ctx.stroke()
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
}

function closestPointOnSegment(point: Point, a: Point, b: Point): { point: Point; distance: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) {
    return { point: [a[0], a[1]], distance: Math.hypot(point[0] - a[0], point[1] - a[1]) }
  }
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  const projected: Point = [a[0] + t * dx, a[1] + t * dy]
  return { point: projected, distance: Math.hypot(point[0] - projected[0], point[1] - projected[1]) }
}

/** 더블클릭한 곡선 위치에 정점을 넣기 위한 가장 가까운 논리 구간과 투영점을 찾습니다. */
export function closestEditableSegment(
  stroke: Extract<Stroke, { kind: 'spline' | 'line' }>,
  point: Point,
): { insertIndex: number; point: Point; distance: number } | null {
  if (stroke.points.length < 2) return null
  const segmentCount = stroke.kind === 'spline' && stroke.closed ? stroke.points.length : stroke.points.length - 1
  let best: { insertIndex: number; point: Point; distance: number } | null = null

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    let samples: Point[]
    if (stroke.kind === 'line') {
      samples = [stroke.points[segmentIndex], stroke.points[segmentIndex + 1]]
    } else {
      const nextIndex = (segmentIndex + 1) % stroke.points.length
      const p0 = stroke.points[segmentIndex]
      const p1 = splineControlHandles(stroke, segmentIndex).out
      const p2 = splineControlHandles(stroke, nextIndex).in
      const p3 = stroke.points[nextIndex]
      samples = [p0]
      for (let step = 1; step <= SPLINE_SAMPLES_PER_SEGMENT; step++) {
        samples.push(cubicBezierPoint(p0, p1, p2, p3, step / SPLINE_SAMPLES_PER_SEGMENT))
      }
    }
    for (let i = 1; i < samples.length; i++) {
      const candidate = closestPointOnSegment(point, samples[i - 1], samples[i])
      if (!best || candidate.distance < best.distance) {
        best = { insertIndex: segmentIndex + 1, point: candidate.point, distance: candidate.distance }
      }
    }
  }
  return best
}

/** 선 중심까지의 최소 거리(mm). 선폭 절반을 더해 선택 판정에 사용합니다. */
export function distanceToStroke(stroke: Stroke, point: Point): number {
  const sampled = sampleStroke(stroke)
  let min = Number.POSITIVE_INFINITY
  for (let i = 1; i < sampled.length; i++) min = Math.min(min, pointSegmentDistance(point, sampled[i - 1], sampled[i]))
  return min
}

/** 선택 윤곽에 쓸 축 정렬 경계. 선 굵기까지 포함합니다. */
export function strokeBounds(stroke: Stroke): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points = sampleStroke(stroke)
  if (points.length === 0) return null
  const half = stroke.width / 2
  return {
    minX: Math.min(...points.map((p) => p[0])) - half,
    minY: Math.min(...points.map((p) => p[1])) - half,
    maxX: Math.max(...points.map((p) => p[0])) + half,
    maxY: Math.max(...points.map((p) => p[1])) + half,
  }
}

/** Douglas-Peucker 단순화(FR-10.2). 첫 점과 끝 점은 항상 보존합니다. */
export function simplifyDouglasPeucker(points: Point[], toleranceMm: number): Point[] {
  if (points.length <= 2) return points.slice()
  let farthestDistance = 0
  let farthestIndex = 0
  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointSegmentDistance(points[i], points[0], points[points.length - 1])
    if (distance > farthestDistance) {
      farthestDistance = distance
      farthestIndex = i
    }
  }
  if (farthestDistance <= toleranceMm) return [points[0], points[points.length - 1]]
  const left = simplifyDouglasPeucker(points.slice(0, farthestIndex + 1), toleranceMm)
  const right = simplifyDouglasPeucker(points.slice(farthestIndex), toleranceMm)
  return [...left.slice(0, -1), ...right]
}
