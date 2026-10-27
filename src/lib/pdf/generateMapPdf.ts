import fontkit from '@pdf-lib/fontkit'
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  appendBezierCurve,
  clip,
  closePath,
  degrees,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  rotateDegrees,
  scale,
  setFillingRgbColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextRenderingMode,
  stroke,
  TextRenderingMode,
  translate,
} from 'pdf-lib'
import type { PDFDocument as PdfDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import { PAPER_SIZES } from '@/lib/model/constants'
import { goalDisplayNames } from '@/lib/model/goalNames'
import type { Direction, Label, MapDoc, Point, Stroke } from '@/lib/model/types'
import { getIcon } from '@/lib/icons/catalog'
import { markerPositionMm, obstacleLabel, obstaclesOf } from '@/lib/model/obstacles'
import {
  HAMSTER_BODY_PATH,
  HAMSTER_CAPTION_RADIUS_MM,
  HAMSTER_IMAGE_H_MM,
  HAMSTER_IMAGE_URL,
  HAMSTER_IMAGE_W_MM,
  HAMSTER_OUTLINE_MM,
  HEADING_DEGREES,
} from '@/lib/markers/hamsterArt'
import { findPrintPlan } from '@/lib/print/plan'
import type { PrintPlanOption, TileRegion } from '@/lib/print/plan'
import { getTile, isPlacedAboveLine } from '@/lib/tiles/catalog'
import { splineControlHandles } from '@/features/canvas/strokeGeometry'
import { loadPdfFontBytes } from './pdfResources'

const POINTS_PER_MM = 72 / 25.4
const BEZIER_CIRCLE = 0.5522847498307936
const PRINT_NOTICE = '※ 실제 크기(100%)로 인쇄하세요'

export class PdfGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfGenerationError'
  }
}

/** Node 기반 구조 검사에서는 fontBytes만 주입하고, 브라우저에서는 번들 URL을 fetch합니다. */
export interface PdfGenerationOptions {
  fontBytes?: Uint8Array
}

interface Layout {
  pageWidthMm: number
  pageHeightMm: number
  mapWidthMm: number
  mapHeightMm: number
  offsetXmm: number
  offsetYmm: number
  originXmm: number
  originYmm: number
}

interface RenderContext {
  pdf: PdfDocument
  page: PDFPage
  doc: MapDoc
  font: PDFFont
  layout: Layout
  imageCache: Map<string, Promise<PDFImage>>
}

function pt(mm: number): number {
  return mm * POINTS_PER_MM
}

function paperLayout(doc: MapDoc): Layout {
  if (doc.print.layout !== 'single') {
    throw new PdfGenerationError('나눠 인쇄는 출력 계획기에서 지원합니다')
  }

  const paper = PAPER_SIZES.find((candidate) => candidate.id === doc.print.sheet)
  if (!paper) throw new PdfGenerationError(`지원하지 않는 용지입니다: ${doc.print.sheet}`)

  const pageWidthMm = doc.print.orientation === 'landscape' ? paper.widthMm : paper.heightMm
  const pageHeightMm = doc.print.orientation === 'landscape' ? paper.heightMm : paper.widthMm
  const mapWidthMm = doc.board.cols * doc.board.pitch
  const mapHeightMm = doc.board.rows * doc.board.pitch
  if (mapWidthMm > pageWidthMm || mapHeightMm > pageHeightMm) {
    throw new PdfGenerationError(
      `맵 ${mapWidthMm}×${mapHeightMm}mm가 ${paper.label} ${doc.print.orientation === 'landscape' ? '가로' : '세로'} 용지에 실물 크기로 들어가지 않습니다`,
    )
  }

  return {
    pageWidthMm,
    pageHeightMm,
    mapWidthMm,
    mapHeightMm,
    offsetXmm: (pageWidthMm - mapWidthMm) / 2,
    offsetYmm: (pageHeightMm - mapHeightMm) / 2,
    originXmm: 0,
    originYmm: 0,
  }
}

/** 맵의 좌상단 mm 좌표를 PDF의 좌하단 pt 좌표로 바꿉니다. */
function mapPoint(layout: Layout, point: Point): { x: number; y: number } {
  return {
    x: pt(layout.offsetXmm + point[0] - layout.originXmm),
    y: pt(layout.pageHeightMm - layout.offsetYmm - point[1] + layout.originYmm),
  }
}

function nodePoint(doc: MapDoc, c: number, r: number): Point {
  const half = doc.board.pitch / 2
  return [c * doc.board.pitch + half, r * doc.board.pitch + half]
}

function parseHexColor(value: string) {
  const normalized = value.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(normalized)
  const full = /^#([0-9a-f]{6})$/i.exec(normalized)
  const hex = full?.[1] ?? short?.[1].split('').map((char) => char + char).join('')
  if (!hex) return rgb(0, 0, 0)
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  )
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new PdfGenerationError(`PDF 자산을 불러오지 못했습니다 (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !dataUrl.slice(0, comma).includes(';base64')) {
    throw new PdfGenerationError('내 이미지 데이터 형식이 잘못되었습니다')
  }
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function rasterizeSvg(url: string): Promise<Uint8Array> {
  const source = await fetch(url).then((response) => {
    if (!response.ok) throw new PdfGenerationError(`아이콘을 불러오지 못했습니다 (${response.status})`)
    return response.text()
  })
  const objectUrl = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 600
    const context = canvas.getContext('2d')
    if (!context) throw new PdfGenerationError('아이콘 변환용 캔버스를 만들지 못했습니다')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 변환 실패')), 'image/png')
    })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function imageFor(context: RenderContext, assetId: string): Promise<PDFImage> {
  const existing = context.imageCache.get(assetId)
  if (existing) return existing

  const pending = (async () => {
    if (assetId.startsWith('asset:')) {
      const key = assetId.slice('asset:'.length)
      const asset = context.doc.userAssets[key]
      if (!asset) throw new PdfGenerationError(`내 이미지를 찾을 수 없습니다: ${key}`)
      return context.pdf.embedPng(dataUrlBytes(asset.dataUrl))
    }

    const tile = getTile(assetId)
    if (tile) return context.pdf.embedPng(await fetchBytes(tile.url))

    const icon = getIcon(assetId)
    if (icon) return context.pdf.embedPng(await rasterizeSvg(icon.url))

    // 출발·도착 햄스터 사진은 PNG 주소를 id 대신 그대로 넘깁니다(drawMarkers).
    if (assetId === HAMSTER_IMAGE_URL) return context.pdf.embedPng(await fetchBytes(assetId))

    throw new PdfGenerationError(`이미지를 찾을 수 없습니다: ${assetId}`)
  })()
  context.imageCache.set(assetId, pending)
  return pending
}

function drawTransformedImage(
  context: RenderContext,
  image: PDFImage,
  xMm: number,
  yMm: number,
  widthMm: number,
  heightMm: number,
  rotation: number,
  flip: boolean,
): void {
  const center = mapPoint(context.layout, [xMm + widthMm / 2, yMm + heightMm / 2])
  const width = pt(widthMm)
  const height = pt(heightMm)
  context.page.pushOperators(
    pushGraphicsState(),
    translate(center.x, center.y),
    rotateDegrees(-rotation),
    scale(flip ? -1 : 1, 1),
    translate(-width / 2, -height / 2),
  )
  context.page.drawImage(image, { x: 0, y: 0, width, height })
  context.page.pushOperators(popGraphicsState())
}

async function drawCellGroup(context: RenderContext, aboveGrid: boolean): Promise<void> {
  const { cols, pitch } = context.doc.board
  for (let index = 0; index < context.doc.cells.length; index++) {
    const cell = context.doc.cells[index]
    if (!cell) continue
    // 선 위에 얹을지는 isTileAboveLine 하나로 판단합니다(catalog.ts 주석 참고).
    const isObject = isPlacedAboveLine(cell.art, cell.under)
    if (isObject !== aboveGrid) continue
    const image = await imageFor(context, cell.art)
    drawTransformedImage(context, image, (index % cols) * pitch, Math.floor(index / cols) * pitch, pitch, pitch, cell.rot, cell.flip)
  }
}

function beginStroke(context: RenderContext, widthMm: number) {
  context.page.pushOperators(
    pushGraphicsState(),
    setStrokingRgbColor(0, 0, 0),
    setLineWidth(pt(widthMm)),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
  )
}

function bezier(context: RenderContext, control1: Point, control2: Point, end: Point): void {
  const c1 = mapPoint(context.layout, control1)
  const c2 = mapPoint(context.layout, control2)
  const p = mapPoint(context.layout, end)
  context.page.pushOperators(appendBezierCurve(c1.x, c1.y, c2.x, c2.y, p.x, p.y))
}

function drawStroke(context: RenderContext, item: Stroke): void {
  if (item.width <= 0) return
  beginStroke(context, item.width)

  if (item.kind === 'line' || item.kind === 'spline') {
    if (item.points.length >= 2) {
      const start = mapPoint(context.layout, item.points[0])
      context.page.pushOperators(moveTo(start.x, start.y))
      if (item.kind === 'line') {
        for (let index = 1; index < item.points.length; index++) {
          const point = mapPoint(context.layout, item.points[index])
          context.page.pushOperators(lineTo(point.x, point.y))
        }
      } else {
        const segmentCount = item.closed ? item.points.length : item.points.length - 1
        for (let index = 0; index < segmentCount; index++) {
          const next = (index + 1) % item.points.length
          bezier(context, splineControlHandles(item, index).out, splineControlHandles(item, next).in, item.points[next])
        }
        if (item.closed) context.page.pushOperators(closePath())
      }
    }
  } else if (item.kind === 'circle' || item.kind === 'ellipse') {
    const rx = item.kind === 'circle' ? item.r : item.rx
    const ry = item.kind === 'circle' ? item.r : item.ry
    const start = mapPoint(context.layout, [item.cx + rx, item.cy])
    context.page.pushOperators(moveTo(start.x, start.y))
    bezier(context, [item.cx + rx, item.cy + ry * BEZIER_CIRCLE], [item.cx + rx * BEZIER_CIRCLE, item.cy + ry], [item.cx, item.cy + ry])
    bezier(context, [item.cx - rx * BEZIER_CIRCLE, item.cy + ry], [item.cx - rx, item.cy + ry * BEZIER_CIRCLE], [item.cx - rx, item.cy])
    bezier(context, [item.cx - rx, item.cy - ry * BEZIER_CIRCLE], [item.cx - rx * BEZIER_CIRCLE, item.cy - ry], [item.cx, item.cy - ry])
    bezier(context, [item.cx + rx * BEZIER_CIRCLE, item.cy - ry], [item.cx + rx, item.cy - ry * BEZIER_CIRCLE], [item.cx + rx, item.cy])
    context.page.pushOperators(closePath())
  } else {
    const halfW = Math.max(0, item.w) / 2
    const halfH = Math.max(0, item.h) / 2
    const radius = Math.max(0, Math.min(item.radius, halfW, halfH))
    const left = item.cx - halfW
    const right = item.cx + halfW
    const top = item.cy - halfH
    const bottom = item.cy + halfH
    const k = radius * BEZIER_CIRCLE
    const start = mapPoint(context.layout, [left + radius, top])
    context.page.pushOperators(moveTo(start.x, start.y))
    let point = mapPoint(context.layout, [right - radius, top])
    context.page.pushOperators(lineTo(point.x, point.y))
    bezier(context, [right - radius + k, top], [right, top + radius - k], [right, top + radius])
    point = mapPoint(context.layout, [right, bottom - radius])
    context.page.pushOperators(lineTo(point.x, point.y))
    bezier(context, [right, bottom - radius + k], [right - radius + k, bottom], [right - radius, bottom])
    point = mapPoint(context.layout, [left + radius, bottom])
    context.page.pushOperators(lineTo(point.x, point.y))
    bezier(context, [left + radius - k, bottom], [left, bottom - radius + k], [left, bottom - radius])
    point = mapPoint(context.layout, [left, top + radius])
    context.page.pushOperators(lineTo(point.x, point.y))
    bezier(context, [left, top + radius - k], [left + radius - k, top], [left + radius, top])
    context.page.pushOperators(closePath())
  }

  context.page.pushOperators(stroke(), popGraphicsState())
}

function drawGrid(context: RenderContext): void {
  const { doc, page, layout } = context
  const width = pt(doc.board.lineWidth)
  if (width <= 0) return

  const drawSegment = (from: Point, to: Point) => {
    page.drawLine({
      start: mapPoint(layout, from),
      end: mapPoint(layout, to),
      thickness: width,
      color: rgb(0, 0, 0),
      lineCap: LineCapStyle.Butt,
    })
  }
  for (const [c, r] of doc.edges.h) drawSegment(nodePoint(doc, c, r), nodePoint(doc, c + 1, r))
  for (const [c, r] of doc.edges.v) drawSegment(nodePoint(doc, c, r), nodePoint(doc, c, r + 1))

  const degree = new Map<string, number>()
  const bump = (c: number, r: number) => degree.set(`${c},${r}`, (degree.get(`${c},${r}`) ?? 0) + 1)
  for (const [c, r] of doc.edges.h) { bump(c, r); bump(c + 1, r) }
  for (const [c, r] of doc.edges.v) { bump(c, r); bump(c, r + 1) }
  for (const item of doc.stubs) bump(item.node[0], item.node[1])
  for (const [key, count] of degree) {
    if (count < 2) continue
    const [c, r] = key.split(',').map(Number)
    const center = mapPoint(layout, nodePoint(doc, c, r))
    page.drawRectangle({ x: center.x - width / 2, y: center.y - width / 2, width, height: width, color: rgb(0, 0, 0) })
  }

  const vectors: Record<Direction, Point> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
  for (const item of doc.stubs) {
    const start = nodePoint(doc, item.node[0], item.node[1])
    const vector = vectors[item.dir]
    drawSegment(start, [start[0] + vector[0] * doc.board.pitch / 2, start[1] + vector[1] * doc.board.pitch / 2])
  }
}

async function drawProps(context: RenderContext, aboveGrid: boolean): Promise<void> {
  for (const prop of context.doc.props) {
    if (isPlacedAboveLine(prop.asset, prop.under) !== aboveGrid) continue
    const image = await imageFor(context, prop.asset)
    drawTransformedImage(context, image, prop.x, prop.y, prop.w, prop.h, prop.rot, prop.flip ?? false)
  }
}

/**
 * 라벨 하나를 지정한 mm 좌표 중앙에 그립니다.
 *
 * haloMm을 주면 글자 뒤에 그 두께의 흰 후광을 먼저 깔고 그 위에 본 글자를 얹습니다.
 * 검은 격자선 위에 걸치는 글자(출발·도착 이름표)가 안 보이는 걸 막는 용도입니다.
 * 텍스트 렌더링 모드 1(Outline)로 한 번 긋고 모드 0(Fill)로 되돌린 뒤 다시 그리는 방식이라
 * 래스터화 없이 벡터로 남습니다(FR-6.11의 취지와 같음).
 */
function drawCenteredText(context: RenderContext, label: Label, haloMm = 0): void {
  if (!label.text) return
  const size = pt(label.size)
  const width = context.font.widthOfTextAtSize(label.text, size)
  const height = context.font.heightAtSize(size, { descender: true })
  const center = mapPoint(context.layout, [label.x, label.y])
  context.page.pushOperators(pushGraphicsState(), translate(center.x, center.y), rotateDegrees(-label.rot))

  if (haloMm > 0) {
    context.page.pushOperators(
      setTextRenderingMode(TextRenderingMode.Outline),
      setStrokingRgbColor(1, 1, 1),
      setLineWidth(pt(haloMm)),
      setLineJoin(LineJoinStyle.Round),
    )
    context.page.drawText(label.text, {
      x: -width / 2,
      y: -height / 2,
      size,
      font: context.font,
      color: rgb(1, 1, 1),
    })
    // 다음 글자가 외곽선 모드로 새어 나가지 않도록 반드시 되돌립니다.
    context.page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill))
  }

  context.page.drawText(label.text, {
    x: -width / 2,
    y: -height / 2,
    size,
    font: context.font,
    color: label.onLine ? rgb(1, 1, 1) : parseHexColor(label.color),
  })
  context.page.pushOperators(popGraphicsState())
}

function fillPolygon(context: RenderContext, points: Point[]): void {
  if (points.length < 3) return
  const first = mapPoint(context.layout, points[0])
  context.page.pushOperators(pushGraphicsState(), setFillingRgbColor(0.067, 0.067, 0.067), moveTo(first.x, first.y))
  for (let index = 1; index < points.length; index++) {
    const point = mapPoint(context.layout, points[index])
    context.page.pushOperators(lineTo(point.x, point.y))
  }
  context.page.pushOperators(closePath(), fill(), popGraphicsState())
}

/** 마커 이름표. 검은 격자선 위에 걸쳐도 읽히도록 흰 후광을 깔고 검은 글자를 얹습니다.
 *  두께 1.5mm는 화면(drawBoard.ts의 MARKER_CAPTION_HALO_MM)과 같은 값입니다 —
 *  한쪽만 바꾸면 화면과 인쇄물이 달라 보이므로 항상 같이 맞추세요. */
const MARKER_CAPTION_HALO_MM = 1.5

function drawMarkerCaption(context: RenderContext, text: string, xMm: number, yMm: number): void {
  drawCenteredText(
    context,
    { text, x: xMm, y: yMm, rot: 0, size: 6, color: '#111111', onLine: false },
    MARKER_CAPTION_HALO_MM,
  )
}

async function drawMarkers(context: RenderContext): Promise<void> {
  const { doc, page, layout } = context
  const outerRadiusMm = 17
  const ringWidth = pt(3)
  const drawRing = (center: Point, radiusMm: number, fillBackground = false) => {
    const point = mapPoint(layout, center)
    page.drawCircle({
      x: point.x,
      y: point.y,
      size: pt(radiusMm),
      color: fillBackground ? rgb(1, 1, 1) : undefined,
      borderWidth: ringWidth,
      borderColor: rgb(0.067, 0.067, 0.067),
    })
  }

  // 햄스터 모양(docs/06 §3.2) — 화면과 같은 햄스터S 사진을 실물 크기로 찍고 몸통 윤곽을 긋습니다.
  // pdf-lib의 rotate는 반시계 방향이라 시계방향 heading 각도에 −를 붙입니다. drawImage는
  // 이미지 왼쪽 아래 모서리를 축으로 돌리므로, 중심이 제자리에 오도록 그 모서리 위치를 계산합니다.
  const usesHamster = doc.markers.start?.look === 'hamster' || doc.markers.goals.some((goal) => goal.look === 'hamster')
  const hamsterImage = usesHamster ? await imageFor(context, HAMSTER_IMAGE_URL) : null
  const drawHamster = (center: Point, heading: Direction) => {
    const point = mapPoint(layout, center)
    const angle = (-HEADING_DEGREES[heading] * Math.PI) / 180
    const w = pt(HAMSTER_IMAGE_W_MM)
    const h = pt(HAMSTER_IMAGE_H_MM)
    page.drawSvgPath(HAMSTER_BODY_PATH, { x: point.x, y: point.y, scale: POINTS_PER_MM, rotate: degrees(-HEADING_DEGREES[heading]), color: rgb(1, 1, 1) })
    if (hamsterImage) {
      page.drawImage(hamsterImage, {
        x: point.x - ((w / 2) * Math.cos(angle) - (h / 2) * Math.sin(angle)),
        y: point.y - ((w / 2) * Math.sin(angle) + (h / 2) * Math.cos(angle)),
        width: w,
        height: h,
        rotate: degrees(-HEADING_DEGREES[heading]),
      })
    }
    page.drawSvgPath(HAMSTER_BODY_PATH, {
      x: point.x,
      y: point.y,
      scale: POINTS_PER_MM,
      rotate: degrees(-HEADING_DEGREES[heading]),
      borderColor: rgb(0.067, 0.067, 0.067),
      borderWidth: HAMSTER_OUTLINE_MM,
    })
  }

  if (doc.markers.start?.look === 'hamster') {
    const center = markerPositionMm(doc.markers.start, doc.board.pitch)
    drawHamster(center, doc.markers.start.heading)
    drawMarkerCaption(context, doc.markers.start.name || '출발', center[0], center[1] + HAMSTER_CAPTION_RADIUS_MM + 5)
  } else if (doc.markers.start) {
    const center = markerPositionMm(doc.markers.start, doc.board.pitch)
    drawRing(center, outerRadiusMm, true)
    const vectors: Record<Direction, Point> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
    const direction = vectors[doc.markers.start.heading]
    const perpendicular: Point = [-direction[1], direction[0]]
    const tip = outerRadiusMm * 0.68
    const back = -outerRadiusMm * 0.22
    const halfWidth = outerRadiusMm * 0.28
    fillPolygon(context, [
      [center[0] + direction[0] * tip, center[1] + direction[1] * tip],
      [center[0] + direction[0] * back + perpendicular[0] * halfWidth, center[1] + direction[1] * back + perpendicular[1] * halfWidth],
      [center[0] + direction[0] * back - perpendicular[0] * halfWidth, center[1] + direction[1] * back - perpendicular[1] * halfWidth],
    ])
    drawMarkerCaption(context, doc.markers.start.name || '출발', center[0], center[1] + outerRadiusMm + 5)
  }

  const goalNames = goalDisplayNames(doc.markers.goals)
  doc.markers.goals.forEach((goal, index) => {
    const center = markerPositionMm(goal, doc.board.pitch)
    if (goal.look === 'hamster') {
      drawHamster(center, 'N')
      drawMarkerCaption(context, goalNames[index], center[0], center[1] + HAMSTER_CAPTION_RADIUS_MM + 5)
      return
    }
    drawRing(center, outerRadiusMm, true)
    drawRing(center, 11)
    drawMarkerCaption(context, goalNames[index], center[0], center[1] + outerRadiusMm + 5)
  })
}

/** 장애물 자리 점선 원 + 이름(docs/06 §3.5). 화면(drawBoard.ts drawObstaclesLayer)과 같은 수치. */
function drawObstacles(context: RenderContext): void {
  const { page, layout, doc } = context
  for (const o of obstaclesOf(doc)) {
    const center = mapPoint(layout, [o.cx, o.cy])
    page.drawCircle({
      x: center.x,
      y: center.y,
      size: pt(o.d / 2),
      borderWidth: pt(1.2),
      borderColor: rgb(0.067, 0.067, 0.067),
      borderDashArray: [pt(4), pt(2.5)],
    })
    drawCenteredText(
      context,
      { text: obstacleLabel(o), x: o.cx, y: o.cy, rot: 0, size: 5, color: '#444444', onLine: false },
      1.2,
    )
  }
}

/**
 * 종이 가장자리에서 이만큼 안쪽이어야 프린터가 확실히 찍어 줍니다(mm).
 *
 * [왜 8mm인가 — 2026-09-16]
 * 예전에는 50mm 눈금자를 종이 아래 끝에서 1.4mm 지점에(눈금 0.7~2.7mm, "50 mm" 글자 0.65mm),
 * "실제 크기로 인쇄하세요" 안내를 위 끝에서 3.5mm 지점에 뒀습니다. 그런데 학교에서 흔히 쓰는
 * 레이저 복합기·잉크젯은 A4 상하 4.2~5mm를 아예 인쇄하지 못합니다(테두리 없는 인쇄 미지원).
 * 그래서 둘 다 종이에 안 찍혔습니다 — 자로 재라고 넣은 눈금자가 정작 인쇄물에 없었던 겁니다
 * (S2 "피치 50mm ±0.5mm 실측"을 할 수단이 사라짐). 8mm면 위 기종들을 모두 넘깁니다.
 */
const SAFE_PRINT_EDGE_MM = 8

/**
 * 안내 요소를 넣으려면 여백 띠가 최소 이만큼은 돼야 합니다(mm).
 * SAFE_PRINT_EDGE_MM(8) + 눈금자·글자가 차지하는 두께(약 5.4) + 여유.
 */
const GUIDE_MIN_BAND_MM = 14

/**
 * 안내 요소를 가로로 눕힐지 세로로 세울지 정합니다.
 *
 * 맵은 항상 용지 한가운데 놓이므로(paperLayout / tiledLayout) 좌우 여백 = offsetXmm,
 * 상하 여백 = offsetYmm 입니다. 칸이 50mm이고 용지 규격은 50의 배수가 아니라서,
 * 두 축 중 한쪽에는 반드시 큰 자투리가 남습니다. 그 넓은 쪽 띠에 넣으면 맵을 조금도
 * 가리지 않고 인쇄 가능 영역 안에 들어갑니다.
 *   예) A4 가로 5×4 → 좌우 23.5mm / 상하 5mm  → 세로(좌우 띠)
 *       A4 세로 4×5 → 좌우 5mm / 상하 23.5mm → 가로(상하 띠)
 * 둘 다 좁은 드문 경우에만 가로로 두되 흰 바탕을 깔아 맵 위에 겹칩니다.
 */
function guidePlacement(layout: Layout): { vertical: boolean; plate: boolean } {
  if (layout.offsetYmm >= GUIDE_MIN_BAND_MM) return { vertical: false, plate: false }
  if (layout.offsetXmm >= GUIDE_MIN_BAND_MM) return { vertical: true, plate: false }
  return { vertical: false, plate: true }
}

function drawPageGuides(context: RenderContext, pageLabel?: string): void {
  const { page, font, layout, doc } = context
  const { vertical, plate } = guidePlacement(layout)
  const noticeSize = pt(2.4)
  const noticeWidth = font.widthOfTextAtSize(PRINT_NOTICE, noticeSize)
  const black = rgb(0, 0, 0)

  /** 맵 위에 겹칠 수밖에 없을 때만 까는 흰 바탕. 겹치지 않는 경우에는 아무것도 그리지 않습니다. */
  const backing = (xMm: number, yMm: number, wMm: number, hMm: number) => {
    if (!plate) return
    page.drawRectangle({ x: pt(xMm), y: pt(yMm), width: pt(wMm), height: pt(hMm), color: rgb(1, 1, 1), opacity: 0.9 })
  }

  // 안내 문구·시트 번호를 끈 경우(출력 계획기 체크박스). 눈금자 설정은 따로 따릅니다.
  const showNotice = doc.print.notice !== false

  if (vertical) {
    // ── 안내 문구: 오른쪽 띠에 90° 세워서 ──────────────────────────────
    // degrees(90)이면 글자가 위로 진행하고 글자 높이는 x가 작아지는 쪽으로 자랍니다.
    // 그래서 기준 x를 띠의 오른쪽 끝에 두면 글자가 통째로 띠 안에 들어옵니다.
    if (showNotice) page.drawText(PRINT_NOTICE, {
      x: pt(layout.pageWidthMm - SAFE_PRINT_EDGE_MM),
      y: (pt(layout.pageHeightMm) - noticeWidth) / 2,
      size: noticeSize,
      font,
      color: black,
      rotate: degrees(90),
    })
    if (showNotice && pageLabel) {
      page.drawText(pageLabel, {
        x: pt(layout.pageWidthMm - SAFE_PRINT_EDGE_MM),
        y: pt(SAFE_PRINT_EDGE_MM),
        size: pt(2.4),
        font,
        color: black,
        rotate: degrees(90),
      })
    }

    if (!doc.print.scaleRuler) return
    // ── 50mm 눈금자: 왼쪽 띠에 세로로 ─────────────────────────────────
    const x = pt(SAFE_PRINT_EDGE_MM + 1.5)
    const startY = (pt(layout.pageHeightMm) - pt(50)) / 2
    const endY = startY + pt(50)
    page.drawLine({ start: { x, y: startY }, end: { x, y: endY }, thickness: pt(0.3), color: black })
    for (const y of [startY, endY]) {
      page.drawLine({
        start: { x: pt(SAFE_PRINT_EDGE_MM), y },
        end: { x: pt(SAFE_PRINT_EDGE_MM + 3), y },
        thickness: pt(0.3),
        color: black,
      })
    }
    page.drawText('50 mm', {
      x: pt(SAFE_PRINT_EDGE_MM + 5.4),
      y: endY + pt(2),
      size: pt(2.2),
      font,
      color: black,
      rotate: degrees(90),
    })
    return
  }

  // ── 안내 문구: 위쪽 띠에 가로로 ────────────────────────────────────
  const noticeBaselineMm = layout.pageHeightMm - SAFE_PRINT_EDGE_MM - 2.4
  if (showNotice) {
    backing(SAFE_PRINT_EDGE_MM, noticeBaselineMm - 0.8, layout.pageWidthMm - SAFE_PRINT_EDGE_MM * 2, 4)
    page.drawText(PRINT_NOTICE, {
      x: (pt(layout.pageWidthMm) - noticeWidth) / 2,
      y: pt(noticeBaselineMm),
      size: noticeSize,
      font,
      color: black,
    })
  }

  if (showNotice && pageLabel) {
    page.drawText(pageLabel, { x: pt(SAFE_PRINT_EDGE_MM), y: pt(noticeBaselineMm), size: pt(2.4), font, color: black })
  }

  if (!doc.print.scaleRuler) return
  // ── 50mm 눈금자: 아래쪽 띠에 가로로 ────────────────────────────────
  // 맵 왼쪽 끝에 맞추되, 그 위치가 인쇄 불가 영역이면 안쪽으로 당깁니다.
  const startXmm = Math.max(layout.offsetXmm, SAFE_PRINT_EDGE_MM)
  const startX = pt(startXmm)
  const endX = startX + pt(50)
  const y = pt(SAFE_PRINT_EDGE_MM + 1.5)
  backing(startXmm - 2, SAFE_PRINT_EDGE_MM - 1, 50 + 16, 5.5)
  page.drawLine({ start: { x: startX, y }, end: { x: endX, y }, thickness: pt(0.3), color: black })
  for (const x of [startX, endX]) {
    page.drawLine({
      start: { x, y: pt(SAFE_PRINT_EDGE_MM) },
      end: { x, y: pt(SAFE_PRINT_EDGE_MM + 3) },
      thickness: pt(0.3),
      color: black,
    })
  }
  page.drawText('50 mm', { x: endX + pt(2), y: pt(SAFE_PRINT_EDGE_MM + 0.4), size: pt(2.2), font, color: black })
}

async function drawMapContent(context: RenderContext): Promise<void> {
  const { page, layout, doc } = context
  const clipX = pt(layout.offsetXmm)
  const clipY = pt(layout.pageHeightMm - layout.offsetYmm - layout.mapHeightMm)
  page.pushOperators(
    pushGraphicsState(),
    rectangle(clipX, clipY, pt(layout.mapWidthMm), pt(layout.mapHeightMm)),
    clip(),
    endPath(),
  )

  await drawCellGroup(context, false)
  await drawProps(context, false)
  for (const item of doc.strokes) drawStroke(context, item)
  drawGrid(context)
  await drawCellGroup(context, true)
  await drawProps(context, true)
  for (const label of doc.labels) drawCenteredText(context, label)
  drawObstacles(context)
  await drawMarkers(context)
  page.pushOperators(popGraphicsState())
}

function tileCode(region: TileRegion): string {
  return `${region.row + 1}-${region.column + 1}`
}

function drawAbsolutePolygon(page: PDFPage, points: Array<{ x: number; y: number }>): void {
  if (points.length < 3) return
  page.pushOperators(pushGraphicsState(), setFillingRgbColor(0.31, 0.275, 0.898), moveTo(points[0].x, points[0].y))
  for (let index = 1; index < points.length; index++) page.pushOperators(lineTo(points[index].x, points[index].y))
  page.pushOperators(closePath(), fill(), popGraphicsState())
}

/**
 * 재단 마크가 종이 끝에서 이만큼은 떨어져 있어야 프린터가 찍어 줍니다(mm).
 * 눈금자(SAFE_PRINT_EDGE_MM = 8)보다 느슨하게 잡았습니다 — 눈금자는 자를 대고 재야 해서
 * 넉넉해야 하지만, 재단 마크는 가위를 맞출 수 있을 만큼만 보이면 되기 때문입니다.
 */
const MARK_SAFE_EDGE_MM = 6
/** 여백이 넉넉할 때 재단 마크가 재단선 바깥으로 뻗는 길이(mm). 원래 값입니다. */
const MARK_OUTWARD_MM = 3
/** 바깥에 자리가 없을 때 안쪽으로 뒤집어 그리는 길이(mm). */
const MARK_INWARD_MM = 1.5
/** 변 중앙 정렬 삼각 마크의 밑변 절반 길이(mm). 높이만 여백에 맞춰 조정합니다. */
const MARK_TRIANGLE_HALF_MM = 2.2

/**
 * 한쪽 변의 재단 마크를 얼마나, 어느 방향으로 그릴지 정합니다.
 *
 * [2026-09-16 — 상하 마크가 인쇄 불가 영역에 찍히던 문제]
 * 원래는 항상 재단선 바깥으로 3mm를 뻗었습니다. 그런데 A4 가로 5×4처럼 상하 여백이
 * 5mm뿐인 시트에서는 그 마크가 종이 끝에서 2mm 지점에 놓여, 프린터가 아예 인쇄하지
 * 못하는 구간(보통 4.2~5mm)에 들어갔습니다. 재단선 점선 자체는 5mm 지점이라 살아남지만
 * 모서리 마크와 정렬 삼각형이 통째로 사라졌습니다.
 *
 * 그래서 바깥 여백이 모자라면 길이를 줄이고, 그래도 자리가 없으면 **안쪽으로 뒤집어** 그립니다.
 * 안쪽 마크도 재단선 모서리를 똑같이 가리키므로 가위를 맞추는 데 지장이 없고,
 * 격자선은 재단선에서 21mm 안쪽부터 시작하므로(칸 중심 25mm − 선폭 절반 4mm) 선을 건드리지 않습니다.
 * 다만 그 모서리 칸에 아트 타일이 깔려 있으면 마크가 그림 위에 겹쳐 보입니다.
 */
function markReach(marginMm: number): { lengthPt: number; inward: boolean } {
  const room = marginMm - MARK_SAFE_EDGE_MM
  if (room >= 1.2) return { lengthPt: pt(Math.min(MARK_OUTWARD_MM, room)), inward: false }
  return { lengthPt: pt(MARK_INWARD_MM), inward: true }
}

/** markReach 결과를 "바깥 = 양수, 안쪽 = 음수"인 오프셋으로 바꿉니다. */
function markOffset(reach: { lengthPt: number; inward: boolean }): number {
  return reach.inward ? -reach.lengthPt : reach.lengthPt
}

/** 정렬 삼각형의 높이. 마크 길이를 넘지 않게 잘라서 같은 방향으로 맞춥니다. */
function triangleHeight(reach: { lengthPt: number; inward: boolean }): number {
  const height = Math.min(pt(MARK_TRIANGLE_HALF_MM), reach.lengthPt)
  return reach.inward ? -height : height
}

/** 이음 표시 색(보라). 재단선·정렬 삼각형·겹칠 띠가 같은 색이라 "붙이는 데 쓰는 표시"로 읽힙니다. */
const SEAM_COLOR = rgb(0.31, 0.275, 0.898)

/**
 * 시트 한 장의 재단·이음 표시(docs/06 §2.9).
 *
 * [2026-10-26 — 후기 18번 "이어붙이는 가이드 선이 불필요한 곳에도"]
 * 예전에는 재단 점선·모서리 마크·정렬 삼각형을 시트 **네 변 모두**에 그렸습니다. 이웃 장이 없는
 * 바깥 변은 자를 필요가 없는데도 "점선을 따라 자르라"고 안내하는 셈이었습니다. 이제 이웃 장과
 * 맞닿는 변에만 그립니다.
 *
 * [2026-10-26 — 후기 20번 "겹치기를 해도 여백을 잘라야 함. 의미 없음"]
 * 겹치기는 아래 깔리는 장(왼쪽·위쪽)의 오른쪽·아래쪽에 겹칠 띠를 더 인쇄합니다(tiledLayout).
 * 그런데 재단 점선을 원래 경계에 그어서, 그 띠를 잘라 버리라고 안내하고 있었습니다 — 결국 맞대기와
 * 같아졌습니다. 이제는:
 *  - 아래 장의 띠 쪽 변: 자르지 않음. 띠를 옅게 칠하고 "다음 장을 여기에 겹쳐 붙이세요".
 *  - 위에 얹는 장의 이음 변: 원래 경계에서 겹치기 폭 안쪽 범위를 옅게 칠하고 그 가운데에 재단 점선.
 *    범위 안 어디를 잘라도 아래 장의 같은 그림이 보이므로 정확히 자르지 않아도 됩니다.
 * 프린터는 종이 끝 4~5mm를 못 찍어 흰 테두리가 항상 남으므로, 위에 얹는 장의 한 변은 한 번은
 * 잘라야 합니다(가위질 0번은 불가능). 이음매 하나에 가위질 1번이 겹치기의 장점입니다.
 */
function drawTileMarks(context: RenderContext, plan: PrintPlanOption, region: TileRegion): void {
  const { page, layout, doc, font } = context
  const left = pt(layout.offsetXmm)
  const right = left + pt(region.cols * doc.board.pitch)
  const top = pt(layout.pageHeightMm - layout.offsetYmm)
  const bottom = top - pt(region.rows * doc.board.pitch)
  const thin = pt(0.25)

  // 이웃 장과 맞닿는 변. 바깥 변에는 아무것도 그리지 않습니다.
  const joinLeft = region.column > 0
  const joinRight = region.column + 1 < plan.tilesX
  const joinTop = region.row > 0
  const joinBottom = region.row + 1 < plan.tilesY

  // 네 변의 실제 여백을 따로 잽니다. 겹치기(overlap) 이음매를 쓰면 맵이 한쪽으로만
  // 넓어져서 좌우·상하 여백이 서로 달라지기 때문입니다.
  const widthMm = layout.mapWidthMm
  const heightMm = layout.mapHeightMm
  const reachTop = markReach(layout.offsetYmm)
  const reachBottom = markReach(layout.pageHeightMm - layout.offsetYmm - heightMm)
  const reachLeft = markReach(layout.offsetXmm)
  const reachRight = markReach(layout.pageWidthMm - layout.offsetXmm - widthMm)

  if (doc.print.cropMarks) {
    if (doc.print.seam === 'overlap') {
      drawOverlapMarks(context, { left, right, top, bottom }, { joinLeft, joinRight, joinTop, joinBottom })
    } else {
      const dashed = (start: { x: number; y: number }, end: { x: number; y: number }) =>
        page.drawLine({ start, end, thickness: thin, color: SEAM_COLOR, dashArray: [pt(1.5), pt(1)] })
      const mark = (start: { x: number; y: number }, end: { x: number; y: number }) =>
        page.drawLine({ start, end, thickness: thin, color: rgb(0, 0, 0) })
      const outTop = markOffset(reachTop)
      const outBottom = markOffset(reachBottom)
      const outLeft = markOffset(reachLeft)
      const outRight = markOffset(reachRight)
      const half = pt(MARK_TRIANGLE_HALF_MM)
      const midX = (left + right) / 2
      const midY = (bottom + top) / 2

      // 세로 이음 변(왼쪽·오른쪽): 재단 점선 + 위아래 끝의 모서리 마크(선의 연장) + 가운데 삼각형.
      // 모서리 마크는 여백이 있으면 바깥으로, 없으면 안쪽으로 그립니다(markReach 주석 참고).
      for (const [joined, x, reach, sign] of [
        [joinLeft, left, reachLeft, -1],
        [joinRight, right, reachRight, 1],
      ] as const) {
        if (!joined) continue
        dashed({ x, y: bottom }, { x, y: top })
        mark({ x, y: bottom - outBottom }, { x, y: bottom })
        mark({ x, y: top }, { x, y: top + outTop })
        const h = triangleHeight(reach)
        drawAbsolutePolygon(page, [
          { x: x + sign * h, y: midY - half },
          { x: x + sign * h, y: midY + half },
          { x, y: midY },
        ])
      }
      // 가로 이음 변(위·아래).
      for (const [joined, y, reach, sign] of [
        [joinTop, top, reachTop, 1],
        [joinBottom, bottom, reachBottom, -1],
      ] as const) {
        if (!joined) continue
        dashed({ x: left, y }, { x: right, y })
        mark({ x: left - outLeft, y }, { x: left, y })
        mark({ x: right, y }, { x: right + outRight, y })
        const h = triangleHeight(reach)
        drawAbsolutePolygon(page, [
          { x: midX - half, y: y + sign * h },
          { x: midX + half, y: y + sign * h },
          { x: midX, y },
        ])
      }
    }
  }

  // 시트 번호·이웃 시트 안내는 맵 위에 겹쳐 찍히므로 "안내 문구·시트 번호"를 끄면 함께 뺍니다.
  if (doc.print.notice === false) return

  const code = tileCode(region)
  page.drawRectangle({ x: left + pt(2), y: top - pt(8), width: pt(16), height: pt(6), color: rgb(1, 1, 1), opacity: 0.88 })
  page.drawText(code, { x: left + pt(4), y: top - pt(6.4), size: pt(3.2), font, color: rgb(0.31, 0.275, 0.898) })

  const neighborParts: string[] = []
  if (region.column > 0) neighborParts.push(`← ${region.row + 1}-${region.column}`)
  if (region.row > 0) neighborParts.push(`↑ ${region.row}-${region.column + 1}`)
  if (region.column + 1 < plan.tilesX) neighborParts.push(`${region.row + 1}-${region.column + 2} →`)
  if (region.row + 1 < plan.tilesY) neighborParts.push(`${region.row + 2}-${region.column + 1} ↓`)
  if (neighborParts.length > 0) {
    const text = neighborParts.join('  ·  ')
    const size = pt(2.2)
    const width = font.widthOfTextAtSize(text, size)
    const x = Math.max(left + pt(2), right - width - pt(4))
    const y = bottom + pt(2)
    page.drawRectangle({ x: x - pt(1.5), y: y - pt(1), width: width + pt(3), height: pt(4.4), color: rgb(1, 1, 1), opacity: 0.88 })
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) })
  }
}

/** 겹치기 띠·자를 범위 표시의 채움 불투명도(docs/06 §3.6). 그림이 비쳐 보여야 합니다. */
const OVERLAP_BAND_OPACITY = 0.1
const OVERLAP_CUT_OPACITY = 0.06
const OVERLAP_TEXT = '다음 장을 여기에 겹쳐 붙이세요'

/** 겹치기 이음매 표시. drawTileMarks 주석의 [후기 20번] 참고. 좌표는 모두 pt. */
function drawOverlapMarks(
  context: RenderContext,
  edge: { left: number; right: number; top: number; bottom: number },
  join: { joinLeft: boolean; joinRight: boolean; joinTop: boolean; joinBottom: boolean },
): void {
  const { page, layout, doc, font } = context
  const { left, right, top, bottom } = edge
  const thin = pt(0.25)
  const fullRight = left + pt(layout.mapWidthMm)
  const fullBottom = top - pt(layout.mapHeightMm)
  const textSize = pt(2.2)
  const textWidth = font.widthOfTextAtSize(OVERLAP_TEXT, textSize)

  const band = (x: number, y: number, width: number, height: number, opacity: number) =>
    page.drawRectangle({ x, y, width, height, color: SEAM_COLOR, opacity, borderColor: SEAM_COLOR, borderWidth: thin, borderOpacity: 0.6 })

  // ① 아래 깔리는 장: 오른쪽·아래쪽에 더 찍힌 겹칠 띠. 자르지 않습니다.
  if (join.joinRight && fullRight > right) {
    band(right, fullBottom, fullRight - right, top - fullBottom, OVERLAP_BAND_OPACITY)
    if (textWidth < top - bottom) {
      page.drawText(OVERLAP_TEXT, {
        x: (right + fullRight) / 2 + textSize / 3,
        y: (top + bottom) / 2 - textWidth / 2,
        size: textSize,
        font,
        color: SEAM_COLOR,
        rotate: degrees(90),
      })
    }
  }
  if (join.joinBottom && fullBottom < bottom) {
    band(left, fullBottom, fullRight - left, bottom - fullBottom, OVERLAP_BAND_OPACITY)
    if (textWidth < right - left) {
      page.drawText(OVERLAP_TEXT, {
        x: (left + right) / 2 - textWidth / 2,
        y: (bottom + fullBottom) / 2 - textSize / 3,
        size: textSize,
        font,
        color: SEAM_COLOR,
      })
    }
  }

  // ② 위에 얹는 장: 이음 변 안쪽 겹치기 폭이 "잘라도 되는 범위". 가운데에 재단 점선.
  // 그 범위는 아래 장의 띠와 같은 그림이라, 범위 안 어디를 잘라도 이음이 어긋나지 않습니다.
  const cutMm = Math.max(0, doc.print.overlap)
  const dashed = (start: { x: number; y: number }, end: { x: number; y: number }) =>
    page.drawLine({ start, end, thickness: thin, color: SEAM_COLOR, dashArray: [pt(1.5), pt(1)] })
  if (join.joinLeft && cutMm > 0) {
    const width = Math.min(pt(cutMm), right - left)
    band(left, fullBottom, width, top - fullBottom, OVERLAP_CUT_OPACITY)
    dashed({ x: left + width / 2, y: fullBottom }, { x: left + width / 2, y: top })
  }
  if (join.joinTop && cutMm > 0) {
    const height = Math.min(pt(cutMm), top - bottom)
    band(left, top - height, fullRight - left, height, OVERLAP_CUT_OPACITY)
    dashed({ x: left, y: top - height / 2 }, { x: fullRight, y: top - height / 2 })
  }
}

function tiledLayout(doc: MapDoc, plan: PrintPlanOption, region: TileRegion): Layout {
  const pitch = doc.board.pitch
  const nominalWidth = region.cols * pitch
  const nominalHeight = region.rows * pitch
  const remainingWidth = Math.max(0, doc.board.cols * pitch - (region.startCol + region.cols) * pitch)
  const remainingHeight = Math.max(0, doc.board.rows * pitch - (region.startRow + region.rows) * pitch)
  const overlap = doc.print.seam === 'overlap' ? Math.max(0, doc.print.overlap) : 0
  const overlapX = Math.min(overlap, remainingWidth)
  const overlapY = Math.min(overlap, remainingHeight)
  const mapWidthMm = nominalWidth + overlapX
  const mapHeightMm = nominalHeight + overlapY
  if (mapWidthMm > plan.pageWidthMm || mapHeightMm > plan.pageHeightMm) {
    throw new PdfGenerationError(`겹치기 ${overlap}mm를 포함한 ${tileCode(region)} 시트가 용지를 넘습니다`)
  }
  return {
    pageWidthMm: plan.pageWidthMm,
    pageHeightMm: plan.pageHeightMm,
    mapWidthMm,
    mapHeightMm,
    offsetXmm: (plan.pageWidthMm - mapWidthMm) / 2,
    offsetYmm: (plan.pageHeightMm - mapHeightMm) / 2,
    originXmm: region.startCol * pitch,
    originYmm: region.startRow * pitch,
  }
}

function drawAssemblyGuide(pdf: PdfDocument, font: PDFFont, doc: MapDoc, plan: PrintPlanOption): void {
  const pageWidthMm = 297
  const pageHeightMm = 210
  const page = pdf.addPage([pt(pageWidthMm), pt(pageHeightMm)])
  const title = `${doc.meta.title || '햄스터S 말판'} · 조립 안내도`
  page.drawText(title, { x: pt(16), y: pt(190), size: pt(5), font, color: rgb(0, 0, 0) })

  const mapWidthMm = doc.board.cols * doc.board.pitch
  const mapHeightMm = doc.board.rows * doc.board.pitch
  const scaleFactor = Math.min(250 / mapWidthMm, 145 / mapHeightMm)
  const previewWidth = mapWidthMm * scaleFactor
  const previewHeight = mapHeightMm * scaleFactor
  const left = (pageWidthMm - previewWidth) / 2
  const top = 175
  page.drawRectangle({ x: pt(left), y: pt(top - previewHeight), width: pt(previewWidth), height: pt(previewHeight), color: rgb(0.965, 0.969, 0.976), borderWidth: pt(0.4), borderColor: rgb(0.42, 0.45, 0.5) })

  for (let column = 1; column < doc.board.cols; column++) {
    const x = left + column * doc.board.pitch * scaleFactor
    page.drawLine({ start: { x: pt(x), y: pt(top - previewHeight) }, end: { x: pt(x), y: pt(top) }, thickness: pt(0.12), color: rgb(0.82, 0.84, 0.88) })
  }
  for (let row = 1; row < doc.board.rows; row++) {
    const y = top - row * doc.board.pitch * scaleFactor
    page.drawLine({ start: { x: pt(left), y: pt(y) }, end: { x: pt(left + previewWidth), y: pt(y) }, thickness: pt(0.12), color: rgb(0.82, 0.84, 0.88) })
  }

  for (const region of plan.regions) {
    const x = left + region.startCol * doc.board.pitch * scaleFactor
    const yTop = top - region.startRow * doc.board.pitch * scaleFactor
    const width = region.cols * doc.board.pitch * scaleFactor
    const height = region.rows * doc.board.pitch * scaleFactor
    page.drawRectangle({ x: pt(x), y: pt(yTop - height), width: pt(width), height: pt(height), borderWidth: pt(0.6), borderColor: rgb(0.31, 0.275, 0.898) })
    const label = tileCode(region)
    const size = pt(4)
    const labelWidth = font.widthOfTextAtSize(label, size)
    page.drawText(label, { x: pt(x + width / 2) - labelWidth / 2, y: pt(yTop - height / 2) - size / 3, size, font, color: rgb(0.31, 0.275, 0.898) })
  }

  // 방식마다 자르는 곳이 다르므로 안내도 다르게 씁니다(docs/06 §2.9).
  const steps = doc.print.seam === 'overlap'
    ? `1. 시트 번호 순서대로 펼칩니다.  2. 오른쪽·아래 장의 옅은 띠 안 점선을 자릅니다(띠 안이면 어디든 괜찮음).  3. 왼쪽·위 장의 "겹쳐 붙이세요" 띠 위에 그림을 맞춰 얹고 붙입니다.`
    : '1. 시트 번호 순서대로 펼칩니다.  2. 이웃 장과 붙는 변의 점선을 자릅니다(바깥 변은 자르지 않음).  3. 가운데 삼각 마크를 맞춰 맞대어 붙입니다.'
  page.drawText(steps, {
    x: pt(16), y: pt(14), size: pt(2.6), font, color: rgb(0, 0, 0),
  })
  const guideContext: RenderContext = {
    pdf,
    page,
    doc,
    font,
    imageCache: new Map(),
    layout: { pageWidthMm, pageHeightMm, mapWidthMm: 50, mapHeightMm: 50, offsetXmm: 16, offsetYmm: 16, originXmm: 0, originYmm: 0 },
  }
  drawPageGuides(guideContext, '조립 안내도')
}

async function createPdf(doc: MapDoc, options: PdfGenerationOptions): Promise<{ pdf: PdfDocument; font: PDFFont }> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const fontBytes = options.fontBytes ?? await loadPdfFontBytes()
  // pdf-lib/fontkit의 브라우저 subset 경로는 한글 복합 글자의 일부를 누락시키므로,
  // PDF 전용 TrueType 자산을 전체 임베드해 라벨이 깨지지 않게 합니다.
  const font = await pdf.embedFont(fontBytes, { subset: false })
  pdf.setTitle(doc.meta.title || '햄스터S 말판')
  pdf.setCreator('햄스터S 말판 만들기')
  return { pdf, font }
}

/** M2: 현재 선택 용지 한 장에 맵을 100% 실물 크기로 렌더합니다. */
export async function generateSingleSheetPdf(doc: MapDoc, options: PdfGenerationOptions = {}): Promise<Uint8Array> {
  const layout = paperLayout(doc)
  const { pdf, font } = await createPdf(doc, options)
  const page = pdf.addPage([pt(layout.pageWidthMm), pt(layout.pageHeightMm)])
  const context: RenderContext = { pdf, page, doc, font, layout, imageCache: new Map() }

  drawPageGuides(context)
  await drawMapContent(context)

  return pdf.save()
}

/** M3: 선택한 계획에 따라 타일 시트와 마지막 조립 안내도 1장을 생성합니다. */
export async function generateTiledMapPdf(
  doc: MapDoc,
  selectedPlan?: PrintPlanOption,
  options: PdfGenerationOptions = {},
): Promise<Uint8Array> {
  const plan = selectedPlan ?? findPrintPlan(doc)
  if (!plan) throw new PdfGenerationError('현재 용지에 맞는 출력 계획을 찾지 못했습니다')
  const { pdf, font } = await createPdf(doc, options)
  const imageCache = new Map<string, Promise<PDFImage>>()

  for (const region of plan.regions) {
    const layout = tiledLayout(doc, plan, region)
    const page = pdf.addPage([pt(layout.pageWidthMm), pt(layout.pageHeightMm)])
    const context: RenderContext = { pdf, page, doc, font, layout, imageCache }
    drawPageGuides(context, `시트 ${tileCode(region)} / ${plan.tilesY}-${plan.tilesX}`)
    await drawMapContent(context)
    drawTileMarks(context, plan, region)
  }

  // 조립 안내도는 출력 계획기에서 끌 수 있습니다(예전 파일은 값이 없으므로 켬).
  if (doc.print.assemblyGuide !== false) drawAssemblyGuide(pdf, font, doc, plan)
  return pdf.save()
}

function pdfFileName(doc: MapDoc): string {
  const safeTitle = (doc.meta.title.trim() || '햄스터S_말판').replace(/[\\/:*?"<>|]/g, '_')
  return `${safeTitle}.pdf`
}

export async function downloadSingleSheetPdf(doc: MapDoc): Promise<void> {
  const bytes = await generateSingleSheetPdf(doc)
  downloadPdfBytes(bytes, pdfFileName(doc))
}

function downloadPdfBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadTiledMapPdf(doc: MapDoc, plan?: PrintPlanOption): Promise<void> {
  const bytes = await generateTiledMapPdf(doc, plan)
  downloadPdfBytes(bytes, pdfFileName(doc))
}
