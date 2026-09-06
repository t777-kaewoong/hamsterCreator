// 자유곡선의 공용 기하 계산.
// 화면 렌더링·히트테스트·향후 PDF 벡터 출력과 검증이 같은 곡선을 바라봐야 하므로,
// Catmull-Rom 보간과 샘플링을 한 파일에 모읍니다(PRD FR-10.1·10.2, §9.18).
import type { Point, Stroke } from '@/lib/model/types'
import type { Viewport } from './viewport'

const SPLINE_SAMPLES_PER_SEGMENT = 16

function catmullRomPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t
  const t3 = t2 * t
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ]
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
    const p0 = closed ? points[(i - 1 + points.length) % points.length] : points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[(i + 1) % points.length]
    const p3 = closed ? points[(i + 2) % points.length] : points[Math.min(points.length - 1, i + 2)]
    for (let step = 1; step <= SPLINE_SAMPLES_PER_SEGMENT; step++) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / SPLINE_SAMPLES_PER_SEGMENT))
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
