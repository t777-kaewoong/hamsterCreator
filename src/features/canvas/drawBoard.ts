// 맵의 "정적 요소"를 실제로 그리는 함수들 (PRD §9.12 표).
//
// 여기 있는 함수들은 renderer.ts가 레이어별로 dirty일 때 호출해주는 "그리기 담당자"입니다.
// 화면 좌표 계산은 전부 viewport.ts에 위임하고, 이 파일은 "무엇을 어떤 순서로 그릴지"만
// 담당합니다. 색은 절대 직접 적지 않고 cssTokens.ts에서 읽은 값만 씁니다(단, 마커는
// 예외 — 아래 drawMarkersLayer 주석 참고).
//
// 그리는 것: 종이(아트보드) · 셀 경계 안내선 · 격자 노드 점 · 격자선(+진입로) ·
// 칸에 놓인 아트 타일 · 자유 배치 오브젝트(props) · 텍스트 라벨(labels, FR-4.1/4.2) ·
// 출발·도착 마커(markers, FR-4.3/4.4) · 자유곡선(strokes, FR-10).
import type { Direction, Label, MapDoc } from '@/lib/model/types'
import { getTile } from '@/lib/tiles/catalog'
import type { MapPoint, Viewport } from './viewport'
import type { TokenName } from './cssTokens'
import { parseShadowToken } from './cssTokens'
import { tileBitmapCache } from './tileBitmaps'
import { drawStrokePath } from './strokeGeometry'

/** 이 배율 미만이면 셀 경계 안내선을 숨깁니다(PRD §9.12 표). 너무 축소하면 안내선이
 *  다닥다닥 붙어 화면이 지저분해지기 때문입니다. */
export const GUIDE_MIN_PX_PER_MM = 1.2

/** 격자 노드 점의 지름(화면 CSS px 고정, mm로 안 커짐 — PRD §9.12 표). */
const NODE_DIAMETER_PX = 3

/** 라벨에 쓰는 폰트. typography.css에 400/500/600 세 굵기만 내려받아 두었으므로
 *  그중 가장 굵은 600을 씁니다(작업 지시 명시) — 말판 위 작은 글자는 얇으면 인쇄했을 때
 *  잘 안 보이기 때문입니다. 폴백 스택은 이 파일의 다른 캔버스 폰트 문자열(예:
 *  drawOverlay.ts의 CHIP_FONT)과 통일했습니다. */
const LABEL_FONT_WEIGHT = 600
const LABEL_FONT_FAMILY = 'Pretendard, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif'

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

/**
 * 칸 아트를 격자선 아래/위 두 묶음으로 나눠 그립니다.
 *
 * [왜 TileKind에 따라 나누는가] floor·block은 말판 바닥에 깔리는 그림이라 검은 경로가
 * 위에 보여야 하지만, object는 상자·금화처럼 바닥 위에 놓인 물건이라 경로가 그림을
 * 가리면 안 됩니다. cells 배열은 저장 형식을 바꾸지 않고 그대로 두되, 카탈로그의 kind만
 * 보고 어느 캔버스 레이어에 그릴지를 결정합니다. 카탈로그에 없는 사용자 자산 등은 기존
 * 동작을 보존하기 위해 격자선 아래 아트로 취급합니다.
 */
function drawCellArtGroup(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  doc: MapDoc,
  aboveGrid: boolean,
): void {
  const { cols, pitch } = doc.board
  const sizePx = viewport.mmToPx(pitch)

  doc.cells.forEach((cell, index) => {
    if (!cell) return
    const isObject = getTile(cell.art)?.kind === 'object'
    if (isObject !== aboveGrid) return
    const bitmap = tileBitmapCache.get(cell.art)
    if (!bitmap) return // 아직 디코드 전 — 로드 완료 알림이 두 아트 레이어를 다시 dirty 표시함

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

/** ② 바닥·블록 칸 아트. 50×50mm 칸에 그리며 격자선 아래에 합성합니다. */
export function drawArtLayer(ctx: CanvasRenderingContext2D, viewport: Viewport, doc: MapDoc): void {
  drawCellArtGroup(ctx, viewport, doc, false)
}

/** ④-1 낱개 물건(object) 칸 아트. 같은 cells 데이터지만 격자선 위에 합성합니다. */
export function drawCellObjectsLayer(ctx: CanvasRenderingContext2D, viewport: Viewport, doc: MapDoc): void {
  drawCellArtGroup(ctx, viewport, doc, true)
}

/** ④-2 자유 배치 오브젝트(props, FR-3.8). Shift로 격자를 무시하고 놓은 아이콘·타일·
 *  이미지를 자기 x/y/w/h/rot 값 그대로 그립니다(§5 렌더 순서: floor·block cells →
 *  strokes → edges → object cells → props → labels 중 이 파일이 담당하는 부분. 이 앱의
 *  레이어 합성 순서(renderer.ts)에서는 격자선 다음 'props' 레이어에 해당합니다).
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

/**
 * 라벨 하나의 mm 단위 가로·세로 크기를 잽니다. hitTest.ts(클릭 판정)와 drawLabelsLayer
 * (실제 렌더)가 "이 라벨이 화면에서 얼마나 큰 사각형을 차지하는가"에 대해 서로 다른
 * 기준을 쓰면, 클릭은 되는데 안 그려져 있거나 그 반대인 상황이 생깁니다. 그래서 두 곳이
 * 반드시 이 함수 하나만 공유하도록 export합니다.
 *
 * [줌 배율과 무관해야 하는 이유] hitTest는 항상 mm 좌표만 다루고 지금 화면이 몇 %로
 * 확대돼 있는지 모릅니다(그래야 어느 배율에서 클릭해도 같은 결과가 나옵니다). 그래서
 * viewport.ts가 "배율 100%"의 기준으로 삼은 것과 같은 방식(REFERENCE_PX_PER_MM=1,
 * "1mm = 화면 1px")을 그대로 빌려, 폰트 크기를 label.size(mm) 값 그대로 px 단위에
 * 대입해 측정합니다. 이러면 ctx.measureText가 돌려주는 px 폭이 곧 mm 폭입니다.
 *
 * 세로 크기는 폰트마다 실제 글자 높이(ascent/descent)가 들쭉날쭉해서 그대로 재면
 * 라벨마다 미묘하게 다른 히트박스가 나옵니다. 대신 "size" 값 자체를 글자 높이로
 * 그대로 씁니다 — 애초에 PRD가 size를 "글자 크기"라고 부르므로 자연스러운 근사입니다.
 */
export function measureLabelBoxMm(ctx: CanvasRenderingContext2D, label: Label): { wMm: number; hMm: number } {
  ctx.save()
  ctx.font = `${LABEL_FONT_WEIGHT} ${label.size}px ${LABEL_FONT_FAMILY}`
  // 빈 텍스트(라벨을 막 만들어 아직 아무것도 안 친 상태)도 클릭으로 다시 잡을 수 있도록
  // 공백 한 칸만큼의 최소 히트박스를 줍니다.
  const text = label.text.length > 0 ? label.text : ' '
  const wMm = ctx.measureText(text).width
  ctx.restore()
  return { wMm, hMm: label.size }
}

/**
 * ③-3 텍스트 라벨(labels, FR-4.1/4.2). props 레이어 안에서 props 다음에 이어 그립니다 —
 * §5 고정 렌더 순서(… → props → labels → markers)를 지키면서도, 이 셋을 위해 굳이 새
 * 오프스크린 레이어를 늘리지 않았습니다. renderer.ts의 5레이어는 레이어 하나가 늘 때마다
 * dirty 판정·합성(drawImage) 비용이 함께 늘어나는데, props·labels·markers는 "자유
 * 배치 오브젝트를 다룬다"는 성격이 같아 거의 항상 같은 편집 동작(T/M 도구, 인스펙터)에서
 * 같이 dirty해집니다 — 따로 나눠봤자 실익 없이 레이어 수만 늘어납니다.
 */
export function drawLabelsLayer(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  doc: MapDoc,
  tokens: Tokens,
): void {
  for (const label of doc.labels) {
    if (label.text.length === 0) continue // 방금 만들어 아직 글자를 안 친 라벨은 그릴 게 없음
    const center = viewport.mapToScreen(label.x, label.y)
    const sizePx = viewport.mmToPx(label.size)

    ctx.save()
    ctx.translate(center.x, center.y)
    if (label.rot !== 0) ctx.rotate((label.rot * Math.PI) / 180)
    ctx.font = `${LABEL_FONT_WEIGHT} ${sizePx}px ${LABEL_FONT_FAMILY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (label.onLine) {
      // FR-4.2 "선 위 흰 글씨" 모드(공식 자료의 +2/-3 스타일). 이 모드는 라벨이 검정
      // 격자선(8mm) 위에 놓이는 것을 전제로 하므로, 글자 뒤에 따로 검정 배경 알약을
      // 깔 필요가 없습니다(이미 검정 선이 배경 역할을 합니다). 다만 사용자가 라벨을
      // 선에서 살짝 벗어나게 놓아도(격자에 스냅되지 않는 자유 좌표라 흔한 일) 흰 글씨가
      // 흰 종이 위로 나가는 순간 안 보이게 되므로, 아주 얇은 검은 외곽선을 먼저 그려
      // 최소한의 가독성을 보장합니다. 선폭을 글자 크기의 8%로 정한 것은 PRD 미규정 —
      // 임의로 정함(너무 두꺼우면 획이 뭉개지고, 너무 얇으면 흰 종이 위에서 안 보임).
      ctx.lineWidth = sizePx * 0.08
      ctx.strokeStyle = tokens['--c-print-black']
      ctx.lineJoin = 'round'
      ctx.strokeText(label.text, 0, 0)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label.text, 0, 0)
    } else {
      ctx.fillStyle = label.color
      ctx.fillText(label.text, 0, 0)
    }
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

// ── 출발·도착 마커(markers, FR-4.3/4.4) ─────────────────────────────────
//
// [왜 색을 토큰이 아니라 '#111'로 직접 적는가 — 이 파일의 다른 규칙에 대한 예외]
// 이 파일 맨 위 주석은 "색은 절대 직접 적지 않고 cssTokens.ts에서 읽은 값만 쓴다"고
// 못박았지만, 마커는 화면 전용 표시가 아니라 인쇄물에 그대로 나가는 그림입니다
// (drawGridLayer가 --c-print-black을 쓰는 것과 같은 이유). 게다가 §9.17은 "색에만
// 의존해 구분하지 말 것"을 요구하는데, 흑백 인쇄에서는 --c-ok(초록)나 --c-primary
// (보라) 같은 토큰이 전부 같은 회색으로 뭉개져 버립니다. 그래서 색으로 출발/도착을
// 구분하지 않고 모양(속 빈 원+화살표 vs 겹원 과녁)만으로 구분하며, 색은 인쇄 검정
// 계열 하나(#111)로 통일해 다른 인쇄 요소(격자선 #000)와 아주 살짝만 다르게(순수
// 검정과 구분되는 잉크로 보이도록) 정했습니다.
//
// [34mm/22mm/3mm 크기 — PRD 미규정, 임의로 정함] PRD §9.12 표에는 "출발 마커: 지름
// 28px 원 + 흰 깃발 아이콘"처럼 화면 픽셀 고정 크기가 적혀 있지만, 그 항목은 "상호작용
// 오버레이"(호버·고스트처럼 화면에만 보이고 인쇄되지 않는 것) 표 안에 있습니다. FR-4.3/
// 4.4가 요구하는 마커는 그와 달리 실제 인쇄되는 말판 그림의 일부라서 mm 단위 실크기가
// 있어야 하는데, PRD 어디에도 그 mm 값이 없습니다(이 부분은 §9.12 표와 FR-4 사이의
// 명세 공백입니다). 그래서 이 값들은 임의로 정했습니다 — 칸 한 변이 50mm이므로, 그
// 안에 여백을 넉넉히 두고 들어가면서도 로봇이 실제로 서는 자리임을 눈에 띄게 알려줄
// 크기로 바깥지름 34mm(칸의 68%, 위아래 8mm씩 여백)를 골랐고, 안쪽 원은 과녁처럼
// 뚜렷이 구분되도록 바깥지름의 약 2/3인 22mm로, 선굵기는 격자선(8mm)보다는 가늘지만
// 축소 인쇄해도 끊겨 보이지 않을 3mm로 정했습니다.
export const MARKER_OUTER_DIAMETER_MM = 34
const MARKER_INNER_DIAMETER_MM = 22
const MARKER_RING_WIDTH_MM = 3
const MARKER_LABEL_SIZE_MM = 6
const MARKER_COLOR = '#111'

/** 마커 이름표(글자)를 원 바로 아래 중앙에 그립니다. 출발·도착이 이 부분만 공유합니다. */
function drawMarkerCaption(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  outerRadiusPx: number,
  ringWidthPx: number,
  labelSizePx: number,
  text: string,
): void {
  ctx.save()
  ctx.font = `${LABEL_FONT_WEIGHT} ${labelSizePx}px ${LABEL_FONT_FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'hanging'
  ctx.fillStyle = MARKER_COLOR
  // 원의 테두리 바로 아래(반지름 + 선굵기 절반)에서 시작해 살짝 더 띄웁니다.
  ctx.fillText(text, centerX, centerY + outerRadiusPx + ringWidthPx / 2 + 2)
  ctx.restore()
}

/**
 * ③-4 출발·도착 마커. §5 markers.start/goals를 그대로 읽어 그립니다. markers 데이터
 * 자체는 doc.markers 하나뿐이라 배열 순회 없이 start 하나 + goals 배열만 처리합니다.
 */
export function drawMarkersLayer(ctx: CanvasRenderingContext2D, viewport: Viewport, doc: MapDoc): void {
  const { pitch } = doc.board
  const outerRadiusPx = viewport.mmToPx(MARKER_OUTER_DIAMETER_MM / 2)
  const innerRadiusPx = viewport.mmToPx(MARKER_INNER_DIAMETER_MM / 2)
  const ringWidthPx = viewport.mmToPx(MARKER_RING_WIDTH_MM)
  const labelSizePx = viewport.mmToPx(MARKER_LABEL_SIZE_MM)

  if (doc.markers.start) {
    const { cell, heading } = doc.markers.start
    const center = nodeCenterMm(cell[0], cell[1], pitch)
    const p = viewport.mapToScreen(center.mx, center.my)

    ctx.save()
    ctx.strokeStyle = MARKER_COLOR
    ctx.lineWidth = ringWidthPx
    ctx.beginPath()
    ctx.arc(p.x, p.y, outerRadiusPx, 0, Math.PI * 2)
    ctx.stroke()

    // heading 방향을 가리키는 채운 삼각형 화살표. 원 반지름의 90%를 길이로 삼아
    // 테두리 안쪽에 살짝 여유를 두고 들어가게 했습니다(PRD 미규정 — 임의로 정함).
    const [dx, dy] = DIR_VECTOR[heading]
    const angle = Math.atan2(dy, dx)
    const triTip = outerRadiusPx * 0.9
    const triBack = -outerRadiusPx * 0.5
    const triHalfWidth = outerRadiusPx * 0.45
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(angle)
    ctx.fillStyle = MARKER_COLOR
    ctx.beginPath()
    ctx.moveTo(triTip, 0)
    ctx.lineTo(triBack, triHalfWidth)
    ctx.lineTo(triBack, -triHalfWidth)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    drawMarkerCaption(ctx, p.x, p.y, outerRadiusPx, ringWidthPx, labelSizePx, '출발')
    ctx.restore()
  }

  for (const goal of doc.markers.goals) {
    const center = nodeCenterMm(goal.cell[0], goal.cell[1], pitch)
    const p = viewport.mapToScreen(center.mx, center.my)

    ctx.save()
    ctx.strokeStyle = MARKER_COLOR
    ctx.lineWidth = ringWidthPx
    // 겹원(과녁) — 바깥 원과 안쪽 원을 각각 그립니다.
    ctx.beginPath()
    ctx.arc(p.x, p.y, outerRadiusPx, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, innerRadiusPx, 0, Math.PI * 2)
    ctx.stroke()

    drawMarkerCaption(ctx, p.x, p.y, outerRadiusPx, ringWidthPx, labelSizePx, goal.name || '도착')
    ctx.restore()
  }
}

/** ③ 자유곡선 → 격자선 + 진입로(stub). 같은 오프스크린 레이어 안에서도 PRD §5의
 *  순서를 지켜 곡선을 먼저 그리고, 그 위에 격자선을 그립니다. 둘 다 실제 인쇄되는
 *  검정 선이라 mm 굵기를 배율만큼 그대로 곱합니다. */
export function drawGridLayer(ctx: CanvasRenderingContext2D, viewport: Viewport, doc: MapDoc, tokens: Tokens): void {
  const { pitch, lineWidth } = doc.board

  // 자유곡선은 격자와 달리 끝·이음이 round입니다(FR-10.5). 곡선마다 width를 가질 수
  // 있으므로 한 번에 묶지 않고 각 경로 직전에 실제 mm 선폭을 적용합니다.
  ctx.save()
  ctx.strokeStyle = tokens['--c-print-black']
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of doc.strokes) {
    const strokeWidthPx = viewport.mmToPx(stroke.width)
    if (strokeWidthPx <= 0) continue
    ctx.lineWidth = strokeWidthPx
    drawStrokePath(ctx, viewport, stroke)
  }
  ctx.restore()

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
