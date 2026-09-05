// 캔버스 상호작용 오버레이 그리기 (PRD §9.12 "상호작용 오버레이" 표).
//
// renderer.ts의 다섯 번째 레이어('overlay')에 그릴 내용을 담당합니다. 실제 맵 문서(doc)를
// 바꾸지 않고 "지금 뭘 하려는 중인지"만 보여줍니다 — 셀 호버 표시, 배치 예정 스탬프
// 고스트, 선 긋기 드래그 중 미리보기(러버밴드), 영역 채우기 드래그 중 사각형+크기 칩.
//
// 이 레이어는 마우스가 움직일 때마다(드래그가 아니어도) 다시 그려지므로, toolInteractions.ts는
// 이 레이어만 markDirty('overlay')해서 종이·아트·격자 레이어를 매번 다시 계산하지 않게
// 합니다. 그래서 이 파일도 무거운 계산 없이 "지금 상태(OverlayState)를 그대로 그리기"만
// 하도록 가볍게 유지해야 합니다.
import type { MapDoc } from '@/lib/model/types'
import type { Viewport } from './viewport'
import type { TokenName } from './cssTokens'
import { tileBitmapCache } from './tileBitmaps'
import type { OverlayState } from './toolInteractions'

type Tokens = Record<TokenName, string>

/** 칸 크기 칩(예: "3 × 4")에 쓰는 글자. ruler.ts의 TICK_FONT와 같은 micro 타이포(§9.4:
 *  11px, weight 600) + 같은 폴백 스택입니다. 캔버스는 CSS 클래스를 못 써서 폰트 문자열을
 *  직접 적어야 합니다. */
const CHIP_FONT = '600 11px Pretendard, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif'
/** 선 긋기 드래그 미리보기 선의 불투명도(PRD §9.12: "불투명도 0.6"). 이 숫자는 색이
 *  아니라 순수한 비율값이라 토큰화 대상이 아닙니다(§9.3의 색 토큰들과 달리 tokens.css에
 *  이 값 전용 변수가 없음). */
const LINE_PREVIEW_ALPHA = 0.6

/** 둥근 사각형 경로. ctx.roundRect가 없는 구형 브라우저도 지원하도록 직접 구현했습니다. */
function tracePillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

export function drawOverlayLayer(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  doc: MapDoc,
  tokens: Tokens,
  overlay: OverlayState,
): void {
  const { pitch } = doc.board
  const sizePx = viewport.mmToPx(pitch)

  // ① 셀 호버 — 타일·지우개 도구에서 지금 가리키고 있는 칸을 옅게 채웁니다.
  if (overlay.hoverCell) {
    const topLeft = viewport.mapToScreen(overlay.hoverCell.c * pitch, overlay.hoverCell.r * pitch)
    ctx.fillStyle = tokens['--c-hover-cell']
    ctx.fillRect(topLeft.x, topLeft.y, sizePx, sizePx)
  }

  // ② 배치 예정(스탬프) 고스트 — 선택한 타일을 옅게 미리 그리고 파선 테두리를 두릅니다.
  if (overlay.stampGhost) {
    const { c, r, tileId, rot, flip } = overlay.stampGhost
    const topLeft = viewport.mapToScreen(c * pitch, r * pitch)
    const centerX = topLeft.x + sizePx / 2
    const centerY = topLeft.y + sizePx / 2
    const bitmap = tileBitmapCache.get(tileId)

    if (bitmap) {
      ctx.save()
      ctx.globalAlpha = Number(tokens['--c-ghost']) || 0.55
      ctx.translate(centerX, centerY)
      if (rot !== 0) ctx.rotate((rot * Math.PI) / 180)
      if (flip) ctx.scale(-1, 1)
      ctx.drawImage(bitmap, -sizePx / 2, -sizePx / 2, sizePx, sizePx)
      ctx.restore()
    }

    // 2px 파선 테두리(PRD 명시). setLineDash의 [4,4]는 항상 "화면 픽셀" 단위라 배율이
    // 바뀌어도 파선 간격이 화면에서 늘 같게 보입니다(변환 좌표계와 무관).
    ctx.save()
    ctx.strokeStyle = tokens['--c-primary']
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.strokeRect(topLeft.x, topLeft.y, sizePx, sizePx)
    ctx.restore()
  }

  // ③ 선 긋기 드래그 미리보기 — 직전에 확정된 노드부터 지금 커서까지 러버밴드 선을 긋습니다.
  //    L 도구는 인접 노드에 닿는 즉시 실제 엣지를 확정 짓기 때문에(즉시 반영), 이 선분은
  //    "다음 걸음이 이어질 방향"을 보여주는 역할을 합니다.
  if (overlay.linePreview) {
    const { fromMx, fromMy, toMx, toMy } = overlay.linePreview
    const a = viewport.mapToScreen(fromMx, fromMy)
    const b = viewport.mapToScreen(toMx, toMy)
    ctx.save()
    ctx.globalAlpha = LINE_PREVIEW_ALPHA
    ctx.strokeStyle = tokens['--c-primary']
    ctx.lineWidth = Math.max(1, viewport.mmToPx(doc.board.lineWidth))
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.restore()
  }

  // ④ 영역 채우기 드래그 사각형 — 옅은 채움 + 실선 테두리 + 중앙 크기 칩("3 × 4").
  if (overlay.fillRect) {
    const { c0, r0, c1, r1 } = overlay.fillRect
    const topLeft = viewport.mapToScreen(c0 * pitch, r0 * pitch)
    const wPx = (c1 - c0 + 1) * sizePx
    const hPx = (r1 - r0 + 1) * sizePx

    ctx.save()
    ctx.fillStyle = tokens['--c-primary-soft']
    ctx.fillRect(topLeft.x, topLeft.y, wPx, hPx)
    ctx.strokeStyle = tokens['--c-primary']
    ctx.lineWidth = 2
    ctx.strokeRect(topLeft.x, topLeft.y, wPx, hPx)
    ctx.restore()

    const cols = c1 - c0 + 1
    const rows = r1 - r0 + 1
    const label = `${cols} × ${rows}`
    const centerX = topLeft.x + wPx / 2
    const centerY = topLeft.y + hPx / 2

    ctx.save()
    ctx.font = CHIP_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const textWidth = ctx.measureText(label).width
    const paddingX = 8
    const chipH = 20
    const chipW = textWidth + paddingX * 2
    tracePillPath(ctx, centerX - chipW / 2, centerY - chipH / 2, chipW, chipH, chipH / 2)
    ctx.fillStyle = tokens['--c-primary']
    ctx.fill()
    ctx.fillStyle = tokens['--c-text-inverse']
    ctx.fillText(label, centerX, centerY + 1)
    ctx.restore()
  }
}
