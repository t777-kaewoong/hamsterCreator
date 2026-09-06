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
import { MARKER_OUTER_DIAMETER_MM, nodeCenterMm } from './drawBoard'
import type { OverlayState } from './toolInteractions'
import { drawStrokePath } from './strokeGeometry'

type Tokens = Record<TokenName, string>

/** 칸 크기 칩(예: "3 × 4")에 쓰는 글자. ruler.ts의 TICK_FONT와 같은 micro 타이포(§9.4:
 *  11px, weight 600) + 같은 폴백 스택입니다. 캔버스는 CSS 클래스를 못 써서 폰트 문자열을
 *  직접 적어야 합니다. */
const CHIP_FONT = '600 11px Pretendard, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif'
/** 캔버스 빈 상태는 UI의 body 타이포(14px/400)를 캔버스 문자열로 옮긴 값입니다. */
const EMPTY_STATE_FONT = '400 14px Pretendard, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif'
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

  // §9.15 캔버스 빈 상태. 실제 문서 요소가 아니라 화면 전용 overlay에만 그려서 저장 파일·
  // 미리보기·PDF에는 절대 포함되지 않습니다. Shift 자유 배치도 "첫 배치"이므로 cells뿐
  // 아니라 props까지 비었을 때만 표시합니다. 라벨·선·마커는 타일 아트가 아니어서 제외합니다.
  if (doc.cells.every((cell) => cell === null) && doc.props.length === 0) {
    const center = viewport.mapToScreen((doc.board.cols * pitch) / 2, (doc.board.rows * pitch) / 2)
    ctx.save()
    ctx.font = EMPTY_STATE_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = tokens['--c-text-3']
    ctx.fillText('왼쪽에서 타일을 골라 칠해 보세요', center.x, center.y)
    ctx.restore()
  }

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

  // ②-2 Shift 자유 배치 고스트(FR-3.8) — 스탬프 고스트와 겉모습(불투명도 0.55 +
  //     2px 파선 테두리)은 같지만, 칸 좌상단이 아니라 "커서 = 이 오브젝트의 중심"이 되도록
  //     그립니다. 격자를 무시하는 배치라 stampGhost와 달리 칸 좌표(c, r) 대신 mm 좌표를 씁니다.
  if (overlay.freePropGhost) {
    const { mx, my, tileId, rot, flip } = overlay.freePropGhost
    const center = viewport.mapToScreen(mx, my)
    const bitmap = tileBitmapCache.get(tileId)

    if (bitmap) {
      ctx.save()
      ctx.globalAlpha = Number(tokens['--c-ghost']) || 0.55
      ctx.translate(center.x, center.y)
      if (rot !== 0) ctx.rotate((rot * Math.PI) / 180)
      if (flip) ctx.scale(-1, 1)
      ctx.drawImage(bitmap, -sizePx / 2, -sizePx / 2, sizePx, sizePx)
      ctx.restore()
    }

    ctx.save()
    ctx.strokeStyle = tokens['--c-primary']
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.strokeRect(center.x - sizePx / 2, center.y - sizePx / 2, sizePx, sizePx)
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

  // ⑤ M(마커) 도구 미리보기 — 지금 클릭하면 어느 노드에 무엇이(출발/도착) 찍힐지
  //    점선 원 + 글자 칩으로 보여줍니다. 원 크기는 drawBoard.ts가 실제로 그리는 마커
  //    (MARKER_OUTER_DIAMETER_MM)와 반드시 같아야 "미리보기 자리 그대로 찍힌다"는
  //    믿음이 깨지지 않습니다.
  if (overlay.markerGhost) {
    const { c, r, mode } = overlay.markerGhost
    const center = nodeCenterMm(c, r, doc.board.pitch)
    const p = viewport.mapToScreen(center.mx, center.my)
    const radiusPx = viewport.mmToPx(MARKER_OUTER_DIAMETER_MM / 2)

    ctx.save()
    ctx.strokeStyle = tokens['--c-primary']
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    const chipText = mode === 'start' ? '출발' : '도착'
    ctx.save()
    ctx.font = CHIP_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const textWidth = ctx.measureText(chipText).width
    const paddingX = 8
    const chipH = 20
    const chipW = textWidth + paddingX * 2
    const chipCenterY = p.y - radiusPx - chipH / 2 - 4 // 원 위쪽에 살짝 띄워서 배치
    tracePillPath(ctx, p.x - chipW / 2, chipCenterY - chipH / 2, chipW, chipH, chipH / 2)
    ctx.fillStyle = tokens['--c-primary']
    ctx.fill()
    ctx.fillStyle = tokens['--c-text-inverse']
    ctx.fillText(chipText, p.x, chipCenterY + 1)
    ctx.restore()
  }

  // P/D 경로는 확정 전까지 문서에 넣지 않고 primary 색 미리보기로만 보여줍니다.
  if (overlay.curveDraft) {
    const { points, hoverPoint, mode, width } = overlay.curveDraft
    const previewPoints = hoverPoint ? [...points, hoverPoint] : points
    if (previewPoints.length >= 2) {
      ctx.save()
      ctx.globalAlpha = LINE_PREVIEW_ALPHA
      ctx.strokeStyle = tokens['--c-primary']
      ctx.lineWidth = viewport.mmToPx(width)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      drawStrokePath(ctx, viewport, { id: '__draft__', kind: 'spline', points: previewPoints, width, closed: false })
      ctx.restore()
    }

    // P는 클릭한 정점을 명시적으로 보여주고, D는 손 궤적 자체가 충분한 피드백이라 생략합니다.
    if (mode === 'pen') {
      ctx.save()
      ctx.fillStyle = tokens['--c-surface']
      ctx.strokeStyle = tokens['--c-primary']
      ctx.lineWidth = 2
      for (const [mx, my] of points) {
        const p = viewport.mapToScreen(mx, my)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  // O 도형은 pointerup 전까지 primary 색 반투명 경로로만 보여줍니다.
  if (overlay.shapeDraft) {
    ctx.save()
    ctx.globalAlpha = LINE_PREVIEW_ALPHA
    ctx.strokeStyle = tokens['--c-primary']
    ctx.lineWidth = viewport.mmToPx(overlay.shapeDraft.width)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    drawStrokePath(ctx, viewport, overlay.shapeDraft)
    ctx.restore()
  }

  // 선택한 곡선은 본체 윤곽과 7px 정점 원으로 표시합니다(§9.12 곡선 편집 오버레이).
  if (overlay.strokeSelection) {
    const stroke = overlay.strokeSelection
    ctx.save()
    ctx.globalAlpha = 0.8
    ctx.strokeStyle = tokens['--c-primary']
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    drawStrokePath(ctx, viewport, stroke)
    ctx.restore()

    if (stroke.kind === 'spline' || stroke.kind === 'line') {
      ctx.save()
      ctx.fillStyle = tokens['--c-surface']
      ctx.strokeStyle = tokens['--c-primary']
      ctx.lineWidth = 2
      for (const [mx, my] of stroke.points) {
        const p = viewport.mapToScreen(mx, my)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  // ⑥ V(선택) 도구 윤곽 — 2px 실선 사각형 + 8px 모서리 정사각 핸들(PRD §9.12 "객체
  //    선택" 행은 핸들을 8px로 명시하지만, 이 작업 지시는 6px로 정해 그 값을 그대로
  //    따랐습니다 — §9.13 인스펙터가 아직 없어 실제 리사이즈 동작이 없는 지금 단계에서는
  //    순전히 "이게 선택 가능한 오브젝트다"를 알려주는 장식이라 정확한 px 값의 실익이
  //    크지 않다고 판단했습니다). 핸들을 드래그해 크기를 바꾸는 기능은 아직 없습니다 —
  //    지금은 장식일 뿐이고, 실제 리사이즈는 인스펙터의 수치 입력으로만 합니다.
  if (overlay.selectionBox) {
    const { mx, my, wMm, hMm, rot } = overlay.selectionBox
    const center = viewport.mapToScreen(mx, my)
    const wPx = viewport.mmToPx(wMm)
    const hPx = viewport.mmToPx(hMm)

    ctx.save()
    ctx.translate(center.x, center.y)
    if (rot !== 0) ctx.rotate((rot * Math.PI) / 180)
    ctx.strokeStyle = tokens['--c-primary']
    ctx.lineWidth = 2
    ctx.strokeRect(-wPx / 2, -hPx / 2, wPx, hPx)

    // 모서리 핸들 크기(화면 px). PRD §9.12 오버레이 표의 "객체 선택 = 2px --c-primary
    // 윤곽 + 8px 모서리 핸들(흰 채움, 1.5px --c-primary 테두리)" 수치 그대로입니다.
    // 아직 이 핸들을 잡아 끌어 크기를 바꾸는 기능은 없습니다(장식 겸 "선택됨" 표시).
    const handleSize = 8
    const corners: [number, number][] = [
      [-wPx / 2, -hPx / 2],
      [wPx / 2, -hPx / 2],
      [wPx / 2, hPx / 2],
      [-wPx / 2, hPx / 2],
    ]
    ctx.lineWidth = 1.5
    ctx.fillStyle = tokens['--c-surface']
    for (const [hx, hy] of corners) {
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize)
      ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize)
    }
    ctx.restore()
  }

  // ⑦ 검증 경고 위치 강조(§9.12 표 "검증 경고 위치" 행을 그대로 구현) — 인스펙터 검증
  //    섹션(§9.13)에서 항목을 클릭하면 CanvasViewport.tsx가 이 필드를 짧은 간격으로
  //    채웠다 비웠다 해서(타이머) 0.6초짜리 깜빡임을 만듭니다. 그래서 이 블록은 매 프레임
  //    "지금 켜져 있으면 그린다"만 담당하고, 언제 켜고 끌지는 전혀 모릅니다.
  if (overlay.focusHighlight) {
    const { c, r } = overlay.focusHighlight
    const topLeft = viewport.mapToScreen(c * pitch, r * pitch)
    ctx.save()
    ctx.fillStyle = tokens['--c-warn-zone']
    ctx.fillRect(topLeft.x, topLeft.y, sizePx, sizePx)
    ctx.strokeStyle = tokens['--c-warn']
    ctx.lineWidth = 2
    ctx.strokeRect(topLeft.x, topLeft.y, sizePx, sizePx)
    ctx.restore()
  }
}
