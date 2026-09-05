// 맵의 "정적 요소"를 실제로 그리는 함수들 (PRD §9.12 표).
//
// 여기 있는 함수들은 renderer.ts가 레이어별로 dirty일 때 호출해주는 "그리기 담당자"입니다.
// 화면 좌표 계산은 전부 viewport.ts에 위임하고, 이 파일은 "무엇을 어떤 순서로 그릴지"만
// 담당합니다. 색은 절대 직접 적지 않고 cssTokens.ts에서 읽은 값만 씁니다.
//
// 이번 단계에서 그리는 것: 종이(아트보드) · 셀 경계 안내선 · 격자 노드 점 · 격자선(+진입로) ·
// 칸에 놓인 아트 타일. 자유곡선(strokes)·프롭·라벨·마커는 그 데이터를 실제로 만드는 도구가
// 아직 없어서(다음 단계 이후) 이 단계에서는 그리지 않습니다.
import type { Direction, MapDoc } from '@/lib/model/types'
import type { MapPoint, Viewport } from './viewport'
import type { TokenName } from './cssTokens'
import { parseShadowToken } from './cssTokens'
import { tileBitmapCache } from './tileBitmaps'

/** 이 배율 미만이면 셀 경계 안내선을 숨깁니다(PRD §9.12 표). 너무 축소하면 안내선이
 *  다닥다닥 붙어 화면이 지저분해지기 때문입니다. */
export const GUIDE_MIN_PX_PER_MM = 1.2

/** 격자 노드 점의 지름(화면 CSS px 고정, mm로 안 커짐 — PRD §9.12 표). */
const NODE_DIAMETER_PX = 3

type Tokens = Record<TokenName, string>

/** 맵 전체 크기(mm). cols/rows × pitch. (§6.1: "격자 c×r" → 실제 mm 크기) */
export function mapSizeMm(doc: MapDoc): { wMm: number; hMm: number } {
  return { wMm: doc.board.cols * doc.board.pitch, hMm: doc.board.rows * doc.board.pitch }
}

/** 격자 노드(=칸 중심) 좌표(mm). D2: (c,r)의 중심 = (c·pitch + pitch/2, r·pitch + pitch/2). */
export function nodeCenterMm(c: number, r: number, pitch: number): MapPoint {
  return { mx: c * pitch + pitch / 2, my: r * pitch + pitch / 2 }
}

/** ① 종이(아트보드) + 셀 경계 안내선 + 격자 노드 점. */
export function drawPaperLayer(ctx: CanvasRenderingContext2D, viewport: Viewport, doc: MapDoc, tokens: Tokens): void {
  const { wMm, hMm } = mapSizeMm(doc)
  const topLeft = viewport.mapToScreen(0, 0)
  const wPx = viewport.mmToPx(wMm)
  const hPx = viewport.mmToPx(hMm)

  // 종이 배경 + 그림자. PRD는 "그림자 --e2"라고만 되어 있는데 --e2는 CSS box-shadow 문자열
  // ("0 4px 12px rgba(...)")이라 캔버스에 그대로 못 씁니다. parseShadowToken으로 오프셋·
  // 번짐·색을 뽑아 캔버스의 shadowOffsetX/Y·shadowBlur·shadowColor에 나눠 넣는 방식으로
  // "반투명 검정 그림자로 근사"했습니다(작업 지시에 명시된 방법).
  ctx.save()
  const shadow = parseShadowToken(tokens['--e2'])
  if (shadow) {
    ctx.shadowOffsetX = shadow.offsetX
    ctx.shadowOffsetY = shadow.offsetY
    ctx.shadowBlur = shadow.blur
    ctx.shadowColor = shadow.color
  }
  ctx.fillStyle = tokens['--c-paper']
  ctx.fillRect(topLeft.x, topLeft.y, wPx, hPx)
  ctx.restore()

  // 셀 경계 안내선(비인쇄, 1px 고정). 너무 축소하면 숨김.
  if (viewport.pxPerMm >= GUIDE_MIN_PX_PER_MM) {
    ctx.save()
    ctx.strokeStyle = tokens['--c-guide']
    ctx.lineWidth = 1
    for (let c = 1; c < doc.board.cols; c++) {
      const x = viewport.mapToScreen(c * doc.board.pitch, 0).x
      ctx.beginPath()
      ctx.moveTo(x, topLeft.y)
      ctx.lineTo(x, topLeft.y + hPx)
      ctx.stroke()
    }
    for (let r = 1; r < doc.board.rows; r++) {
      const y = viewport.mapToScreen(0, r * doc.board.pitch).y
      ctx.beginPath()
      ctx.moveTo(topLeft.x, y)
      ctx.lineTo(topLeft.x + wPx, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 격자 노드 점 — 로봇이 실제로 서는 지점을 알려주는 핵심 단서라 배율과 무관하게 항상 그림.
  ctx.save()
  ctx.fillStyle = tokens['--c-node']
  const radius = NODE_DIAMETER_PX / 2
  for (let r = 0; r < doc.board.rows; r++) {
    for (let c = 0; c < doc.board.cols; c++) {
      const center = nodeCenterMm(c, r, doc.board.pitch)
      const p = viewport.mapToScreen(center.mx, center.my)
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** ② 칸에 놓인 아트 타일. 50×50mm 칸 영역에 꽉 채워 그립니다. 회전(rot)·좌우반전(flip) 반영. */
export function drawArtLayer(ctx: CanvasRenderingContext2D, viewport: Viewport, doc: MapDoc): void {
  const { cols, pitch } = doc.board
  const sizePx = viewport.mmToPx(pitch)

  doc.cells.forEach((cell, index) => {
    if (!cell) return
    const bitmap = tileBitmapCache.get(cell.art)
    if (!bitmap) return // 아직 디코드 전 — 이번 프레임엔 그리지 않음(로드 완료 시 art 레이어가 다시 dirty 표시됨)

    const c = index % cols
    const r = Math.floor(index / cols)
    const topLeft = viewport.mapToScreen(c * pitch, r * pitch)
    const centerX = topLeft.x + sizePx / 2
    const centerY = topLeft.y + sizePx / 2

    ctx.save()
    ctx.translate(centerX, centerY)
    if (cell.rot !== 0) ctx.rotate((cell.rot * Math.PI) / 180)
    if (cell.flip) ctx.scale(-1, 1)
    ctx.drawImage(bitmap, -sizePx / 2, -sizePx / 2, sizePx, sizePx)
    ctx.restore()
  })
}

/** 방향 문자를 (dx, dy) 단위 벡터로. 맵 좌표는 y가 아래로 증가하므로 N은 -y, S는 +y입니다. */
const DIR_VECTOR: Record<Direction, [number, number]> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0],
}

/** ③ 격자선 + 진입로(stub). 실제 인쇄되는 검정 선이라 mm 굵기를 배율만큼 그대로 곱해 그립니다
 *  (확대하면 같이 굵어짐). 자유곡선(strokes)은 곡선 도구가 생기는 다음 단계 이후에 이 레이어에
 *  추가됩니다. */
export function drawGridLayer(ctx: CanvasRenderingContext2D, viewport: Viewport, doc: MapDoc, tokens: Tokens): void {
  const { pitch, lineWidth } = doc.board
  const widthPx = viewport.mmToPx(lineWidth)
  if (widthPx <= 0) return

  ctx.save()
  ctx.strokeStyle = tokens['--c-print-black']
  ctx.lineWidth = widthPx
  // 트랙 구간끼리 만나는 교차점(격자 노드)에서 각지게 끊기지 않고 둥글게 이어지도록 round 사용.
  ctx.lineCap = 'round'

  const strokeNodeSegment = (aC: number, aR: number, bC: number, bR: number) => {
    const a = nodeCenterMm(aC, aR, pitch)
    const b = nodeCenterMm(bC, bR, pitch)
    const pa = viewport.mapToScreen(a.mx, a.my)
    const pb = viewport.mapToScreen(b.mx, b.my)
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
  }

  // edges.h[c,r] = 노드 (c,r)~(c+1,r) 가로 연결, edges.v[c,r] = 노드 (c,r)~(c,r+1) 세로 연결
  for (const [c, r] of doc.edges.h) strokeNodeSegment(c, r, c + 1, r)
  for (const [c, r] of doc.edges.v) strokeNodeSegment(c, r, c, r + 1)

  // 진입로: 격자 노드에서 맵 바깥으로 반 칸(pitch/2)만큼 더 그은 선
  for (const stub of doc.stubs) {
    const [c, r] = stub.node
    const center = nodeCenterMm(c, r, pitch)
    const [dx, dy] = DIR_VECTOR[stub.dir]
    const half = pitch / 2
    const pa = viewport.mapToScreen(center.mx, center.my)
    const pb = viewport.mapToScreen(center.mx + dx * half, center.my + dy * half)
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
  }

  ctx.restore()
}
