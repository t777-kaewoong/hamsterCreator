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

/** ③-2 자유 배치 오브젝트(props, FR-3.8). Shift로 격자를 무시하고 놓은 아이콘·타일·
 *  이미지를 자기 x/y/w/h/rot 값 그대로 그립니다(§5 렌더 순서: cells→strokes→edges→
 *  props→labels 중 이 파일이 담당하는 부분. 이 앱의 레이어 합성 순서(renderer.ts)에서는
 *  격자선과 같은 'grid' 다음 'props' 레이어에 해당합니다).
 *
 *  [cells와 props를 나눠 쓰는 이유] cells는 50mm 격자 칸에 딱 맞물려야 하는 바닥·벽
 *  타일용(D3: 인덱스 = r*cols+c로 칸 위치가 곧 배열 자리), props는 격자에 갇히지 않고
 *  아무 mm 좌표에나 놓이는 오브젝트용입니다. 두 배열을 분리해두면 "이 칸에 뭐가
 *  있는지"(cells)와 "자유롭게 놓인 게 뭐가 있는지"(props)를 서로 다른 방식으로 다룰 수
 *  있습니다 — 격자 칸은 인덱스로 바로 찾고, 프롭은 좌표·크기를 직접 들고 다닙니다.
 *
 *  [타일 캐시를 그대로 재사용] Prop.asset은 Cell.art와 같은 문자열 규칙(내장 타일 id·
 *  "icon/이름"·"asset:u1")을 씁니다. 지금은 내장 타일만 tileBitmapCache에 미리
 *  디코드돼 있어 실제로 그려지고, 아이콘·사용자 이미지는 이 단계 이전부터 이미 같은
 *  한계가 있었습니다(칸 아트도 마찬가지) — 이 단계에서 새로 생긴 제약이 아닙니다.
 */
export function drawPropsLayer(ctx: CanvasRenderingContext2D, viewport: Viewport, doc: MapDoc): void {
  for (const prop of doc.props) {
    const bitmap = tileBitmapCache.get(prop.asset)
    if (!bitmap) continue // 아직 디코드 전이거나(로드 완료 시 다시 그려짐) 캐시에 없는 종류

    const wPx = viewport.mmToPx(prop.w)
    const hPx = viewport.mmToPx(prop.h)
    const topLeft = viewport.mapToScreen(prop.x, prop.y)
    const centerX = topLeft.x + wPx / 2
    const centerY = topLeft.y + hPx / 2

    ctx.save()
    ctx.translate(centerX, centerY)
    if (prop.rot !== 0) ctx.rotate((prop.rot * Math.PI) / 180)
    if (prop.flip) ctx.scale(-1, 1)
    ctx.drawImage(bitmap, -wPx / 2, -hPx / 2, wPx, hPx)
    ctx.restore()
  }
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
  ctx.fillStyle = tokens['--c-print-black']
  ctx.lineWidth = widthPx
  // ⚠ 선 끝은 반드시 'butt'(딱 끊기)여야 합니다.
  //   'round'나 'square'로 두면 선이 끝점보다 "선폭의 절반"(8mm 선이면 4mm)만큼 더 길어집니다.
  //   화면에서는 티가 안 나지만 인쇄물의 실제 치수가 달라져서, 로봇이 칸 수를 세는
  //   board_forward() 동작과 어긋나게 됩니다. 로보메이션 공식 말판도 네모난 끝을 씁니다.
  ctx.lineCap = 'butt'

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

  // 교차점 메우기.
  // 선 끝을 'butt'으로 끊으면, 선이 꺾이는 자리에 선폭의 절반짜리 정사각형 빈틈이 생깁니다.
  // (가로 선은 노드까지만 오고, 세로 선은 노드부터 시작하므로 모서리 한 귀퉁이가 비어 보임)
  // 그래서 선이 2개 이상 만나는 노드에만 선폭 크기의 정사각형을 채워 넣습니다.
  // 선이 1개뿐인 노드(막다른 길)는 채우지 않습니다 — 채우면 선이 4mm 길어져 버립니다.
  const degree = new Map<string, number>()
  const bump = (c: number, r: number) => {
    const k = `${c},${r}`
    degree.set(k, (degree.get(k) ?? 0) + 1)
  }
  for (const [c, r] of doc.edges.h) {
    bump(c, r)
    bump(c + 1, r)
  }
  for (const [c, r] of doc.edges.v) {
    bump(c, r)
    bump(c, r + 1)
  }
  for (const stub of doc.stubs) bump(stub.node[0], stub.node[1])

  for (const [key, deg] of degree) {
    if (deg < 2) continue // 막다른 길은 건너뜀
    const [c, r] = key.split(',').map(Number)
    const center = nodeCenterMm(c, r, pitch)
    const p = viewport.mapToScreen(center.mx, center.my)
    ctx.fillRect(p.x - widthPx / 2, p.y - widthPx / 2, widthPx, widthPx)
  }

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
