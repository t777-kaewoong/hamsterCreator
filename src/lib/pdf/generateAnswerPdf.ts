import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import { sampleStroke } from '@/features/canvas/strokeGeometry'
import type { GridAnswer, LineTracerAnswer } from '@/lib/answer/generateAnswer'
import type { Direction, MapDoc, NodeCoord, Point } from '@/lib/model/types'
import { loadPdfFontBytes } from './pdfResources'

const POINTS_PER_MM = 72 / 25.4
const PAGE_WIDTH_MM = 210
const PAGE_HEIGHT_MM = 297
const MARGIN_MM = 16

function pt(mm: number): number {
  return mm * POINTS_PER_MM
}

export interface AnswerPdfOptions {
  fontBytes?: Uint8Array
}

export interface AnswerPdfContent {
  grid: GridAnswer | null
  lineTracer: LineTracerAnswer | null
}

function drawText(page: PDFPage, font: PDFFont, text: string, xMm: number, yMm: number, sizeMm: number, color = rgb(0.1, 0.11, 0.13)) {
  page.drawText(text, { x: pt(xMm), y: pt(yMm), size: pt(sizeMm), font, color })
}

function nodePoint(doc: MapDoc, node: NodeCoord): Point {
  return [(node[0] + 0.5) * doc.board.pitch, (node[1] + 0.5) * doc.board.pitch]
}

function drawGridDiagram(page: PDFPage, font: PDFFont, doc: MapDoc, answer: GridAnswer, topMm: number): number {
  const boardWidth = doc.board.cols * doc.board.pitch
  const boardHeight = doc.board.rows * doc.board.pitch
  const scale = Math.min(174 / boardWidth, 105 / boardHeight)
  const width = boardWidth * scale
  const height = boardHeight * scale
  const left = (PAGE_WIDTH_MM - width) / 2
  const bottom = topMm - height
  const toPdf = (point: Point) => ({ x: pt(left + point[0] * scale), y: pt(bottom + height - point[1] * scale) })

  page.drawRectangle({
    x: pt(left), y: pt(bottom), width: pt(width), height: pt(height),
    color: rgb(0.98, 0.982, 0.988), borderColor: rgb(0.78, 0.8, 0.84), borderWidth: pt(0.35),
  })

  for (let column = 1; column < doc.board.cols; column++) {
    const x = left + column * doc.board.pitch * scale
    page.drawLine({ start: { x: pt(x), y: pt(bottom) }, end: { x: pt(x), y: pt(bottom + height) }, thickness: pt(0.12), color: rgb(0.88, 0.89, 0.92) })
  }
  for (let row = 1; row < doc.board.rows; row++) {
    const y = bottom + row * doc.board.pitch * scale
    page.drawLine({ start: { x: pt(left), y: pt(y) }, end: { x: pt(left + width), y: pt(y) }, thickness: pt(0.12), color: rgb(0.88, 0.89, 0.92) })
  }

  const edgeColor = rgb(0.38, 0.4, 0.45)
  for (const [column, row] of doc.edges.h) {
    page.drawLine({ start: toPdf(nodePoint(doc, [column, row])), end: toPdf(nodePoint(doc, [column + 1, row])), thickness: pt(Math.max(0.6, doc.board.lineWidth * scale)), color: edgeColor })
  }
  for (const [column, row] of doc.edges.v) {
    page.drawLine({ start: toPdf(nodePoint(doc, [column, row])), end: toPdf(nodePoint(doc, [column, row + 1])), thickness: pt(Math.max(0.6, doc.board.lineWidth * scale)), color: edgeColor })
  }

  const routeColor = rgb(0.31, 0.275, 0.898)
  for (let index = 1; index < answer.path.length; index++) {
    page.drawLine({
      start: toPdf(nodePoint(doc, answer.path[index - 1])), end: toPdf(nodePoint(doc, answer.path[index])),
      thickness: pt(Math.max(1.2, doc.board.lineWidth * scale * 0.42)), color: routeColor,
    })
  }

  const start = toPdf(nodePoint(doc, answer.path[0]))
  page.drawCircle({ x: start.x, y: start.y, size: pt(2.8), color: rgb(0.02, 0.59, 0.42), borderColor: rgb(1, 1, 1), borderWidth: pt(0.5) })
  const headingVector: Record<Direction, Point> = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] }
  const vector = headingVector[doc.markers.start?.heading ?? 'N']
  page.drawLine({ start, end: { x: start.x + pt(vector[0] * 4), y: start.y + pt(vector[1] * 4) }, thickness: pt(0.8), color: rgb(0.02, 0.35, 0.25) })

  answer.goalStops.forEach((stop, index) => {
    const center = toPdf(nodePoint(doc, stop.goal.cell))
    page.drawCircle({ x: center.x, y: center.y, size: pt(3.2), color: rgb(0.94, 0.55, 0.08), borderColor: rgb(1, 1, 1), borderWidth: pt(0.5) })
    const label = String(index + 1)
    const size = pt(2.5)
    drawText(page, font, label, center.x / POINTS_PER_MM - font.widthOfTextAtSize(label, size) / POINTS_PER_MM / 2, center.y / POINTS_PER_MM - 0.85, 2.5, rgb(1, 1, 1))
  })

  return bottom
}

function strokeBounds(doc: MapDoc): { minX: number; minY: number; maxX: number; maxY: number; samples: Point[][] } {
  const samples = doc.strokes.map(sampleStroke).filter((points) => points.length > 0)
  const flat = samples.flat()
  if (flat.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1, samples }
  return {
    minX: Math.min(...flat.map((point) => point[0])), minY: Math.min(...flat.map((point) => point[1])),
    maxX: Math.max(...flat.map((point) => point[0])), maxY: Math.max(...flat.map((point) => point[1])), samples,
  }
}

function drawLineTracerDiagram(page: PDFPage, doc: MapDoc, topMm: number): number {
  const bounds = strokeBounds(doc)
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX)
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY)
  const scale = Math.min(174 / sourceWidth, 90 / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  const left = (PAGE_WIDTH_MM - width) / 2
  const bottom = topMm - height
  const toPdf = (point: Point) => ({
    x: pt(left + (point[0] - bounds.minX) * scale),
    y: pt(bottom + height - (point[1] - bounds.minY) * scale),
  })
  page.drawRectangle({ x: pt(left - 4), y: pt(bottom - 4), width: pt(width + 8), height: pt(height + 8), color: rgb(0.98, 0.982, 0.988), borderColor: rgb(0.78, 0.8, 0.84), borderWidth: pt(0.35) })
  for (const points of bounds.samples) {
    for (let index = 1; index < points.length; index++) {
      page.drawLine({ start: toPdf(points[index - 1]), end: toPdf(points[index]), thickness: pt(1.2), color: rgb(0.08, 0.09, 0.11) })
    }
  }
  return bottom - 4
}

function addCodePages(pdf: PDFDocument, font: PDFFont, title: string, code: string) {
  const lines = code.split('\n')
  const maxLines = 42
  for (let offset = 0; offset < lines.length; offset += maxLines) {
    const page = pdf.addPage([pt(PAGE_WIDTH_MM), pt(PAGE_HEIGHT_MM)])
    drawText(page, font, `${title}${offset === 0 ? '' : ' (계속)'}`, MARGIN_MM, 278, 6)
    page.drawRectangle({ x: pt(MARGIN_MM), y: pt(20), width: pt(PAGE_WIDTH_MM - MARGIN_MM * 2), height: pt(248), color: rgb(0.965, 0.969, 0.976), borderColor: rgb(0.82, 0.84, 0.88), borderWidth: pt(0.3) })
    lines.slice(offset, offset + maxLines).forEach((line, index) => {
      drawText(page, font, line || ' ', MARGIN_MM + 5, 258 - index * 5.4, 3.2, rgb(0.12, 0.14, 0.18))
    })
  }
}

export async function generateAnswerPdf(doc: MapDoc, content: AnswerPdfContent, options: AnswerPdfOptions = {}): Promise<Uint8Array> {
  if (!content.grid && !content.lineTracer) throw new Error('PDF로 만들 정답이 없습니다')
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(options.fontBytes ?? await loadPdfFontBytes(), { subset: false })
  pdf.setTitle(`${doc.meta.title || '햄스터S 말판'} 정답`)
  pdf.setCreator('햄스터S 말판 만들기')

  if (content.grid) {
    const page = pdf.addPage([pt(PAGE_WIDTH_MM), pt(PAGE_HEIGHT_MM)])
    drawText(page, font, `${doc.meta.title || '햄스터S 말판'} · 정답`, MARGIN_MM, 278, 7)
    drawText(page, font, `최단 이동 ${content.grid.moveCount}칸 · 회전 ${content.grid.rotationCount}회 · 도착 ${content.grid.goalStops.length}곳`, MARGIN_MM, 269, 3.6, rgb(0.31, 0.275, 0.898))
    const bottom = drawGridDiagram(page, font, doc, content.grid, 258)
    drawText(page, font, '보라색 선을 따라가며 주황색 번호 순서대로 도착합니다.', MARGIN_MM, Math.max(112, bottom - 7), 3.1, rgb(0.35, 0.38, 0.43))
    drawText(page, font, '파이썬 코드는 다음 페이지에 있습니다.', MARGIN_MM, 22, 3.1, rgb(0.35, 0.38, 0.43))
    addCodePages(pdf, font, '격자 말판 파이썬 코드', content.grid.pythonCode)
  }

  if (content.lineTracer) {
    const page = pdf.addPage([pt(PAGE_WIDTH_MM), pt(PAGE_HEIGHT_MM)])
    drawText(page, font, `${doc.meta.title || '햄스터S 트랙'} · 라인트레이싱`, MARGIN_MM, 278, 7)
    drawText(page, font, `트랙 ${content.lineTracer.strokeCount}개 · 근사 길이 ${(content.lineTracer.lengthMm / 10).toFixed(1)}cm`, MARGIN_MM, 269, 3.6, rgb(0.31, 0.275, 0.898))
    const bottom = drawLineTracerDiagram(page, doc, 254)
    drawText(page, font, '속도와 감도는 인쇄 상태와 로봇에 맞춰 1~7, 1~10 범위에서 조정하세요.', MARGIN_MM, Math.max(112, bottom - 9), 3.1, rgb(0.35, 0.38, 0.43))
    drawText(page, font, '파이썬 템플릿은 다음 페이지에 있습니다.', MARGIN_MM, 22, 3.1, rgb(0.35, 0.38, 0.43))
    addCodePages(pdf, font, '라인트레이싱 파이썬 템플릿', content.lineTracer.pythonCode)
  }

  return pdf.save()
}

function answerFileName(doc: MapDoc): string {
  const safeTitle = (doc.meta.title.trim() || '햄스터S_말판').replace(/[\\/:*?"<>|]/g, '_')
  return `${safeTitle}_정답.pdf`
}

export async function downloadAnswerPdf(doc: MapDoc, content: AnswerPdfContent): Promise<void> {
  const bytes = await generateAnswerPdf(doc, content)
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = answerFileName(doc)
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
