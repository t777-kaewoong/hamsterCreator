// 우상단 미니맵 그리기 (PRD §9.12).
//
// 미니맵은 맵 전체를 아주 작게 그린 그림 위에, 지금 화면에 보이는 범위를 사각형으로
// 표시해서 "전체 중 지금 어디를 보고 있는지" 한눈에 알려줍니다. 패널의 반투명 배경·
// 둥근 모서리·그림자는 CanvasViewport.module.css(일반 CSS)로 처리하고, 이 파일은 그 안의
// <canvas> 하나에 "맵 축소판 + 뷰포트 사각형"만 그립니다.
import type { MapDoc } from '@/lib/model/types'
import { computeFitPxPerMm, type Viewport } from './viewport'
import { mapSizeMm } from './drawBoard'
import type { TokenName } from './cssTokens'

export interface PixelSize {
  width: number
  height: number
}

/** 미니맵 폭을 고정(PRD: 160px)하고, 맵 종횡비에 맞춰 높이를 계산합니다. */
export function computeMinimapSize(mapWmm: number, mapHmm: number, widthPx: number): PixelSize {
  return { width: widthPx, height: widthPx * (mapHmm / mapWmm) }
}

/** 지금 배율이 "맞춤" 배율 이하면 미니맵을 숨깁니다(PRD 명시) — 이미 맵 전체가 화면에
 *  다 보이는 상태라 미니맵이 알려줄 정보가 없기 때문입니다. */
export function shouldShowMinimap(viewport: Viewport, bodySize: PixelSize, mapWmm: number, mapHmm: number): boolean {
  const fitScale = computeFitPxPerMm(bodySize.width, bodySize.height, mapWmm, mapHmm)
  const EPS = 1e-6 // 부동소수점으로 인해 "정확히 맞춤 배율"인데 미세하게 더 크게 나와 깜빡이는 것 방지
  return viewport.pxPerMm > fitScale + EPS
}

/** 미니맵 캔버스 내용을 그립니다. bodySize는 본체(캔버스 몸통)의 CSS 픽셀 크기,
 *  minimapSize는 이 미니맵 캔버스 자체의 크기입니다. */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  doc: MapDoc,
  bodySize: PixelSize,
  minimapSize: PixelSize,
  tokens: Record<TokenName, string>,
): void {
  const { wMm } = mapSizeMm(doc)
  const scale = minimapSize.width / wMm // 미니맵 안에서 "1mm가 몇 px인지" (본체의 pxPerMm과는 다른, 미니맵 전용 축척)

  ctx.clearRect(0, 0, minimapSize.width, minimapSize.height)

  // 맵 축소판: 종이 + 칸 경계선(구조를 알아볼 수 있을 정도로만 옅게)
  ctx.fillStyle = tokens['--c-paper']
  ctx.fillRect(0, 0, minimapSize.width, minimapSize.height)

  ctx.strokeStyle = tokens['--c-guide']
  ctx.lineWidth = 1
  for (let c = 1; c < doc.board.cols; c++) {
    const x = c * doc.board.pitch * scale
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, minimapSize.height)
    ctx.stroke()
  }
  for (let r = 1; r < doc.board.rows; r++) {
    const y = r * doc.board.pitch * scale
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(minimapSize.width, y)
    ctx.stroke()
  }

  // 지금 본체 캔버스에 보이는 범위를 mm로 구해서, 같은 좌표를 미니맵 축척으로 그립니다.
  const topLeftMm = viewport.screenToMap(0, 0)
  const bottomRightMm = viewport.screenToMap(bodySize.width, bodySize.height)
  const x1 = topLeftMm.mx * scale
  const y1 = topLeftMm.my * scale
  const x2 = bottomRightMm.mx * scale
  const y2 = bottomRightMm.my * scale

  ctx.strokeStyle = tokens['--c-primary']
  ctx.lineWidth = 2
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
}
