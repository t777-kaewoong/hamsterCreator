// 맵 문서(.hsmap.json)의 타입 정의.
// PRD §5(데이터 모델)의 JSON 스키마를 TypeScript 타입으로 그대로 옮긴 것이라, 필드를
// 추가·변경할 때는 반드시 PRD §5도 같이 고쳐서 둘이 어긋나지 않게 하세요.
// 좌표 단위는 특별히 표시하지 않는 한 전부 mm이고, 원점은 맵 좌상단입니다(D1).
//
// 렌더 순서(고정, PRD §5): 흰 배경 → cells 아트 → strokes → edges → props → labels → markers

/** mm 좌표 한 점. [x, y] */
export type Point = [x: number, y: number]

/** 격자 노드(=칸 중심) 좌표. [col, row]. mm이 아니라 격자 칸 인덱스(정수)입니다.
 *  D2: 셀 (c,r)의 중심 mm 좌표 = (c·pitch + pitch/2, r·pitch + pitch/2) = 이 노드 위치. */
export type NodeCoord = [col: number, row: number]

/** 4방향. 출발 방향(FR-4.3), 진입로(stub) 방향에 씀 */
export type Direction = 'N' | 'E' | 'S' | 'W'

// ── 메타 정보 ──────────────────────────────────────────────────────────

/** 맵 파일의 부가 정보. */
export interface MapMeta {
  /** 말판 제목. 파일명 생성에도 씀(<제목>.hsmap.json, §4.2) */
  title: string
  /** 자유 메모 필드. PRD에 구체 용도 설명이 없어 "수업 단원/차시" 등을 적는 자유 텍스트로
   *  해석했습니다(임의 해석 — 사용자가 원하는 대로 써도 무방) */
  unit: string
  /** 자유 메모 */
  note: string
  /** 최초 생성 시각. ISO 8601 문자열 */
  createdAt: string
  /** 마지막 저장 시각. ISO 8601 문자열 */
  updatedAt: string
}

// ── 격자(board) ────────────────────────────────────────────────────────

/** 격자 판 설정. */
export interface BoardConfig {
  /** 열 개수(가로 칸 수) */
  cols: number
  /** 행 개수(세로 칸 수) */
  rows: number
  /** 칸 크기(mm). 기본 50(PITCH_MM). D6: 이 값과 다르면 경고 */
  pitch: number
  /** 격자선 폭(mm). 기본 8(LINE_WIDTH_MM). D6: 이 값과 다르면 경고 */
  lineWidth: number
}

/** 격자 한 칸에 놓인 타일. */
export interface Cell {
  /** 타일 아이디. 내장 타일은 "테마/이름"(예: "dungeon/stone_a", D7),
   *  사용자 업로드 이미지는 "asset:u1"처럼 userAssets 키를 참조(D4) */
  art: string
  /** 시계방향 회전(도). 타일은 격자에 맞물려야 해서 90도 단위로만 회전(FR-3.4) */
  rot: 0 | 90 | 180 | 270
  /** 좌우 반전 여부(FR-3.4, F 키) */
  flip: boolean
}

/** 격자 엣지(칸과 칸 사이에 실제로 존재하는 통로/선).
 *  D5: 여기 기록된 것만 "선이 있다"는 뜻이고, 기록이 없으면 벽(막힘)입니다.
 *
 *  좌표 해석(이 문서에서 정한 규칙 — PRD 예시가 h/v 배열 형태만 보여줄 뿐 정확한 의미를
 *  명시하지 않아 D2의 "셀 중심=격자 노드"를 근거로 다음과 같이 정했습니다):
 *  - h의 [c, r] = 노드 (c, r) ↔ (c+1, r) 사이의 가로 연결. c 범위: 0 ~ cols-2
 *  - v의 [c, r] = 노드 (c, r) ↔ (c, r+1) 사이의 세로 연결. r 범위: 0 ~ rows-2 */
export interface Edges {
  h: NodeCoord[]
  v: NodeCoord[]
}

/** 격자 바깥 경계로 나가는 진입로(FR-2.4). 라인트레이서 트랙과 격자를 잇는 지점 등에 씀. */
export interface Stub {
  /** 진입로가 붙어있는 격자 노드 */
  node: NodeCoord
  /** 그 노드에서 바깥쪽으로 나가는 방향 */
  dir: Direction
}

// ── 자유곡선(strokes) ─────────────────────────────────────────────────

/** 모든 자유곡선(stroke)이 공통으로 갖는 필드. */
interface StrokeBase {
  /** 자유곡선 고유 id. 실행취소·정점 편집에서 어떤 곡선인지 식별하는 용도 */
  id: string
  /** 선폭(mm). 기본 8(D8). FR-10.5: 이 값을 바꾸면 경고 */
  width: number
}

/** 펜/자유 그리기로 만든 스플라인 곡선(FR-10.1, FR-10.2). */
export interface SplineStroke extends StrokeBase {
  kind: 'spline'
  /** 정점 목록(mm). 정점 사이를 부드러운 곡선으로 스무딩해서 그림 */
  points: Point[]
  /** true면 마지막 점과 첫 점을 이어 닫힌 도형으로 취급 */
  closed: boolean
}

/** 직선 구간(FR-10.3). 보통 points는 [시작점, 끝점] 2개. */
export interface LineStroke extends StrokeBase {
  kind: 'line'
  points: Point[]
}

/** 원(FR-10.3, FR-10.7의 Ø100/130/150 프리셋 등). */
export interface CircleStroke extends StrokeBase {
  kind: 'circle'
  /** 중심 x(mm) */
  cx: number
  /** 중심 y(mm) */
  cy: number
  /** 반경(mm). FR-10.8: MIN_CURVE_RADIUS_MM(50) 미만이면 경고 */
  r: number
}

/** 타원(FR-10.3, FR-10.7의 230×150 타원 등). */
export interface EllipseStroke extends StrokeBase {
  kind: 'ellipse'
  /** 중심 x(mm) */
  cx: number
  /** 중심 y(mm) */
  cy: number
  /** 가로 반경(mm) */
  rx: number
  /** 세로 반경(mm) */
  ry: number
}

/** 자유곡선 하나. kind로 구분되는 판별 유니온이라, 코드에서
 *  `if (stroke.kind === 'circle')` 처럼 좁히면 cx/cy/r 같은 전용 필드에 안전하게 접근됩니다. */
export type Stroke = SplineStroke | LineStroke | CircleStroke | EllipseStroke

// ── 오브젝트(props) · 라벨 ─────────────────────────────────────────────

/** 격자 칸에 갇히지 않고 자유 좌표에 놓이는 아이콘/이미지(FR-3, §5 예시의 props). */
export interface Prop {
  /** 아이콘/이미지 아이디. 내장 아이콘은 "icon/이름", 사용자 이미지는 "asset:u1" */
  asset: string
  /** 좌상단 x(mm) */
  x: number
  /** 좌상단 y(mm) */
  y: number
  /** 폭(mm) */
  w: number
  /** 높이(mm) */
  h: number
  /** 회전각(도). 자유 배치 오브젝트라 90도 단위로 제한하지 않음 */
  rot: number
}

/** 텍스트 라벨(FR-4.1, FR-4.2). */
export interface Label {
  /** 표시할 글자 */
  text: string
  /** x(mm) */
  x: number
  /** y(mm) */
  y: number
  /** 회전각(도) */
  rot: number
  /** 글자 크기. PRD 예시가 "size": 8처럼 mm 단위 다른 값들과 같은 자리에 있어 mm 기준으로
   *  해석했습니다(단위 명시 없음 — 임의 해석) */
  size: number
  /** 글자색. CSS 색 문자열(예: "#ffffff") */
  color: string
  /** true면 "선 위 흰 글씨" 모드(FR-4.2, 공식 자료의 +2/-3 스타일) */
  onLine: boolean
}

// ── 출발·도착(markers) ────────────────────────────────────────────────

/** 출발 지점(FR-4.3). */
export interface StartMarker {
  cell: NodeCoord
  /** 로봇이 바라보는 방향 */
  heading: Direction
}

/** 도착 지점(FR-4.4). 복수 지정 가능. */
export interface GoalMarker {
  cell: NodeCoord
  /** 도착지 이름(여러 개일 때 구분용) */
  name: string
}

/** 출발·도착 마커 모음. */
export interface Markers {
  /** 아직 출발 지점을 안 정했으면 null(새 맵의 초기 상태) */
  start: StartMarker | null
  goals: GoalMarker[]
}

// ── 사용자 업로드 이미지 ───────────────────────────────────────────────

/** 사용자가 업로드한 이미지 하나. base64 data URL로 파일 안에 직접 내장합니다(D4).
 *  자기 완결성 원칙(§4.2) — 이 파일 하나만 있으면 다른 어떤 리소스 없이도 맵을 다시 그릴 수 있어야 함. */
export interface UserAsset {
  /** 업로드 당시 원본 파일명(표시용) */
  name: string
  /** 원본 이미지 가로 픽셀 */
  w: number
  /** 원본 이미지 세로 픽셀 */
  h: number
  /** "data:image/png;base64,..." 형태의 data URL 원본 */
  dataUrl: string
}

/** userAssets 맵. 키가 "u1"처럼 짧은 id이고, cells/props/labels 등에서는
 *  "asset:u1" 형태로 이 키를 참조합니다(D4). */
export type UserAssets = Record<string, UserAsset>

// ── 출력 설정(print) ──────────────────────────────────────────────────

/** 출력 계획 설정(§4.4, FR-5, FR-6과 연동). */
export interface PrintConfig {
  /** 용지 id. constants.ts의 PAPER_SIZES 항목 id(예: "A4") 또는 사용자 정의를 뜻하는 "custom" */
  sheet: string
  /** 용지 방향 */
  orientation: 'portrait' | 'landscape'
  /** 단일장 출력인지, 여러 장으로 나눠 타일링 출력인지 */
  layout: 'single' | 'tiled'
  /** 이음매 방식(FR-6.7). butt=맞대기(기본), overlap=겹치기 */
  seam: 'butt' | 'overlap'
  /** seam이 'overlap'일 때 겹치는 폭(mm). 'butt'면 0 */
  overlap: number
  /** 재단선·재단 마크 표시 여부(FR-6.4) */
  cropMarks: boolean
  /** 50mm 검증 눈금자 표시 여부(FR-6.5) */
  scaleRuler: boolean
}

// ── 문서 전체 ──────────────────────────────────────────────────────────

/** 맵 문서(.hsmap.json) 전체 구조. PRD §5의 JSON 스키마 그 자체입니다. */
export interface MapDoc {
  /** 스키마 버전 문자열. 예: "hamsterS-map/1". constants.ts의 SCHEMA_VERSION과 비교해서
   *  파일이 지금 앱보다 상위/하위 버전인지 판단합니다(FR-1.10) */
  schema: string
  meta: MapMeta
  board: BoardConfig
  /** 격자 칸 내용. 길이는 반드시 cols×rows, row-major 순서. 빈 칸은 null(D3) */
  cells: (Cell | null)[]
  edges: Edges
  stubs: Stub[]
  strokes: Stroke[]
  props: Prop[]
  labels: Label[]
  markers: Markers
  userAssets: UserAssets
  print: PrintConfig
}
