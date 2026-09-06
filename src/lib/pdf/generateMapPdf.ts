import fontkit from '@pdf-lib/fontkit'
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  appendBezierCurve,
  clip,
  closePath,
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
  stroke,
  translate,
} from 'pdf-lib'
import type { PDFDocument as PdfDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import { PAPER_SIZES } from '@/lib/model/constants'
import type { Direction, Label, MapDoc, Point, Stroke } from '@/lib/model/types'
import { getIcon } from '@/lib/icons/catalog'
import { findPrintPlan } from '@/lib/print/plan'
import type { PrintPlanOption, TileRegion } from '@/lib/print/plan'
import { getTile } from '@/lib/tiles/catalog'
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
    const isObject = getTile(cell.art)?.kind === 'object' || Boolean(getIcon(cell.art))
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

async function drawProps(context: RenderContext): Promise<void> {
  for (const prop of context.doc.props) {
    const image = await imageFor(context, prop.asset)
    drawTransformedImage(context, image, prop.x, prop.y, prop.w, prop.h, prop.rot, prop.flip ?? false)
  }
}

function drawCenteredText(context: RenderContext, label: Label): void {
  if (!label.text) return
  const size = pt(label.size)
  const width = context.font.widthOfTextAtSize(label.text, size)
  const height = context.font.heightAtSize(size, { descender: true })
  const center = mapPoint(context.layout, [label.x, label.y])
  context.page.pushOperators(pushGraphicsState(), translate(center.x, center.y), rotateDegrees(-label.rot))
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

function drawMarkerCaption(context: RenderContext, text: string, xMm: number, yMm: number): void {
  drawCenteredText(context, { text, x: xMm, y: yMm, rot: 0, size: 6, color: '#111111', onLine: false })
}

function drawMarkers(context: RenderContext): void {
  const { doc, page, layout } = context
  const outerRadiusMm = 17
  const ringWidth = pt(3)
  const drawRing = (center: Point, radiusMm: number) => {
    const point = mapPoint(layout, center)
    page.drawCircle({ x: point.x, y: point.y, size: pt(radiusMm), borderWidth: ringWidth, borderColor: rgb(0.067, 0.067, 0.067) })
  }

  if (doc.markers.start) {
    const center = nodePoint(doc, doc.markers.start.cell[0], doc.markers.start.cell[1])
    drawRing(center, outerRadiusMm)
    const vectors: Record<Direction, Point> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
    const direction = vectors[doc.markers.start.heading]
    const perpendicular: Point = [-direction[1], direction[0]]
    const tip = outerRadiusMm * 0.9
    const back = -outerRadiusMm * 0.5
    const halfWidth = outerRadiusMm * 0.45
    fillPolygon(context, [
      [center[0] + direction[0] * tip, center[1] + direction[1] * tip],
      [center[0] + direction[0] * back + perpendicular[0] * halfWidth, center[1] + direction[1] * back + perpendicular[1] * halfWidth],
      [center[0] + direction[0] * back - perpendicular[0] * halfWidth, center[1] + direction[1] * back - perpendicular[1] * halfWidth],
    ])
    drawMarkerCaption(context, '출발', center[0], center[1] + outerRadiusMm + 5)
  }

  for (const goal of doc.markers.goals) {
    const center = nodePoint(doc, goal.cell[0], goal.cell[1])
    drawRing(center, outerRadiusMm)
    drawRing(center, 11)
    drawMarkerCaption(context, goal.name || '도착', center[0], center[1] + outerRadiusMm + 5)
  }
}

function drawPageGuides(context: RenderContext, pageLabel?: string): void {
  const { page, font, layout, doc } = context
  const noticeSize = pt(2.4)
  const noticeWidth = font.widthOfTextAtSize(PRINT_NOTICE, noticeSize)
  page.drawText(PRINT_NOTICE, {
    x: (pt(layout.pageWidthMm) - noticeWidth) / 2,
    y: pt(layout.pageHeightMm - 3.5),
    size: noticeSize,
    font,
    color: rgb(0, 0, 0),
  })

  if (pageLabel) {
    page.drawText(pageLabel, { x: pt(4), y: pt(layout.pageHeightMm - 3.5), size: pt(2.4), font, color: rgb(0, 0, 0) })
  }

  if (!doc.print.scaleRuler) return
  const startX = pt(layout.offsetXmm)
  const endX = startX + pt(50)
  const y = pt(1.4)
  page.drawLine({ start: { x: startX, y }, end: { x: endX, y }, thickness: pt(0.3), color: rgb(0, 0, 0) })
  for (const x of [startX, endX]) {
    page.drawLine({ start: { x, y: pt(0.7) }, end: { x, y: pt(2.7) }, thickness: pt(0.3), color: rgb(0, 0, 0) })
  }
  page.drawText('50 mm', { x: endX + pt(2), y: pt(0.65), size: pt(2.2), font, color: rgb(0, 0, 0) })
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
  for (const item of doc.strokes) drawStroke(context, item)
  drawGrid(context)
  await drawCellGroup(context, true)
  await drawProps(context)
  for (const label of doc.labels) drawCenteredText(context, label)
  drawMarkers(context)
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

function drawTileMarks(context: RenderContext, plan: PrintPlanOption, region: TileRegion): void {
  const { page, layout, doc, font } = context
  const left = pt(layout.offsetXmm)
  const right = left + pt(region.cols * doc.board.pitch)
  const top = pt(layout.pageHeightMm - layout.offsetYmm)
  const bottom = top - pt(region.rows * doc.board.pitch)
  const mark = pt(3)
  const thin = pt(0.25)

  if (doc.print.cropMarks) {
    const trimLines = [
      [{ x: left, y: bottom }, { x: right, y: bottom }],
      [{ x: right, y: bottom }, { x: right, y: top }],
      [{ x: right, y: top }, { x: left, y: top }],
      [{ x: left, y: top }, { x: left, y: bottom }],
    ] as const
    for (const [start, end] of trimLines) {
      page.drawLine({ start, end, thickness: thin, color: rgb(0.31, 0.275, 0.898), dashArray: [pt(1.5), pt(1)] })
    }

    for (const x of [left, right]) {
      page.drawLine({ start: { x, y: bottom - mark }, end: { x, y: bottom }, thickness: thin, color: rgb(0, 0, 0) })
      page.drawLine({ start: { x, y: top }, end: { x, y: top + mark }, thickness: thin, color: rgb(0, 0, 0) })
    }
    for (const y of [bottom, top]) {
      page.drawLine({ start: { x: left - mark, y }, end: { x: left, y }, thickness: thin, color: rgb(0, 0, 0) })
      page.drawLine({ start: { x: right, y }, end: { x: right + mark, y }, thickness: thin, color: rgb(0, 0, 0) })
    }

    const triangle = pt(2.2)
    drawAbsolutePolygon(page, [
      { x: (left + right) / 2 - triangle, y: top + triangle },
      { x: (left + right) / 2 + triangle, y: top + triangle },
      { x: (left + right) / 2, y: top },
    ])
    drawAbsolutePolygon(page, [
      { x: (left + right) / 2 - triangle, y: bottom - triangle },
      { x: (left + right) / 2 + triangle, y: bottom - triangle },
      { x: (left + right) / 2, y: bottom },
    ])
    drawAbsolutePolygon(page, [
      { x: left - triangle, y: (bottom + top) / 2 - triangle },
      { x: left - triangle, y: (bottom + top) / 2 + triangle },
      { x: left, y: (bottom + top) / 2 },
    ])
    drawAbsolutePolygon(page, [
      { x: right + triangle, y: (bottom + top) / 2 - triangle },
      { x: right + triangle, y: (bottom + top) / 2 + triangle },
      { x: right, y: (bottom + top) / 2 },
    ])
  }

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

  const seamText = doc.print.seam === 'overlap' ? `겹치기 ${doc.print.overlap}mm` : '맞대기'
  page.drawText(`1. 시트 번호 순서대로 펼칩니다.  2. 점선을 따라 자릅니다.  3. 중앙 삼각 마크를 맞춰 ${seamText} 방식으로 붙입니다.`, {
    x: pt(16), y: pt(14), size: pt(2.8), font, color: rgb(0, 0, 0),
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

  drawAssemblyGuide(pdf, font, doc, plan)
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
