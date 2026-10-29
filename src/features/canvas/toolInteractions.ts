// 도구 동작 컨트롤러 — 캔버스 위 포인터·키보드 입력을 실제 도구 동작으로 바꿉니다.
// (PRD FR-2 격자 편집, FR-3 오브젝트 배치 ★핵심)
//
// [왜 React 컴포넌트가 아니라 평범한 클래스인가]
// viewport.ts(Viewport)·renderer.ts(LayeredRenderer)와 같은 이유입니다. 포인터 이동마다
// React state를 바꾸면 그때마다 리렌더가 일어나 느려지므로, 이 클래스는 React 바깥에서
// 한 번만 만들어져(CanvasViewport.tsx가 마운트 시 한 번 생성) 인스턴스 필드에 직접 상태를
// 담아두고 필요할 때만 caller가 넘겨준 markDirty/requestRender 콜백으로 "이제 다시
// 그려라"라고 알립니다. 문서(doc)·도구 선택(activeTool)처럼 다른 곳(Zustand 스토어)이
// 갖고 있는 "진짜 상태"는 매번 useEditorStore.getState()로 그때그때 최신값을 읽습니다
// (Zustand는 이 패턴을 공식적으로 지원합니다 — React 렌더와 무관하게 항상 최신 상태).
//
// [실행취소를 "제스처" 단위로 묶는 이유]
// 드래그로 셀 20개를 칠해도 실행취소 1번에 전부 되돌아가야 합니다(FR-3.12). 그래서 매
// 셀을 찍을 때마다 실행취소 스택에 쌓지 않고, pointerdown 시점의 문서를 깊은 복사해
// gestureSnapshot으로만 들고 있다가, pointerup(제스처가 끝나는 순간) 실제로 문서가
// 달라졌을 때만 그 스냅샷 하나를 스토어의 undoStack에 넣습니다.
import type { Cell, GoalMarker, Label, MapDoc, NodeCoord, Point, Prop, StartMarker, Stroke } from '@/lib/model/types'
import { LINE_WIDTH_MM } from '@/lib/model/constants'
import { markerPositionMm, obstaclePreset, obstaclesOf } from '@/lib/model/obstacles'
import { getTile, TILES_BY_THEME } from '@/lib/tiles/catalog'
import { saveDraft } from '@/lib/storage/draft'
import { useEditorStore } from '@/features/editor/editorStore'
import type { Selection, ShapeKind } from '@/features/editor/editorStore'
import type { LayerName } from './renderer'
import type { MapPoint, Viewport } from './viewport'
import { MARKER_OUTER_DIAMETER_MM, nodeCenterMm } from './drawBoard'
import { snapScaledCenter } from '@/lib/tiles/tileScale'
import { hitTest, markerBoxMm, measureLabelBoxMmCached } from './hitTest'
import { closestEditableSegment, simplifyDouglasPeucker, splineControlHandles } from './strokeGeometry'
import {
  areAdjacent,
  cellAtMm,
  clampCellAtMm,
  edgeBetween,
  interpolateMmPoints,
  isInsideBoard,
  nearestEdgeToPoint,
  nearestNode,
  setEdge,
  stubAtPoint,
  toggleEdge,
  type CellCoord,
} from './gridMath'
import { setStub, toggleStub } from '@/lib/model/stubs'
import { crossesSeam, setSeamHalf } from '@/lib/model/sheetLines'
import { applyErase, eraseGroupOf, findEraseTarget } from './eraseTarget'
import type { EraseGroup, EraseTarget } from './eraseTarget'
import {
  applyEditBox,
  copySelection,
  editBoxOf,
  handlePositionMm,
  handlesFor,
  isUniform,
  pasteClip,
  resizeBox,
  translateSelection,
} from './selectionEdit'
import type { ClipItem, EditBox, HandleId } from './selectionEdit'

/** 지금 진행 중인 제스처의 종류. 스포이드(I)·선택(V)은 문서를 바꾸지 않아 제스처로
 *  치지 않습니다(null로 둠 — 실행취소 대상이 아님). */
/** 더블클릭 판정 간격(ms)과 허용 이동 거리(px). isDoubleClick 주석 참고. */
const DOUBLE_CLICK_MS = 450
const DOUBLE_CLICK_SLOP_PX = 8

/** 붙여넣기·복제할 때 원래 자리에서 비켜 놓는 거리(mm). 같은 자리에 겹쳐 놓이면 복사가 됐는지 안 보입니다. */
const PASTE_OFFSET_MM = 10

/** 펜 직선 모드에서 끝점을 격자점에 붙이는 거리(mm). 격자선과 이어 그리기 쉽게(docs/06 §2.4). */
const PEN_NODE_SNAP_MM = 5

/** 선택 핸들을 잡았다고 볼 화면 거리(px). 핸들은 8px 정사각이라 조금 넉넉하게 봅니다. */
const HANDLE_GRAB_PX = 7

/** 도착·장애물을 다시 눌러 지울 때 "같은 것"으로 보는 거리(mm). */
const MARKER_TOGGLE_MM = 10
const OBSTACLE_TOGGLE_MM = 8

/** 마커 미리보기 원 지름(mm). 실제 마커(drawBoard.ts)와 같아야 "미리보기 자리 그대로 찍힌다". */
const MARKER_GHOST_DIAMETER_MM = MARKER_OUTER_DIAMETER_MM

/** 핸들 위치에 맞는 크기 조절 커서. 회전은 무시합니다(대부분 0°라 충분). */
function handleCursor(handle: HandleId): string {
  if (handle.hx === 0) return 'ns-resize'
  if (handle.hy === 0) return 'ew-resize'
  return handle.hx === handle.hy ? 'nwse-resize' : 'nesw-resize'
}

type GestureKind =
  | 'stamp'
  | 'eraser'
  | 'lineDraw'
  | 'fill'
  | 'freeDraw'
  | 'shape'
  | 'strokeEdit'
  | 'move'
  | 'resize'
  | 'penLine'
  | null

/** 선택 도구 끌어 옮기기 상태. 끄는 동안 매번 시작 시점 문서(base)에서 다시 계산합니다 —
 *  이동량을 누적해 더하면 반올림 오차가 쌓이고, 칸 타일은 지나간 칸마다 흔적이 남습니다. */
interface MoveState {
  selection: NonNullable<Selection>
  origin: MapPoint
  /** Ctrl+끌기면 첫 이동 순간 복제본을 만들고 그쪽을 옮깁니다(원본 유지). */
  duplicate: boolean
  /** 복제본을 이미 만들었는지. 만든 뒤의 기준 문서·선택은 base·selection에 들어갑니다. */
  duplicated: boolean
  base: MapDoc
}

interface ResizeState {
  selection: NonNullable<Selection>
  handle: HandleId
  orig: EditBox
  uniform: boolean
  /** 그림(props)은 모서리 핸들일 때 기본으로 비율을 지킵니다(사진이 찌그러지지 않게). */
  ratioByDefault: boolean
  base: MapDoc
}

type StrokeEditTarget = {
  strokeId: string
  vertexIndex: number
  part: 'vertex' | 'handle-in' | 'handle-out'
}

/** overlay 레이어(drawOverlay.ts)가 그대로 읽어서 그리는 "지금 상호작용 중인 상태".
 *  전부 화면 표시용 데이터일 뿐, MapDoc에는 전혀 반영되지 않습니다. */
export interface OverlayState {
  /** 호버 중인 칸(타일·지우개 도구 전용, §9.12 표) */
  hoverCell: CellCoord | null
  /** 배치 예정 스탬프 고스트(B 도구, 격자에 스냅됨) */
  stampGhost: { c: number; r: number; tileId: string; rot: 0 | 90 | 180 | 270; flip: boolean } | null
  /** Shift 자유 배치 고스트(FR-3.8) — 격자를 무시하고 커서(mm 좌표)를 그대로 따라다닙니다.
   *  stampGhost와 배타적으로 하나만 켜집니다(둘 다 "지금 뭘 어디에 찍을지" 미리보기이므로). */
  freePropGhost: { mx: number; my: number; tileId: string; rot: 0 | 90 | 180 | 270; flip: boolean; sizeMm: number } | null
  /** 선 긋기 드래그 중 러버밴드 미리보기(L 도구) */
  linePreview: { fromMx: number; fromMy: number; toMx: number; toMy: number } | null
  /** 영역 채우기 드래그 중 사각 범위(R 도구) */
  fillRect: { c0: number; r0: number; c1: number; r1: number } | null
  /** M(마커) 도구가 지금 누르면 무엇을 어디(mm)에 놓을지. 평소엔 가장 가까운 격자점,
   *  Alt를 누르고 있으면 커서 자리입니다(docs/06 §2.6). 장애물이면 그 지름의 원을 보여 줍니다. */
  markerGhost: { mx: number; my: number; mode: 'start' | 'goal' | 'obstacle'; diameterMm: number } | null
  /** V(선택) 도구가 고른 대상의 윤곽 표시용 사각형(mm 중심 좌표 기준). editorStore의
   *  selection이 바뀔 때마다(도구 조작뿐 아니라 인스펙터 등 React 쪽에서 바뀌어도)
   *  다시 계산해야 하므로, 포인터 이벤트가 아니라 별도의 public 메서드
   *  (syncSelectionOverlay)로 갱신합니다. */
  selectionBox: { mx: number; my: number; wMm: number; hMm: number; rot: number; handles: HandleId[] } | null
  /** P/D 도구의 아직 확정되지 않은 경로. 문서에 넣기 전에도 결과 모양을 볼 수 있게 합니다. */
  curveDraft: { points: Point[]; hoverPoint: Point | null; mode: 'pen' | 'freeDraw'; width: number; straight: boolean } | null
  /** O 도구로 드래그 중인 도형. 확정 전이라 문서에는 아직 포함되지 않습니다. */
  shapeDraft: Stroke | null
  /** 선택한 곡선 본체와 정점을 강조하기 위한 화면 전용 참조. */
  strokeSelection: Stroke | null
  /** 현재 활성 정점. spline이면 이 정점의 입·출력 베지어 핸들도 함께 표시합니다. */
  activeStrokeVertex: { strokeId: string; vertexIndex: number } | null
  /** 인스펙터 검증 섹션(§9.13) 항목을 클릭해 "여기로 이동해서 0.6초간 깜빡여라"라고
   *  요청받은 칸. §9.12 오버레이 표의 "검증 경고 위치" 행(--c-warn-zone 채움 + 2px
   *  실선 --c-warn 윤곽)을 이 용도로 그대로 씁니다. CanvasViewport.tsx가 editorStore의
   *  focusRequest를 구독했다가, 이 필드를 짧은 간격으로 채웠다 비웠다 해서(setInterval)
   *  실제로 눈에 보이는 깜빡임을 만듭니다 — 다른 오버레이와 달리 포인터 이벤트가 아니라
   *  타이머로 갱신되는 유일한 필드입니다. */
  focusHighlight: { c: number; r: number } | null
  /** 지우개(E)가 지금 누르면 지울 대상. 빨갛게 강조해 "무엇이 지워질지" 미리 보여 줍니다. */
  eraseHover: EraseTarget | null
}

/** 클릭인지 드래그인지 구분하는 기준(화면 CSS px). L 도구의 "단순 클릭 = 엣지 토글" 대
 *  "드래그 = 지나간 엣지 켜기"를 가르는 데만 씁니다. */
const CLICK_THRESHOLD_PX = 3

function emptyOverlay(): OverlayState {
  return {
    hoverCell: null,
    stampGhost: null,
    freePropGhost: null,
    linePreview: null,
    fillRect: null,
    markerGhost: null,
    selectionBox: null,
    curveDraft: null,
    shapeDraft: null,
    strokeSelection: null,
    activeStrokeVertex: null,
    focusHighlight: null,
    eraseHover: null,
  }
}

/**
 * Shift 자유 배치(FR-3.8)로 놓일 Prop 객체를 만듭니다. 커서/드롭 위치는 "이 오브젝트의
 * 중심"으로 다루지만, Prop.x/y는 좌상단 기준이라(types.ts 참고) 폭·높이의 절반을 빼서
 * 역산합니다. 크기는 PRD가 자유 배치 오브젝트의 기본 크기를 정하지 않아 격자 한 칸
 * 크기(pitch, 기본 50mm)로 임의로 정했습니다 — 팔레트에서 고르는 타일과 같은 크기로
 * 보이는 편이 자연스럽다고 판단했습니다.
 */
function buildFreeProp(assetId: string, centerMx: number, centerMy: number, sizeMm: number, rot: number, flip: boolean): Prop {
  return {
    asset: assetId,
    // 1mm 단위로 맞춥니다(인스펙터에 긴 소수가 보이지 않게, docs/06 §2.5).
    x: Math.round(centerMx - sizeMm / 2),
    y: Math.round(centerMy - sizeMm / 2),
    w: sizeMm,
    h: sizeMm,
    rot,
    flip,
  }
}

/** 두 MapDoc이 내용까지 완전히 같은지. 이 앱의 맵 문서는 25KB 안팎(§편집기 실행취소
 *  주석 참고)이라 JSON.stringify 비교로도 충분히 빠르고, cells/edges 등 필드별로 따로
 *  비교하는 코드를 유지하지 않아도 되어 훨씬 단순합니다. */
function docsEqual(a: MapDoc, b: MapDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

let strokeIdSequence = 0
function createStrokeId(doc: MapDoc): string {
  let id: string
  do {
    strokeIdSequence += 1
    id = `s_${Date.now().toString(36)}_${strokeIdSequence.toString(36)}`
  } while (doc.strokes.some((stroke) => stroke.id === id))
  return id
}

/**
 * O 도구로 끈 범위에서 도형을 만듭니다. 시작점이 한 모서리, 끝점이 맞은편 모서리입니다.
 * square면(Shift) 가로세로를 같게 맞춥니다 — 타원은 정원, 라운드 사각은 정사각.
 * 모든 값은 1mm 단위로 반올림합니다(후기 13번: 원 지름이 소수점으로 나오던 문제. 예전에는
 * 대각선 길이를 지름으로 써서 거의 항상 무리수였습니다).
 */
function buildShapeStroke(
  kind: ShapeKind,
  start: MapPoint,
  end: MapPoint,
  useDefaultSize: boolean,
  square: boolean,
  id: string,
): Stroke {
  if (useDefaultSize) {
    const cx = Math.round(start.mx)
    const cy = Math.round(start.my)
    if (kind === 'circle') return { id, kind, cx, cy, r: 50, width: LINE_WIDTH_MM }
    if (kind === 'ellipse') return { id, kind, cx, cy, rx: 50, ry: square ? 50 : 35, width: LINE_WIDTH_MM }
    return { id, kind, cx, cy, w: 100, h: square ? 100 : 70, radius: 15, width: LINE_WIDTH_MM }
  }

  const rawW = Math.abs(end.mx - start.mx)
  const rawH = Math.abs(end.my - start.my)
  const uniform = kind === 'circle' || square
  let w = Math.max(2, Math.round(uniform ? Math.max(rawW, rawH) : rawW))
  let h = Math.max(2, Math.round(uniform ? Math.max(rawW, rawH) : rawH))
  if (kind === 'circle') h = w
  // 끝점 쪽으로 펼칩니다(시작 모서리 고정).
  const sx = end.mx >= start.mx ? 1 : -1
  const sy = end.my >= start.my ? 1 : -1
  const cx = Math.round(start.mx + (sx * w) / 2)
  const cy = Math.round(start.my + (sy * h) / 2)
  if (kind === 'circle') return { id, kind, cx, cy, r: w / 2, width: LINE_WIDTH_MM }
  if (kind === 'ellipse') return { id, kind, cx, cy, rx: w / 2, ry: h / 2, width: LINE_WIDTH_MM }
  w = Math.max(2, w)
  h = Math.max(2, h)
  return { id, kind, cx, cy, w, h, radius: Math.min(15, w / 2, h / 2), width: LINE_WIDTH_MM }
}

/** mm 좌표를 종이 안으로 제한합니다(후기 19번: 선이 맵 밖에도 그려지던 문제). */
function clampToBoard(doc: MapDoc, mx: number, my: number): MapPoint {
  const w = doc.board.cols * doc.board.pitch
  const h = doc.board.rows * doc.board.pitch
  return { mx: Math.min(w, Math.max(0, mx)), my: Math.min(h, Math.max(0, my)) }
}

/** from에서 to로 가는 방향을 45° 단위로 고정합니다(Shift, 후기 3번). 길이는 그대로 둡니다. */
function snapAngle45(from: Point, to: MapPoint): MapPoint {
  const dx = to.mx - from[0]
  const dy = to.my - from[1]
  const length = Math.hypot(dx, dy)
  if (length === 0) return to
  const step = Math.PI / 4
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return { mx: from[0] + Math.cos(angle) * length, my: from[1] + Math.sin(angle) * length }
}

export class ToolController {
  /** drawOverlay.ts가 매 프레임 읽어가는 값. 이 객체 자체를 매번 새로 만들지 않고
   *  필드만 갈아끼웁니다(참조를 유지해도 무방 — React state가 아니므로 불변성 필요 없음). */
  overlay: OverlayState = emptyOverlay()

  private activeGesture: GestureKind = null
  /** 제스처 시작 시점(pointerdown)의 문서 깊은 복사본. pointerup에서 지금 문서와 비교해
   *  "정말 바뀐 게 있을 때만" 실행취소 스택에 넣습니다. */
  private gestureSnapshot: MapDoc | null = null
  /** 이 제스처가 Alt를 누른 채 시작됐는지(지우개=엣지 지우기, 선 긋기=지우기, 영역
   *  채우기=랜덤 채우기). pointerdown 시점에 한 번만 고정합니다 — 드래그 도중 Alt를
   *  뗐다 눌렀다 해도 동작이 바뀌지 않아야 예측 가능하기 때문입니다. */
  private gestureAlt = false
  /** 이 제스처가 Shift를 누른 채 시작됐는지(스탬프=격자 무시하고 자유 배치, FR-3.8).
   *  gestureAlt와 같은 이유로 pointerdown 시점에 한 번만 고정합니다. */
  private gestureShift = false
  private dragMoved = false
  private downScreen: { x: number; y: number } | null = null
  /** 가장 최근에 알고 있는 커서 위치(화면 px). 호버 표시·고스트 미리보기를 회전(R)/
   *  반전(F) 키를 눌렀을 때도(마우스를 움직이지 않아도) 즉시 갱신하기 위해 따로 둡니다. */
  private lastScreen: { x: number; y: number } | null = null
  /** 가장 최근에 알고 있는 Shift 키 상태(pointerdown·pointermove에서 매번 갱신). 드래그
   *  중인 제스처의 동작 자체는 gestureShift로 고정되지만, 아직 누르지도 않은 상태에서
   *  "지금 Shift를 누르면 자유 배치로 바뀐다"는 호버 고스트 미리보기는 이 값을 봅니다. */
  private isShiftDown = false
  /** 스탬프·지우개 드래그 중 "직전에 칠한 칸" 인덱스. 같은 칸을 다시 지나가도 중복으로
   *  기록하지 않기 위한 값입니다(같은 칸에 already 같은 타일을 또 써봤자 낭비이고,
   *  나중에 "지나간 칸 개수"를 셀 일이 생기면 이 값이 없으면 셀 수도 없습니다). */
  private lastPaintedIndex: number | null = null
  /** 선 긋기/지우개(Alt) 드래그 중 "직전에 지나간 노드". 다음 노드와 인접하면 그 사이
   *  엣지를 켜거나 끕니다. */
  private lastNode: NodeCoord | null = null
  /** 스탬프·지우개·선 긋기 드래그 중 "직전 pointermove의 mm 좌표". 지금 위치와의 사이를
   *  보간(interpolateMmPoints)해서 빠른 드래그에도 지나간 칸/노드를 하나도 안 건너뛰기
   *  위한 기준점입니다. gestureSnapshot과 마찬가지로 pointerdown에서 첫 값을 넣습니다. */
  private lastPointerMapPt: MapPoint | null = null
  /** Shift 자유 배치(FR-3.8) 드래그 중 "직전에 프롭을 놓은 위치"(mm, 중심 기준). cells와
   *  달리 격자 칸으로 자연히 나뉘지 않아서, 이게 없으면 마우스를 조금만 움직여도 프롭이
   *  촘촘하게 겹쳐 쌓입니다. 그래서 최소 한 칸 크기(pitch)만큼 움직였을 때만 새로
   *  놓습니다(PRD가 자유 배치 드래그의 간격을 규정하지 않아 임의로 정함). */
  private lastFreePropCenter: MapPoint | null = null
  /** 영역 채우기 드래그 시작 칸. */
  private fillStartCell: CellCoord | null = null
  /** P 도구는 여러 번의 클릭이 하나의 곡선이므로 pointerup을 넘어 정점 목록을 유지합니다. */
  private penDraftPoints: Point[] = []
  /** D 도구가 pointerdown~up 사이에 모은 원시 궤적. 종료 시 Douglas-Peucker로 단순화합니다. */
  private freeDrawPoints: Point[] = []
  /** O 도형 드래그의 시작점(mm). */
  private shapeStart: MapPoint | null = null
  /** V 도구로 끌고 있는 정점 또는 베지어 핸들. pointerup까지 하나의 실행취소로 묶습니다. */
  private strokeEditTarget: StrokeEditTarget | null = null
  /** 직전 왼쪽 클릭의 시각(ms)과 화면 위치. 더블클릭을 직접 판정하는 데 씁니다(isDoubleClick). */
  private lastClick: { time: number; x: number; y: number } | null = null
  /** 지우개로 끄는 동안 지울 종류. 처음 누른 대상의 종류로 고정합니다(eraseTarget.ts 주석). */
  private eraseLock: EraseGroup = 'any'
  /** 가장 최근에 알고 있는 Alt 키 상태. 자유 배치·자유 위치 미리보기에 씁니다(isShiftDown과 같은 이유). */
  private isAltDown = false
  /** 선택 도구 끌어 옮기기·크기 조절 상태(docs/06 §2.5). */
  private moveState: MoveState | null = null
  private resizeState: ResizeState | null = null
  /** Ctrl+C로 복사해 둔 항목과, 커서 없이 연달아 붙여넣을 때 몇 번째인지(점점 더 비켜 놓음). */
  private clipboard: ClipItem | null = null
  private pasteCount = 0
  /** 지금 커서 아래에 맞는 마우스 모양. CanvasViewport가 읽어 캔버스 커서로 씁니다. null이면 도구 기본값. */
  hoverCursor: string | null = null

  constructor(
    private readonly viewport: Viewport,
    private readonly getDoc: () => MapDoc | null,
    private readonly markDirty: (...names: LayerName[]) => void,
    private readonly requestRender: () => void,
    /** T(텍스트) 도구가 라벨을 새로 만들거나 기존 라벨을 편집 대상으로 잡았을 때 호출됩니다.
     *  실제 글자 입력창(<input>)은 이 클래스가 DOM을 모르므로 만들 수 없어(React 바깥의
     *  평범한 클래스라는 점은 이 파일 맨 위 주석 참고), CanvasViewport.tsx에 "지금 몇 번
     *  라벨을 편집해야 한다"는 신호만 콜백으로 넘깁니다. isNew가 true이면 이 클릭으로
     *  방금 새로 만든 빈 라벨이라는 뜻이고(Esc로 취소하면 그 라벨을 통째로 지워야 함),
     *  false이면 기존 라벨을 다시 편집하는 것입니다(Esc는 그냥 편집만 취소).
     */
    private readonly onRequestLabelEdit?: (index: number, isNew: boolean) => void,
  ) {}

  // ── 포인터 입력 ──────────────────────────────────────────────────────

  /**
   * 이번 pointerdown이 더블클릭의 두 번째 누름인지.
   *
   * [e.detail을 믿지 않는 이유 — 2026-09-29 "곡선 펜 더블클릭해도 완료 안 됨"]
   * 클릭 횟수(detail)는 mousedown/click에만 채워지고, 크롬의 pointerdown은 항상 0입니다.
   * 그래서 예전 `e.detail >= 2` 검사는 한 번도 참이 된 적이 없었습니다. 운영체제 기본
   * 더블클릭 간격(500ms)보다 조금 짧게, 손떨림을 감안해 8px 안에서 다시 누르면 더블클릭으로 봅니다.
   */
  private isDoubleClick(e: PointerEvent, sx: number, sy: number): boolean {
    if (e.button !== 0) return false
    const now = e.timeStamp
    const prev = this.lastClick
    const isDouble = e.detail >= 2 || (prev !== null && now - prev.time <= DOUBLE_CLICK_MS && Math.hypot(sx - prev.x, sy - prev.y) <= DOUBLE_CLICK_SLOP_PX)
    // 세 번째 누름이 또 더블클릭으로 잡히지 않도록, 더블클릭이면 기록을 비웁니다.
    this.lastClick = isDouble ? null : { time: now, x: sx, y: sy }
    return isDouble
  }

  handlePointerDown(e: PointerEvent, rect: DOMRect): void {
    const doc = this.getDoc()
    if (!doc) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    this.lastScreen = { x: sx, y: sy }
    this.isShiftDown = e.shiftKey
    this.isAltDown = e.altKey
    const mapPt = this.viewport.screenToMap(sx, sy)

    // 우클릭 재사용(FR-3.3) — 지금 고른 도구와 무관하게 항상 동작합니다.
    if (e.button === 2) {
      this.placeRightClickStamp(doc, mapPt)
      this.updateHoverAndGhost()
      this.markDirty('overlay')
      this.requestRender()
      return
    }
    if (e.button !== 0) return

    const { activeTool } = useEditorStore.getState()
    // P 도구의 미완성 정점은 다른 도구로 넘어가면 문서에 남기지 않습니다. 도구 전환을
    // "완료"로 해석하면 실수로 찍은 한 점짜리 경로까지 저장되기 때문입니다.
    if (activeTool !== 'pen' && this.penDraftPoints.length > 0) this.cancelPenDraft()
    const doubleClick = this.isDoubleClick(e, sx, sy)
    this.dragMoved = false
    this.downScreen = { x: sx, y: sy }
    this.gestureAlt = e.altKey
    this.gestureShift = e.shiftKey

    switch (activeTool) {
      case 'stamp': {
        // Shift+드래그 = 사각 영역 채우기(예전 R 도구, docs/06 §2.2).
        if (this.gestureShift) {
          this.activeGesture = 'fill'
          this.gestureSnapshot = structuredClone(doc)
          const start = clampCellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
          this.fillStartCell = start
          this.overlay.fillRect = { c0: start.c, r0: start.r, c1: start.c, r1: start.r }
          break
        }
        this.activeGesture = 'stamp'
        this.gestureSnapshot = structuredClone(doc)
        this.lastPaintedIndex = null
        this.lastPointerMapPt = mapPt
        this.lastFreePropCenter = null
        // FR-3.8 자유 배치: Alt를 누른 채 시작했거나 팔레트 "놓는 자리"가 반 칸·자유면 props에 놓습니다
        // (docs/09 §2.1). 아니면 칸에 칠합니다.
        if (this.freeSpot(doc, mapPt, this.gestureAlt)) this.paintFreePropAt(mapPt)
        else this.paintStampAt(mapPt)
        break
      }

      case 'eraser': {
        this.activeGesture = 'eraser'
        this.gestureSnapshot = structuredClone(doc)
        this.lastPointerMapPt = mapPt
        // Alt는 예전처럼 "선만 지우기"로 남겨 둡니다(손에 익은 사람을 위해).
        const target = findEraseTarget(doc, mapPt.mx, mapPt.my, this.gestureAlt ? 'line' : 'any')
        this.eraseLock = this.gestureAlt ? 'line' : target ? eraseGroupOf(target) : 'any'
        if (target) this.eraseTarget(target)
        break
      }

      case 'lineDraw':
        this.activeGesture = 'lineDraw'
        this.gestureSnapshot = structuredClone(doc)
        this.lastNode = nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        this.lastPointerMapPt = mapPt
        break


      case 'eyedropper':
        // 스포이드는 문서를 바꾸지 않으므로(타일 id를 "읽어오기"만 함) 실행취소 대상인
        // 제스처로 취급하지 않습니다.
        this.pickTile(doc, mapPt)
        break

      case 'select': {
        // ① 크기 핸들(docs/06 §2.5) — 선택 윤곽의 모서리·변 사각형을 잡았는지 먼저 봅니다.
        const currentSelection = useEditorStore.getState().selection
        const handle = currentSelection ? this.hitHandle(doc, currentSelection, sx, sy) : null
        if (currentSelection && handle) {
          const orig = editBoxOf(doc, currentSelection)
          if (orig) {
            this.activeGesture = 'resize'
            this.gestureSnapshot = structuredClone(doc)
            this.resizeState = {
              selection: currentSelection,
              handle,
              orig,
              uniform: isUniform(doc, currentSelection),
              ratioByDefault: currentSelection.kind === 'prop' && handle.hx !== 0 && handle.hy !== 0,
              base: doc,
            }
            break
          }
        }

        const selectedStroke = this.getSelectedEditableStroke(doc)
        const editTarget = selectedStroke ? this.hitStrokeEditTarget(selectedStroke, sx, sy) : null

        if (editTarget) {
          this.overlay.activeStrokeVertex = {
            strokeId: editTarget.strokeId,
            vertexIndex: editTarget.vertexIndex,
          }
          // Alt+정점은 즉시 제거합니다. 핸들에는 Alt 삭제를 적용하지 않아, 핸들 근처에서
          // Alt 키를 잘못 누른 것만으로 정점 자체가 사라지는 일을 막습니다.
          if (e.altKey && editTarget.part === 'vertex') {
            this.deleteStrokeVertex(editTarget.strokeId, editTarget.vertexIndex)
          } else {
            this.activeGesture = 'strokeEdit'
            this.gestureSnapshot = structuredClone(doc)
            this.strokeEditTarget = editTarget
          }
          break
        }

        // 선택된 경로를 더블클릭하면 가장 가까운 실제 곡선 위에 정점을 삽입합니다.
        if (doubleClick && selectedStroke) {
          const nearest = closestEditableSegment(selectedStroke, [mapPt.mx, mapPt.my])
          if (nearest && nearest.distance <= selectedStroke.width / 2 + 2) {
            this.insertStrokeVertex(selectedStroke, nearest.insertIndex, nearest.point)
            break
          }
        }

        // 핸들/정점/추가 동작이 아니면 일반 선택으로 처리합니다. 같은 곡선을 다시 눌러도
        // 활성 정점만 해제되어 전체 경로 선택은 유지됩니다.
        // 선택된 도형·그림·장애물의 상자 안을 누르면 그대로 그것을 잡습니다 — 원은 선 위만
        // 맞는 판정이라, 안쪽을 눌러 옮기려 하면 선택이 풀려 버리기 때문입니다.
        const hit = this.isInsideSelectionBox(doc, currentSelection, mapPt) ? currentSelection : hitTest(doc, mapPt.mx, mapPt.my)
        useEditorStore.getState().setSelection(hit)
        this.overlay.activeStrokeVertex = null
        // 잡은 것이 있으면 끌어 옮기기를 준비합니다. 실제 이동은 3px 넘게 움직였을 때부터.
        if (hit) {
          this.activeGesture = 'move'
          this.gestureSnapshot = structuredClone(doc)
          this.moveState = { selection: hit, origin: mapPt, duplicate: e.ctrlKey || e.metaKey, duplicated: false, base: doc }
        }
        break
      }

      case 'text':
        // T 도구도 그 자리에서 바로 끝나는 즉시 동작이라(우클릭 재사용·M 도구와 같은
        // 성격) activeGesture를 쓰지 않고 pointerdown 안에서 바로 처리합니다.
        this.placeOrEditLabel(doc, mapPt)
        break

      case 'marker':
        // 출발/도착/장애물은 팔레트에서 직접 고릅니다. Alt는 "격자점에 안 붙이기"입니다.
        this.placeMarker(doc, mapPt, e.altKey)
        break

      case 'pen': {
        // 더블클릭의 두 번째 pointerdown에서는 새 점을 하나 더 중복 추가하지 않고, 첫 번째
        // 클릭에서 들어간 끝점을 그대로 사용해 확정합니다. Enter도 같은 finish 경로를 씁니다.
        if (doubleClick) {
          this.finishPenDraft()
          break
        }
        const point = this.penPoint(doc, mapPt, e.shiftKey, e.altKey)
        // 직선 모드에서 아무것도 안 찍은 채 끌면 직선 하나를 바로 만듭니다(docs/06 §2.4).
        // 끌지 않고 떼면 pointerup에서 첫 점으로 넣습니다.
        if (useEditorStore.getState().penMode === 'line' && this.penDraftPoints.length === 0) {
          this.activeGesture = 'penLine'
          this.shapeStart = { mx: point[0], my: point[1] }
          break
        }
        this.addPenPoint(point)
        break
      }

      case 'freeDraw': {
        this.activeGesture = 'freeDraw'
        const p = clampToBoard(doc, mapPt.mx, mapPt.my)
        this.freeDrawPoints = [[p.mx, p.my]]
        this.overlay.curveDraft = {
          points: this.freeDrawPoints.slice(),
          hoverPoint: null,
          mode: 'freeDraw',
          width: LINE_WIDTH_MM,
          straight: false,
        }
        break
      }

      case 'shape': {
        this.activeGesture = 'shape'
        this.gestureSnapshot = structuredClone(doc)
        this.shapeStart = this.shapePoint(doc, mapPt)
        const { activeShape } = useEditorStore.getState()
        this.overlay.shapeDraft = buildShapeStroke(activeShape, this.shapeStart, this.shapeStart, true, e.shiftKey, '__shape_draft__')
        break
      }

      default:
        break
    }

    this.updateHoverAndGhost()
    this.markDirty('overlay')
    this.requestRender()
  }

  handlePointerMove(e: PointerEvent, rect: DOMRect): void {
    const doc = this.getDoc()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    this.lastScreen = { x: sx, y: sy }
    this.isShiftDown = e.shiftKey
    this.isAltDown = e.altKey
    if (!doc) return
    const mapPt = this.viewport.screenToMap(sx, sy)

    if (this.activeGesture && this.downScreen) {
      const dist = Math.hypot(sx - this.downScreen.x, sy - this.downScreen.y)
      if (dist > CLICK_THRESHOLD_PX) this.dragMoved = true
    }

    // 직전 pointermove 이후 지나온 mm 경로. 이 값이 없으면(이론상 pointerdown이 항상
    // 먼저 세팅하므로 안 옴) 보간 없이 지금 위치만 처리합니다.
    const prevPt = this.lastPointerMapPt

    switch (this.activeGesture) {
      case 'stamp':
        // 드래그 보간(왜 필요한지는 interpolateMmPoints 주석 참고): 직전 위치~지금 위치
        // 사이를 pitch/2(기본 25mm) 이하 간격으로 나눠 순서대로 찍습니다. 셀 크기의
        // 절반이라 한 칸을 지나가는 동안 최소 2개 샘플이 찍혀서, 마우스가 아무리 빨리
        // 움직여도(합성 이벤트로 셀 3~4개를 한 번에 건너뛰어도) 지나간 칸을 하나도 놓치지
        // 않습니다. 같은 칸을 여러 샘플이 가리켜도 paintStampAt 내부 중복 방지로 걸러집니다.
        if (this.freeSpot(doc, mapPt, this.gestureAlt)) {
          // FR-3.8: 자유 배치는 격자 개념이 없어서 노드/칸 보간이 아니라 mm 경로를
          // 그대로 보간하고, 각 샘플에서 paintFreePropAt이 "최소 간격" 판단을 합니다.
          if (prevPt) {
            for (const p of interpolateMmPoints(prevPt.mx, prevPt.my, mapPt.mx, mapPt.my, doc.board.pitch / 2)) {
              this.paintFreePropAt(p)
            }
          } else {
            this.paintFreePropAt(mapPt)
          }
        } else if (prevPt) {
          for (const p of interpolateMmPoints(prevPt.mx, prevPt.my, mapPt.mx, mapPt.my, doc.board.pitch / 2)) {
            this.paintStampAt(p)
          }
        } else {
          this.paintStampAt(mapPt)
        }
        this.lastPointerMapPt = mapPt
        break

      case 'eraser': {
        // 빠르게 문질러도 사이의 선 토막을 놓치지 않도록 5mm 간격으로 촘촘히 훑습니다
        // (선 굵기 8mm보다 작아야 토막 하나를 건너뛰지 않습니다).
        const points = prevPt ? interpolateMmPoints(prevPt.mx, prevPt.my, mapPt.mx, mapPt.my, 5) : [mapPt]
        for (const p of points) {
          const fresh = this.getDoc()
          if (!fresh) break
          const target = findEraseTarget(fresh, p.mx, p.my, this.eraseLock)
          if (!target) continue
          // 빈 곳에서 시작했으면 처음 맞힌 종류로 고정합니다.
          if (this.eraseLock === 'any') this.eraseLock = eraseGroupOf(target)
          this.eraseTarget(target)
        }
        this.lastPointerMapPt = mapPt
        break
      }

      case 'lineDraw': {
        // 보간해서 지나간 노드를 전부 밟습니다(stepEdgesAlongPath가 매 샘플마다
        // this.lastNode를 갱신하므로, 아래 프리뷰 선은 항상 "가장 최근에 확정된 노드"에서
        // 시작합니다).
        if (prevPt) this.stepEdgesAlongPath(doc, prevPt.mx, prevPt.my, mapPt.mx, mapPt.my, !this.gestureAlt)
        if (this.lastNode) {
          const from = nodeCenterMm(this.lastNode[0], this.lastNode[1], doc.board.pitch)
          this.overlay.linePreview = { fromMx: from.mx, fromMy: from.my, toMx: mapPt.mx, toMy: mapPt.my }
        }
        this.lastPointerMapPt = mapPt
        break
      }

      case 'fill':
        if (this.fillStartCell) {
          const cur = clampCellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
          this.overlay.fillRect = {
            c0: Math.min(this.fillStartCell.c, cur.c),
            r0: Math.min(this.fillStartCell.r, cur.r),
            c1: Math.max(this.fillStartCell.c, cur.c),
            r1: Math.max(this.fillStartCell.r, cur.r),
          }
        }
        break

      case 'freeDraw': {
        const last = this.freeDrawPoints[this.freeDrawPoints.length - 1]
        const p = clampToBoard(doc, mapPt.mx, mapPt.my)
        // 화면 이벤트가 지나치게 촘촘해도 같은 자리에 수천 점이 쌓이지 않도록 0.5mm 이상
        // 움직였을 때만 원시 궤적에 추가합니다. 최종 단순화는 pointerup에서 별도로 합니다.
        if (!last || Math.hypot(p.mx - last[0], p.my - last[1]) >= 0.5) {
          this.freeDrawPoints.push([p.mx, p.my])
          this.overlay.curveDraft = {
            points: this.freeDrawPoints.slice(),
            hoverPoint: null,
            mode: 'freeDraw',
            width: LINE_WIDTH_MM,
            straight: false,
          }
        }
        break
      }

      case 'shape':
        if (this.shapeStart) {
          const { activeShape } = useEditorStore.getState()
          this.overlay.shapeDraft = buildShapeStroke(
            activeShape,
            this.shapeStart,
            this.shapePoint(doc, mapPt),
            !this.dragMoved,
            e.shiftKey,
            '__shape_draft__',
          )
        }
        break

      case 'penLine':
        // 직선 하나 끌기 미리보기. 시작점부터 지금 커서(각도 고정·격자점 붙이기 적용)까지.
        if (this.shapeStart && this.dragMoved) {
          const end = this.penPoint(doc, mapPt, e.shiftKey, e.altKey, [this.shapeStart.mx, this.shapeStart.my])
          this.overlay.curveDraft = {
            points: [[this.shapeStart.mx, this.shapeStart.my]],
            hoverPoint: end,
            mode: 'pen',
            width: LINE_WIDTH_MM,
            straight: true,
          }
        }
        break

      case 'move':
        if (this.dragMoved) this.updateMove(mapPt)
        break

      case 'resize':
        this.updateResize(mapPt, e.shiftKey)
        break

      case 'strokeEdit':
        if (this.dragMoved) this.updateStrokeEdit(mapPt)
        break

      default:
        break
    }

    this.updateHoverAndGhost()
    this.markDirty('overlay')
    this.requestRender()
  }

  handlePointerUp(e: PointerEvent, rect: DOMRect): void {
    const gestureKind = this.activeGesture
    const snapshot = this.gestureSnapshot
    const doc = this.getDoc()

    if (doc && gestureKind) {
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const mapPt = this.viewport.screenToMap(sx, sy)

      // L 도구: 드래그 없이 그냥 클릭했을 때.
      //
      // 격자 **바깥**을 찍었으면 경계 진입로를 토글하고(FR-2.4), 안쪽이면 가장 가까운
      // 엣지를 토글합니다(FR-2.2). 진입로도 결국 "노드에서 뻗어 나가는 격자선"이라
      // 도구를 따로 만들지 않고 L 하나에 얹었습니다 — 도구 레일이 이미 11개라
      // 12번째를 늘리면 첫 화면이 그만큼 더 복잡해집니다(NFR-10).
      // Alt를 누르고 찍으면 지우기입니다(Alt+드래그가 이미 지우기라 같은 규칙).
      if (gestureKind === 'lineDraw' && !this.dragMoved) {
        const stub = stubAtPoint(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        const fresh = this.getDoc()
        if (fresh) {
          if (stub) {
            const nextStubs = this.gestureAlt ? setStub(fresh.stubs, stub, false) : toggleStub(fresh.stubs, stub)
            if (nextStubs !== fresh.stubs) this.commitDocChange({ ...fresh, stubs: nextStubs })
          } else if (isInsideBoard(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)) {
            // 격자 안쪽일 때만 엣지를 토글합니다.
            //
            // nearestEdgeToPoint는 범위 검사를 하지 않아서, 종이에서 한참 떨어진 빈 곳을
            // 클릭해도 "가장 가까운" 엣지를 찾아 지워 버립니다. 팬을 하려다 살짝 클릭만
            // 되었을 때 엉뚱한 격자선이 사라지는 일이 실제로 생깁니다(FR-2.2는 "엣지 단건
            // 클릭 토글"이지 "아무 데나 클릭해도 토글"이 아닙니다).
            const nearest = nearestEdgeToPoint(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
            if (nearest && crossesSeam(fresh, nearest.kind, nearest.c, nearest.r)) {
              // 종이 이음매를 건너는 토막은 누른 쪽 절반(그 종이 쪽 진입로)만 켜고 끕니다(docs/10).
              // 두 절반이 다 켜지면 온전한 격자선이 됩니다. Alt는 지우기.
              const seamMm = (nearest.kind === 'h' ? nearest.c + 1 : nearest.r + 1) * doc.board.pitch
              const side = (nearest.kind === 'h' ? mapPt.mx : mapPt.my) < seamMm ? 'a' : 'b'
              this.commitDocChange({ ...fresh, ...setSeamHalf(fresh, nearest.kind, nearest.c, nearest.r, side, this.gestureAlt ? false : undefined) })
            } else if (nearest) {
              const nextEdges = toggleEdge(fresh.edges, nearest.kind, nearest.c, nearest.r)
              if (nextEdges !== fresh.edges) this.commitDocChange({ ...fresh, edges: nextEdges })
            }
          }
        }
      }

      // R 도구: 사각 범위를 "놓는" 순간에 실제로 채웁니다(FR-3.5, 3.6).
      if (gestureKind === 'fill' && this.fillStartCell) {
        const endCell = clampCellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        this.commitFill(this.fillStartCell, endCell)
      }

      if (gestureKind === 'freeDraw') {
        const last = this.freeDrawPoints[this.freeDrawPoints.length - 1]
        const p = clampToBoard(doc, mapPt.mx, mapPt.my)
        if (!last || Math.hypot(p.mx - last[0], p.my - last[1]) >= 0.5) {
          this.freeDrawPoints.push([p.mx, p.my])
        }
        this.finishFreeDrawDraft()
      }

      if (gestureKind === 'strokeEdit' && this.dragMoved) this.updateStrokeEdit(mapPt)

      if (gestureKind === 'penLine' && this.shapeStart) {
        const start: Point = [this.shapeStart.mx, this.shapeStart.my]
        if (this.dragMoved) {
          const end = this.penPoint(doc, mapPt, e.shiftKey, e.altKey, start)
          if (Math.hypot(end[0] - start[0], end[1] - start[1]) >= 1) this.commitPenStroke([start, end], true)
        } else {
          // 끌지 않았으면 꺾은선의 첫 점입니다. 이어서 클릭하면 점이 늘어납니다.
          this.addPenPoint(start)
        }
      }

      if (gestureKind === 'move' || gestureKind === 'resize') {
        // 끄는 동안에는 초안 저장을 미뤘다가(매 이동마다 쓰면 느림) 끝날 때 한 번 씁니다.
        const after = this.getDoc()
        if (after && snapshot && !docsEqual(snapshot, after)) saveDraft(after)
      }

      if (gestureKind === 'shape' && this.shapeStart) {
        const fresh = this.getDoc()
        if (fresh) {
          const { activeShape } = useEditorStore.getState()
          const stroke = buildShapeStroke(
            activeShape,
            this.shapeStart,
            this.shapePoint(fresh, mapPt),
            !this.dragMoved,
            e.shiftKey,
            createStrokeId(fresh),
          )
          this.commitDocChange({ ...fresh, strokes: [...fresh.strokes, stroke] })
          // 그린 직후 곧바로 옮기거나 크기를 바꾸는 경우가 대부분이라 선택 도구로 넘깁니다(후기 10번).
          useEditorStore.getState().setTool('select')
          useEditorStore.getState().setSelection({ kind: 'stroke', id: stroke.id })
        }
      }
    }

    // 제스처 시작~끝 사이에 실제로 문서가 달라졌을 때만 실행취소 스택에 하나 쌓습니다.
    if (snapshot) {
      const after = this.getDoc()
      if (after && !docsEqual(snapshot, after)) {
        useEditorStore.getState().pushUndoSnapshot(snapshot)
      }
    }

    this.resetGestureState()
    this.updateHoverAndGhost()
    this.markDirty('overlay')
    this.requestRender()
  }

  /** 캔버스 밖으로 포인터가 나갔을 때. 드래그 중이면 무시합니다 — 포인터 캡처
   *  덕분에 화면 밖으로 나가도 pointerup/pointermove는 계속 이 요소로 들어오므로,
   *  여기서 오버레이를 지워버리면 드래그 도중 고스트/미리보기가 깜빡이며 사라집니다. */
  handlePointerLeave(): void {
    if (this.activeGesture) return
    this.lastScreen = null
    this.overlay.hoverCell = null
    this.overlay.stampGhost = null
    this.overlay.freePropGhost = null
    this.overlay.markerGhost = null
    this.overlay.shapeDraft = null
    this.hoverCursor = null
    if (this.penDraftPoints.length > 0) {
      this.overlay.curveDraft = {
        points: this.penDraftPoints.slice(),
        hoverPoint: null,
        mode: 'pen',
        width: LINE_WIDTH_MM,
        straight: useEditorStore.getState().penMode === 'line',
      }
    }
    this.markDirty('overlay')
    this.requestRender()
  }

  /**
   * Shift·Alt를 눌렀다 뗄 때(마우스는 가만히). 자유 배치 고스트·각도 고정 미리보기가 키를 누르는
   * 순간 바로 바뀌어야 "지금 누르면 이렇게 된다"가 보입니다. CanvasViewport의 keydown/keyup이 부릅니다.
   */
  handleModifierChange(shift: boolean, alt: boolean): void {
    if (shift === this.isShiftDown && alt === this.isAltDown) return
    this.isShiftDown = shift
    this.isAltDown = alt
    this.updateHoverAndGhost()
    this.markDirty('overlay')
    this.requestRender()
  }

  /**
   * 휠 팬·줌, 스페이스 드래그 팬처럼 "마우스는 안 움직였지만 화면(뷰포트)이 움직인" 뒤에
   * 호출합니다. 호버·고스트는 마지막으로 안 커서 화면 좌표(lastScreen)를 그대로 쓰지만,
   * 그 좌표가 가리키는 맵 mm 좌표는 뷰포트가 바뀌면 달라지므로, 다시 계산해주지 않으면
   * 고스트가 커서를 따라가지 않고 화면에 붙박인 것처럼 보입니다(팬을 했는데 스탬프
   * 미리보기가 엉뚱한 칸에 남아있는 상태).
   */
  refreshOverlayForViewportChange(): void {
    this.updateHoverAndGhost()
    this.markDirty('overlay')
    this.requestRender()
  }

  // ── 키보드 입력 (R 회전, F 반전 — FR-3.4) ───────────────────────────

  handleKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase()

    const { activeTool } = useEditorStore.getState()
    if (activeTool === 'pen' && this.penDraftPoints.length > 0) {
      if (key === 'enter') {
        e.preventDefault()
        this.finishPenDraft()
        return
      }
      if (key === 'escape') {
        e.preventDefault()
        this.cancelPenDraft()
        return
      }
      if (key === 'backspace') {
        e.preventDefault()
        this.penDraftPoints.pop()
        if (this.penDraftPoints.length === 0) this.cancelPenDraft()
        else this.updateHoverAndGhost()
        this.markDirty('overlay')
        this.requestRender()
        return
      }
    }

    // Delete/Backspace = 선택 항목 삭제. 도구와 무관하게(선택은 V 도구로 잡았더라도
    // 그 뒤 다른 도구로 바꿨을 수 있음) editorStore의 selection이 있으면 항상 동작합니다.
    if (key === 'delete' || key === 'backspace') {
      const { selection } = useEditorStore.getState()
      if (selection) {
        e.preventDefault() // Backspace의 브라우저 기본 동작(뒤로 가기)을 막음
        const activeVertex = this.overlay.activeStrokeVertex
        if (activeVertex && selection.kind === 'stroke' && selection.id === activeVertex.strokeId) {
          this.deleteStrokeVertex(activeVertex.strokeId, activeVertex.vertexIndex)
        }
        else this.deleteSelection()
      }
      return
    }

    if (key !== 'r' && key !== 'f') return

    const { stampTileId } = useEditorStore.getState()
    // 회전/반전은 "지금 찍으려는 타일의 방향"을 바꾸는 동작이라 타일 도구에서만 의미가
    // 있습니다. 스탬프가 비어있으면(고를 타일이 없으면) 아무 것도 하지 않습니다.
    // (예전 R 키 충돌 — 영역 채우기 도구 전환 — 은 영역 채우기가 Shift+드래그로 합쳐지며 없어졌습니다.)
    if (activeTool !== 'stamp' || !stampTileId) return
    e.preventDefault()
    if (key === 'r') useEditorStore.getState().rotateStamp()
    else useEditorStore.getState().flipStamp()

    this.updateHoverAndGhost()
    this.markDirty('overlay')
    this.requestRender()
  }

  // ── 내부: 호버·고스트 미리보기 ───────────────────────────────────────

  private updateHoverAndGhost(): void {
    this.overlay.hoverCell = null
    this.overlay.eraseHover = null
    this.overlay.stampGhost = null
    this.overlay.freePropGhost = null
    this.overlay.markerGhost = null
    this.hoverCursor = null
    const doc = this.getDoc()
    if (!doc || !this.lastScreen) return

    const { activeTool, stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    const mapPt = this.viewport.screenToMap(this.lastScreen.x, this.lastScreen.y)

    if (activeTool === 'pen' && this.penDraftPoints.length > 0) {
      this.overlay.curveDraft = {
        points: this.penDraftPoints.slice(),
        hoverPoint: this.penPoint(doc, mapPt, this.isShiftDown, this.isAltDown),
        mode: 'pen',
        width: LINE_WIDTH_MM,
        straight: useEditorStore.getState().penMode === 'line',
      }
    } else if (activeTool !== 'freeDraw' && this.activeGesture !== 'penLine') {
      this.overlay.curveDraft = null
    }

    // V(선택): 핸들 위면 크기 조절 커서, 잡을 수 있는 것 위면 이동 커서.
    if (activeTool === 'select') {
      if (this.activeGesture === 'move' && this.dragMoved) {
        this.hoverCursor = 'move'
        return
      }
      if (this.activeGesture === 'resize' && this.resizeState) {
        this.hoverCursor = handleCursor(this.resizeState.handle)
        return
      }
      const selection = useEditorStore.getState().selection
      const handle = selection ? this.hitHandle(doc, selection, this.lastScreen.x, this.lastScreen.y) : null
      if (handle) this.hoverCursor = handleCursor(handle)
      else if (this.isInsideSelectionBox(doc, selection, mapPt) || hitTest(doc, mapPt.mx, mapPt.my)) this.hoverCursor = 'move'
      return
    }

    // E(지우개): 누르면 지워질 대상을 미리 빨갛게 보여 줍니다. 끄는 중이면 고정된 종류 안에서만.
    // 격자 바깥의 진입로도 대상이라 칸 범위 검사보다 먼저 처리합니다.
    if (activeTool === 'eraser') {
      const group = this.activeGesture === 'eraser' ? this.eraseLock : 'any'
      this.overlay.eraseHover = findEraseTarget(doc, mapPt.mx, mapPt.my, group)
      return
    }

    // M(마커) 도구: 팔레트에서 고른 종류를 놓일 자리(격자점, Alt면 커서)에 미리 보여줍니다.
    if (activeTool === 'marker') {
      const { markerMode, obstacleKind } = useEditorStore.getState()
      const [mx, my] = this.markerSpot(doc, mapPt, this.isAltDown !== !useEditorStore.getState().markerSnap)
      const diameterMm = markerMode === 'obstacle' ? obstaclePreset(obstacleKind).d : MARKER_GHOST_DIAMETER_MM
      this.overlay.markerGhost = { mx, my, mode: markerMode, diameterMm }
      return
    }

    // FR-3.8: 지금 Alt를 누르고 있으면 격자 스냅 대신 커서를 그대로 따라다니는 자유 배치
    // 고스트를 보여줍니다(2026-10-26 Shift → Alt). 격자 범위 밖이어도 자유 배치는 상관없어
    // cellAtMm(범위 검사)을 거치지 않고 바로 반환합니다.
    const freeGhost = activeTool === 'stamp' && stampTileId && !this.isShiftDown ? this.freeSpot(doc, mapPt, this.isAltDown) : null
    if (activeTool === 'stamp' && stampTileId && freeGhost) {
      this.overlay.freePropGhost = { mx: freeGhost.mx, my: freeGhost.my, tileId: stampTileId, rot: stampRot, flip: stampFlip, sizeMm: this.stampSizeMm(doc) }
      return
    }

    const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
    if (!cell) return

    // PRD §9.12 표(작업 지시서 인용본)는 이 행의 대상 도구를 "타일·지우개 도구"로
    // 명시합니다(원문 PRD 표는 "타일 도구"만 적혀 있었으나, 이번 작업 지시서가 지우개를
    // 추가로 명시했으므로 그대로 따랐습니다).
    if (activeTool === 'stamp') {
      this.overlay.hoverCell = cell
    }
    // Shift(영역 채우기 시작 전)에는 칸 강조만 보여 주고, 끄는 동안은 fillRect가 범위를 보여 줍니다.
    if (activeTool === 'stamp' && stampTileId && !this.isShiftDown && this.activeGesture !== 'fill') {
      this.overlay.stampGhost = { c: cell.c, r: cell.r, tileId: stampTileId, rot: stampRot, flip: stampFlip }
    }
  }

  // ── 내부: 실제 문서 변경 ────────────────────────────────────────────

  /** 문서를 실제로 바꿀 때 항상 이 메서드를 거칩니다. 스토어에 반영 + "미저장" 표시 +
   *  초안 자동 저장까지 한 곳에서 처리해서(작업 지시 4번), 도구마다 이 세 줄을
   *  반복해서 적지 않게 했습니다. */
  private commitDocChange(next: MapDoc, isTilePlacement = false, persist = true): void {
    const store = useEditorStore.getState()
    store.setDoc(next)
    if (store.saveState !== 'unsaved') store.setSaveState('unsaved')
    // 끌어 옮기기처럼 이벤트가 아주 잦은 제스처는 끝날 때 한 번만 초안을 씁니다(persist=false).
    if (persist) saveDraft(next)
    // 문서 변경 전체를 보고 코치 마크를 숨기면 선·라벨만 편집해도 "첫 타일 배치"로
    // 오인합니다. 실제 배치 경로가 명시적으로 알려줄 때만 신호를 보냅니다(§9.15).
    if (isTilePlacement) store.notifyTilePlaced()
  }

  /**
   * 펜으로 찍을 점(mm, 1mm 단위). 순서: 종이 안으로 제한 → Shift면 직전 점 기준 45° 단위 고정 →
   * (직선 모드·Alt 아님·각도 고정 아님) 격자점 5mm 안이면 격자점에 붙이기 → 반올림.
   * from을 주면 그 점을 "직전 점"으로 씁니다(직선 하나 끌기).
   */
  private penPoint(doc: MapDoc, mapPt: MapPoint, shift: boolean, alt: boolean, from?: Point): Point {
    let p = clampToBoard(doc, mapPt.mx, mapPt.my)
    const prev = from ?? this.penDraftPoints[this.penDraftPoints.length - 1]
    if (shift && prev) {
      const snapped = snapAngle45(prev, p)
      p = clampToBoard(doc, snapped.mx, snapped.my)
    } else if (!alt && useEditorStore.getState().penMode === 'line') {
      const node = nearestNode(p.mx, p.my, doc.board.cols, doc.board.rows, doc.board.pitch)
      const center = nodeCenterMm(node[0], node[1], doc.board.pitch)
      if (Math.hypot(center.mx - p.mx, center.my - p.my) <= PEN_NODE_SNAP_MM) p = center
    }
    return [Math.round(p.mx), Math.round(p.my)]
  }

  private addPenPoint(point: Point): void {
    const last = this.penDraftPoints[this.penDraftPoints.length - 1]
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= 0.5) this.penDraftPoints.push([point[0], point[1]])
    this.overlay.curveDraft = {
      points: this.penDraftPoints.slice(),
      hoverPoint: null,
      mode: 'pen',
      width: LINE_WIDTH_MM,
      straight: useEditorStore.getState().penMode === 'line',
    }
  }

  private finishPenDraft(): void {
    if (this.penDraftPoints.length >= 2) this.commitPenStroke(this.penDraftPoints, useEditorStore.getState().penMode === 'line')
    this.penDraftPoints = []
    this.overlay.curveDraft = null
    this.markDirty('overlay')
    this.requestRender()
  }

  /** 펜 결과를 문서에 넣습니다. 직선 모드는 꺾은선(line), 곡선 모드는 스플라인. */
  private commitPenStroke(points: Point[], straight: boolean): void {
    if (!straight) {
      this.commitSpline(points)
      return
    }
    const doc = this.getDoc()
    if (!doc) return
    const stroke: Stroke = {
      id: createStrokeId(doc),
      kind: 'line',
      points: points.map(([x, y]) => [x, y]),
      width: LINE_WIDTH_MM,
    }
    useEditorStore.getState().commitDoc({ ...doc, strokes: [...doc.strokes, stroke] })
    useEditorStore.getState().setSelection({ kind: 'stroke', id: stroke.id })
  }

  private cancelPenDraft(): void {
    this.penDraftPoints = []
    this.overlay.curveDraft = null
  }

  private finishFreeDrawDraft(): void {
    // 8mm 선의 1/4인 2mm 허용오차면 손 떨림은 제거하면서 트랙 중심선의 형태는 보존됩니다.
    // 단순화한 뒤 정점을 1mm 단위로 반올림합니다(인스펙터에 긴 소수가 안 보이게, 후기 13번).
    const simplified = simplifyDouglasPeucker(this.freeDrawPoints, LINE_WIDTH_MM / 4).map(
      ([x, y]): Point => [Math.round(x), Math.round(y)],
    )
    const totalLength = simplified.slice(1).reduce((sum, point, index) => {
      const prev = simplified[index]
      return sum + Math.hypot(point[0] - prev[0], point[1] - prev[1])
    }, 0)
    if (simplified.length >= 2 && totalLength >= 1) this.commitSpline(simplified)
    this.freeDrawPoints = []
    this.overlay.curveDraft = null
  }

  private commitSpline(points: Point[]): void {
    const doc = this.getDoc()
    if (!doc) return
    const stroke: Stroke = {
      id: createStrokeId(doc),
      kind: 'spline',
      points: points.map(([x, y]) => [x, y]),
      width: LINE_WIDTH_MM,
      closed: false,
    }
    useEditorStore.getState().commitDoc({ ...doc, strokes: [...doc.strokes, stroke] })
    useEditorStore.getState().setSelection({ kind: 'stroke', id: stroke.id })
  }

  private paintStampAt(mapPt: MapPoint): void {
    const doc = this.getDoc()
    const { stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    if (!doc || !stampTileId) return
    const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
    if (!cell) return
    const index = cell.r * doc.board.cols + cell.c
    // 드래그 중 같은 칸을 또 지나가도 다시 기록하지 않습니다 — 이미 원하는 타일이 놓여
    // 있는 칸을 매 pointermove마다 다시 쓰는 건 낭비이고, "제스처 동안 무엇이 정말
    // 바뀌었는지" 판단도 흐려집니다.
    if (index === this.lastPaintedIndex) return
    this.lastPaintedIndex = index
    const cellValue: Cell = { art: this.pickStampArt(stampTileId), rot: stampRot, flip: stampFlip, ...this.underFlag() }
    const nextCells = doc.cells.slice()
    nextCells[index] = cellValue
    this.commitDocChange({ ...doc, cells: nextCells }, true)
  }

  /** 도형 모서리 점: 종이 안으로 제한하고, "반 칸 격자에 맞추기"가 켜져 있으면 25mm 격자점에 붙입니다. */
  private shapePoint(doc: MapDoc, mapPt: MapPoint): MapPoint {
    const p = clampToBoard(doc, mapPt.mx, mapPt.my)
    if (!useEditorStore.getState().shapeSnap) return p
    const step = doc.board.pitch / 2
    return { mx: Math.round(p.mx / step) * step, my: Math.round(p.my / step) * step }
  }

  /** 팔레트 "선 아래에 깔기"가 켜져 있으면 새 타일·그림에 under를 붙입니다(docs/09 §2.4). */
  private underFlag(): { under?: true } {
    return useEditorStore.getState().stampUnder ? { under: true } : {}
  }

  /**
   * 타일을 칸 대신 자유 배치 그림으로 놓을 자리(그림 중심, mm). 팔레트 "놓는 자리"가 칸이고
   * Alt도 아니면 null(칸에 칠함). 반 칸이면 25mm 격자점에 붙여 선·칸 경계에 정확히 걸치게 합니다(docs/09 §2.1).
   */
  private freeSpot(doc: MapDoc, mapPt: MapPoint, alt: boolean): MapPoint | null {
    const { placeSnap, stampScale } = useEditorStore.getState()
    if (alt || placeSnap === 'free') return { mx: Math.round(mapPt.mx), my: Math.round(mapPt.my) }
    if (placeSnap === 'cell') {
      if (stampScale === 1) return null
      // 1칸이 아닌 크기는 칸 타일로 못 놓으므로 그림으로 놓되, 모서리를 칸 경계에 붙입니다(docs/12 §2.2).
      const size = this.stampSizeMm(doc)
      const { pitch, cols, rows } = doc.board
      // 가장자리 칸을 눌러도 종이 밖으로 삐져나가지 않게 종이 안으로 밀어 넣습니다(종이보다 크면 그대로).
      const keepIn = (center: number, boardMm: number) =>
        size >= boardMm ? center : Math.min(Math.max(center, size / 2), boardMm - size / 2)
      return {
        mx: keepIn(snapScaledCenter(mapPt.mx, size, pitch, stampScale), cols * pitch),
        my: keepIn(snapScaledCenter(mapPt.my, size, pitch, stampScale), rows * pitch),
      }
    }
    const step = doc.board.pitch / 2
    return { mx: Math.round(mapPt.mx / step) * step, my: Math.round(mapPt.my / step) * step }
  }

  /** 팔레트 "크기"로 고른, 새로 놓을 그림 한 변(mm). */
  private stampSizeMm(doc: MapDoc): number {
    return doc.board.pitch * useEditorStore.getState().stampScale
  }

  /**
   * "같은 테마 섞어 칠하기"가 켜져 있으면 같은 테마 타일 중 하나를 무작위로 고릅니다(예전 Alt+R).
   * 내장 타일이 아니면(아이콘·내 이미지) 테마가 없으므로 그대로 씁니다.
   */
  private pickStampArt(stampTileId: string): string {
    if (!useEditorStore.getState().mixFill) return stampTileId
    const theme = getTile(stampTileId)?.theme
    const themeTiles = theme ? TILES_BY_THEME.find((g) => g.theme === theme)?.tiles : undefined
    if (!themeTiles || themeTiles.length === 0) return stampTileId
    return themeTiles[Math.floor(Math.random() * themeTiles.length)].id
  }

  /** FR-3.8 Shift 자유 배치. cellAtMm처럼 격자 인덱스로 중복을 거르는 대신, "직전에 놓은
   *  프롭과 너무 가까우면 건너뛴다"는 거리 기준으로 중복을 거릅니다(lastFreePropCenter
   *  필드 주석 참고) — props는 격자 칸이 없어 인덱스 방식의 중복 방지를 그대로 못 씁니다. */
  private paintFreePropAt(mapPt: MapPoint): void {
    const doc = this.getDoc()
    const { stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    if (!doc || !stampTileId) return
    // 놓는 자리 규칙(반 칸·자유·Alt)을 따르고, 칸 모드에서 불렸다면(호출부가 Alt로 판단) 자유로 놓습니다.
    const spot = this.freeSpot(doc, mapPt, this.gestureAlt) ?? this.freeSpot(doc, mapPt, true)
    if (!spot) return
    if (this.lastFreePropCenter) {
      const dist = Math.hypot(spot.mx - this.lastFreePropCenter.mx, spot.my - this.lastFreePropCenter.my)
      if (dist < this.stampSizeMm(doc)) return
    }
    this.lastFreePropCenter = spot
    const prop = { ...buildFreeProp(this.pickStampArt(stampTileId), spot.mx, spot.my, this.stampSizeMm(doc), stampRot, stampFlip), ...this.underFlag() }
    this.commitDocChange({ ...doc, props: [...doc.props, prop] }, true)
  }

  /** 지우개 한 번. 인덱스로 가리키는 선택(글자·그림·칸)이 밀릴 수 있어 선택은 풉니다. */
  private eraseTarget(target: EraseTarget): void {
    const doc = this.getDoc()
    if (!doc) return
    const next = applyErase(doc, target)
    if (next === doc) return
    if (useEditorStore.getState().selection) useEditorStore.getState().setSelection(null)
    this.commitDocChange(next)
  }

  private applyEdgeDrag(prev: NodeCoord, curr: NodeCoord, add: boolean): void {
    if (prev[0] === curr[0] && prev[1] === curr[1]) return
    // 두 노드가 상하좌우로 붙어있지 않으면(대각선 포함) 그냥 건너뜁니다. 호출부
    // (stepEdgesAlongPath)가 이미 pitch/2 간격으로 촘촘히 보간해서 넘겨주므로 정상적인
    // 드래그에서는 항상 인접한 노드끼리만 들어오지만, 대각선 방향으로 코너를 스쳐
    // 지나가면 보간 샘플이 대각선으로 떨어질 수 있습니다. 이럴 때 억지로 L자로 우회해
    // 잇지 않고 그냥 건너뛰는 것이 의도된 동작입니다 — 사용자가 원치 않는 선이 생기는
    // 게 칸 하나를 놓치는 것보다 더 나쁘기 때문입니다.
    if (!areAdjacent(prev, curr)) return
    const doc = this.getDoc()
    if (!doc) return
    const { kind, c, r } = edgeBetween(prev, curr)
    const nextEdges = setEdge(doc.edges, kind, c, r, add)
    if (nextEdges === doc.edges) return // 이미 원하는 상태
    this.commitDocChange({ ...doc, edges: nextEdges })
  }

  /**
   * L 도구 드래그·Alt+지우개 드래그가 공유하는 "지나간 mm 경로를 따라 노드를 순서대로
   * 밟으며 엣지를 켜거나 끄는" 로직. 마우스가 실제로 지나간 경로(fromMx,fromMy →
   * toMx,toMy)를 interpolateMmPoints로 pitch/2 간격만큼 잘게 쪼갠 뒤, 샘플마다 가장
   * 가까운 노드를 구해 직전 노드와 비교합니다.
   *
   * 두 노드가 대각선으로 떨어져 있으면 applyEdgeDrag 안의 areAdjacent 검사가 자동으로
   * 건너뜁니다(그 함수 주석 참고) — 이 함수는 "노드를 순서대로 밟는다"까지만 책임지고,
   * "인접하지 않으면 무시한다"는 판단은 applyEdgeDrag에 그대로 맡깁니다.
   */
  private stepEdgesAlongPath(doc: MapDoc, fromMx: number, fromMy: number, toMx: number, toMy: number, add: boolean): void {
    const maxStep = doc.board.pitch / 2
    for (const p of interpolateMmPoints(fromMx, fromMy, toMx, toMy, maxStep)) {
      const node = nearestNode(p.mx, p.my, doc.board.cols, doc.board.rows, doc.board.pitch)
      if (this.lastNode) this.applyEdgeDrag(this.lastNode, node, add)
      this.lastNode = node
    }
  }

  private commitFill(start: CellCoord, end: CellCoord): void {
    const doc = this.getDoc()
    if (!doc) return
    const { stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    if (!stampTileId) return

    const c0 = Math.min(start.c, end.c)
    const c1 = Math.max(start.c, end.c)
    const r0 = Math.min(start.r, end.r)
    const r1 = Math.max(start.r, end.r)

    // 무작위 채우기(FR-3.6)는 팔레트의 "같은 테마 섞어 칠하기"를 따릅니다(pickStampArt).
    const nextCells = doc.cells.slice()
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const index = r * doc.board.cols + c
        nextCells[index] = { art: this.pickStampArt(stampTileId), rot: stampRot, flip: stampFlip, ...this.underFlag() }
      }
    }
    this.commitDocChange({ ...doc, cells: nextCells }, true)
  }

  private pickTile(doc: MapDoc, mapPt: MapPoint): void {
    const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
    if (!cell) return
    const index = cell.r * doc.board.cols + cell.c
    const found = doc.cells[index]
    if (!found) return // 빈 칸은 가져올 타일이 없음(FR-3.7)
    const store = useEditorStore.getState()
    // 검색어가 남아 있으면 집은 타일이 검색 결과에 없을 수 있어 먼저 지웁니다.
    store.setPaletteQuery('')
    // 스토어가 도구를 'stamp'(B)로 바꾸고, 팔레트 "종류"도 그 타일의 묶음으로 맞춥니다.
    store.setStampTile(found.art)
    // 방향(회전·반전)까지 함께 가져옵니다 — PRD 문구엔 없지만, 스포이드로 집은 타일이
    // 화면에 보이는 모습 그대로 다시 찍히는 편이 자연스러운 확장이라고 판단했습니다.
    store.setStampOrientation(found.rot, found.flip)
  }

  /** 우클릭 재사용(FR-3.3). 드래그 제스처가 아니라 그 자리에서 바로 커밋+실행취소
   *  등록까지 끝내는 "즉시 동작"이라 pointerup을 기다리지 않습니다. */
  private placeRightClickStamp(doc: MapDoc, mapPt: MapPoint): void {
    const { stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    if (!stampTileId) return
    const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
    if (!cell) return
    const index = cell.r * doc.board.cols + cell.c
    const before = structuredClone(doc)
    const nextCells = doc.cells.slice()
    nextCells[index] = { art: stampTileId, rot: stampRot, flip: stampFlip }
    const next: MapDoc = { ...doc, cells: nextCells }
    if (docsEqual(before, next)) return // 이미 같은 타일이 그 자리에 있음 — 변경 없음
    this.commitDocChange(next, true)
    useEditorStore.getState().pushUndoSnapshot(before)
  }

  // ── 팔레트 → 캔버스 드래그 앤 드롭(FR-3.2) ───────────────────────────

  /**
   * 드래그가 캔버스 위를 지나갈 때마다(CanvasViewport의 dragover) 호출합니다. 배치될
   * 자리를 오버레이 고스트로 미리 보여줍니다.
   *
   * [드래그 중인 타일 id를 dataTransfer에서 못 읽는 이유] 브라우저 보안 정책상
   * dragover 시점에는 dataTransfer.getData()가 항상 빈 문자열을 돌려줍니다(drop 시점에만
   * 실제 값을 읽을 수 있음). 대신 PalettePanel이 dragstart에서 이미 setStampTile()로
   * 스토어에 올려둔 값을 그대로 미리보기에 씁니다 — 어차피 지금 드래그 중인 타일과
   * 같은 값입니다.
   */
  handleDragOver(sx: number, sy: number, freeKey: boolean): void {
    const doc = this.getDoc()
    const { stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    this.overlay.stampGhost = null
    this.overlay.freePropGhost = null
    if (doc && stampTileId) {
      const mapPt = this.viewport.screenToMap(sx, sy)
      const spot = this.freeSpot(doc, mapPt, freeKey)
      if (spot) {
        this.overlay.freePropGhost = { mx: spot.mx, my: spot.my, tileId: stampTileId, rot: stampRot, flip: stampFlip, sizeMm: this.stampSizeMm(doc) }
      } else {
        const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        if (cell) this.overlay.stampGhost = { c: cell.c, r: cell.r, tileId: stampTileId, rot: stampRot, flip: stampFlip }
      }
    }
    this.markDirty('overlay')
    this.requestRender()
  }

  /** 드래그가 캔버스 밖으로 나가면 고스트를 지웁니다. */
  handleDragLeave(): void {
    this.overlay.stampGhost = null
    this.overlay.freePropGhost = null
    this.markDirty('overlay')
    this.requestRender()
  }

  /**
   * 실제로 놓는 순간(drop). drop 이벤트에서는(dragover와 달리) dataTransfer.getData()가
   * 실제 값을 돌려주므로 assetId를 직접 받습니다. 우클릭 재사용과 같은 성격의 "즉시
   * 동작"이라 커밋과 실행취소 등록을 이 안에서 한 번에 끝냅니다.
   */
  /** freeKey = Alt(자유 배치). 2026-10-26 Shift에서 바뀜. */
  handleDrop(assetId: string, sx: number, sy: number, freeKey: boolean): void {
    const doc = this.getDoc()
    this.overlay.stampGhost = null
    this.overlay.freePropGhost = null
    if (doc) {
      const { stampRot, stampFlip } = useEditorStore.getState()
      const mapPt = this.viewport.screenToMap(sx, sy)
      const before = structuredClone(doc)
      let next: MapDoc | null = null

      const spot = this.freeSpot(doc, mapPt, freeKey)
      if (spot) {
        // FR-3.8: Alt를 누른 채 놓거나 "놓는 자리"가 반 칸·자유면 props에 놓습니다.
        const prop = { ...buildFreeProp(assetId, spot.mx, spot.my, this.stampSizeMm(doc), stampRot, stampFlip), ...this.underFlag() }
        next = { ...doc, props: [...doc.props, prop] }
      } else {
        const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        if (cell) {
          const index = cell.r * doc.board.cols + cell.c
          const nextCells = doc.cells.slice()
          nextCells[index] = { art: assetId, rot: stampRot, flip: stampFlip, ...this.underFlag() }
          next = { ...doc, cells: nextCells }
        }
      }

      if (next && !docsEqual(before, next)) {
        this.commitDocChange(next, true)
        useEditorStore.getState().pushUndoSnapshot(before)
      }
    }
    this.markDirty('overlay')
    this.requestRender()
  }

  // ── 내부: T(텍스트)·M(마커)·V(선택 삭제) ──────────────────────────────

  /** T 도구 클릭 처리. 이미 있는 라벨 위를 클릭했으면 그 라벨을 편집 대상으로 잡고,
   *  그렇지 않으면 그 자리에 빈 라벨을 새로 만듭니다. 어느 쪽이든 실제 글자 입력은
   *  CanvasViewport.tsx의 인라인 `<input>`이 담당하므로, 여기서는 selection을 잡고
   *  onRequestLabelEdit로 "이제 입력창을 띄워라"라고 알리기만 합니다. */
  private placeOrEditLabel(doc: MapDoc, mapPt: MapPoint): void {
    const hit = hitTest(doc, mapPt.mx, mapPt.my)
    if (hit && hit.kind === 'label') {
      useEditorStore.getState().setSelection(hit)
      this.onRequestLabelEdit?.(hit.index, false)
      return
    }

    // 새 라벨 생성. 기본값은 PRD FR-4.1에 구체적인 수치가 없어 작업 지시가 정해준 값을
    // 그대로 씁니다: 크기 8mm, 회전 0도, 선 위 흰 글씨 모드는 꺼짐(onLine=false), 글자색은
    // 본문 글자색과 비슷한 진회색(#111827) — 종이가 흰색이라 검정에 가까운 색이 가장
    // 무난하게 읽힙니다.
    const newLabel: Label = { text: '', x: Math.round(mapPt.mx), y: Math.round(mapPt.my), rot: 0, size: 8, color: '#111827', onLine: false }
    const nextLabels = [...doc.labels, newLabel]
    useEditorStore.getState().commitDoc({ ...doc, labels: nextLabels })
    const newIndex = nextLabels.length - 1
    useEditorStore.getState().setSelection({ kind: 'label', index: newIndex })
    this.onRequestLabelEdit?.(newIndex, true)
  }

  /** M 도구가 이번 클릭으로 놓을 자리(mm). 평소엔 가장 가까운 격자점, free(Alt)면 커서 자리(1mm 단위,
   *  종이 안). 장애물도 같은 규칙입니다(격자점 = 칸 중심이라 컵을 칸 한가운데 놓는 경우가 많음). */
  private markerSpot(doc: MapDoc, mapPt: MapPoint, free: boolean): Point {
    if (free) {
      const p = clampToBoard(doc, mapPt.mx, mapPt.my)
      return [Math.round(p.mx), Math.round(p.my)]
    }
    const node = nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
    const center = nodeCenterMm(node[0], node[1], doc.board.pitch)
    return [center.mx, center.my]
  }

  /** M 도구 클릭 처리. 팔레트에서 고른 종류(출발/도착/장애물)를 놓거나 지웁니다.
   *
   *  [출발·도착이 같은 노드에 공존할 수 없는 이유] 이 둘은 로봇이 "어디서 시작해서
   *  어디로 가야 하는가"를 정의하는 값입니다. 한 노드가 출발이면서 동시에 도착이면
   *  "도착하자마자 다시 출발"이라는 의미가 되어 도달 판정(§검증)이 정의되지 않습니다.
   *  그래서 한쪽을 새로 지정하는 순간 그 자리에 있던 반대쪽은 지웁니다.
   *
   *  free(Alt)면 격자점에 붙이지 않고 그 자리에 놓습니다(후기 16번). 이때도 cell에는 가장 가까운
   *  격자점을 함께 적어 정답 코드·검증이 칸 단위로 계산되게 합니다. */
  private placeMarker(doc: MapDoc, mapPt: MapPoint, free: boolean): void {
    const { markerMode, markerHeading, goalHeading, markerLook, markerUnder, obstacleKind, startName, goalName, obstacleName } =
      useEditorStore.getState()
    const under = markerUnder ? { under: true as const } : {}
    // 팔레트 "격자점에 붙이기"가 꺼져 있으면 자유 위치. Alt는 그 반대(docs/07 §2.2).
    free = free !== !useEditorStore.getState().markerSnap
    const spot = this.markerSpot(doc, mapPt, free)
    const node = nearestNode(spot[0], spot[1], doc.board.cols, doc.board.rows, doc.board.pitch)
    const at = free ? spot : undefined
    const { pitch } = doc.board
    const near = (p: Point, limit: number) => Math.hypot(p[0] - spot[0], p[1] - spot[1]) <= limit

    if (markerMode === 'obstacle') {
      // 이미 있는 장애물 가운데 근처를 다시 누르면 지웁니다(도착지와 같은 규칙).
      const list = obstaclesOf(doc)
      const hitIndex = list.findIndex((o) => Math.hypot(o.cx - mapPt.mx, o.cy - mapPt.my) <= OBSTACLE_TOGGLE_MM)
      const next =
        hitIndex >= 0
          ? list.filter((_, i) => i !== hitIndex)
          : [
              ...list,
              {
                kind: obstacleKind,
                cx: spot[0],
                cy: spot[1],
                d: obstaclePreset(obstacleKind).d,
                // 팔레트 "붙일 이름"(docs/08 §3.3). 비어 있으면 종류 이름을 쓰도록 name을 두지 않습니다.
                ...(obstacleName.trim() ? { name: obstacleName.trim() } : {}),
              },
            ]
      useEditorStore.getState().commitDoc({ ...doc, obstacles: next })
      return
    }

    if (markerMode === 'start') {
      const nextStart: StartMarker = {
        cell: node,
        heading: markerHeading,
        look: markerLook,
        ...(at ? { at } : {}),
        ...(startName.trim() ? { name: startName.trim() } : {}),
        ...under,
      }
      const nextGoals = doc.markers.goals.filter((g) => !near(markerPositionMm(g, pitch), 1))
      useEditorStore.getState().commitDoc({ ...doc, markers: { start: nextStart, goals: nextGoals } })
      return
    }

    // 선택된 도착 도구로 같은 자리를 다시 클릭하면 토글로 제거합니다.
    const existingIndex = doc.markers.goals.findIndex((g) => near(markerPositionMm(g, pitch), free ? MARKER_TOGGLE_MM : 1))
    let nextGoals: GoalMarker[]
    if (existingIndex >= 0) {
      nextGoals = doc.markers.goals.filter((_, i) => i !== existingIndex)
    } else {
      nextGoals = [
        ...doc.markers.goals,
        { cell: node, name: goalName.trim(), look: markerLook, heading: goalHeading, ...(at ? { at } : {}), ...under },
      ]
      // 도착지 이름은 한 번 쓰고 비웁니다 — 같은 이름 도착지가 여러 개 생기면 정답 화면에서 헷갈립니다.
      if (goalName) useEditorStore.getState().setPlaceName('goalName', '')
    }
    // 새 도착점의 빈 name은 "자동 이름"을 뜻합니다. 기존 name은 파일에서 불러온 사용자
    // 이름일 수 있으므로 추가·삭제 때 다시 매기지 않습니다. 실제 표시명은 goalNames.ts가
    // 빈 이름에만 현재 순서와 중복을 고려해 계산합니다.

    let nextStart = doc.markers.start
    if (existingIndex < 0 && nextStart && near(markerPositionMm(nextStart, pitch), 1)) {
      // 새로 추가하는 경우에만 그 자리의 출발점을 지웁니다. 토글로 "지우는" 경우는 그
      // 자리에 이미 도착점이 있었다는 뜻이라, 위 불변식에 의해 출발점은 애초에 없습니다.
      nextStart = null
    }
    useEditorStore.getState().commitDoc({ ...doc, markers: { start: nextStart, goals: nextGoals } })
  }

  /** V 도구로 고른 항목을 Delete/Backspace로 지웁니다. cell은 배열 삭제가 아니라 그
   *  자리를 null로 되돌리고, prop·label은 배열에서 실제로 잘라냅니다(splice). 어느
   *  쪽이든 삭제 뒤에는 반드시 selection을 null로 되돌립니다 — editorStore.ts의
   *  Selection 타입 주석에 적은 "인덱스가 밀리는" 문제를 이 함수 하나가 다 만들어낼 수
   *  있기 때문입니다(특히 prop·label처럼 실제로 배열 길이가 줄어드는 경우). */
  private deleteSelection(): void {
    const doc = this.getDoc()
    const { selection } = useEditorStore.getState()
    if (!doc || !selection) return

    let next: MapDoc
    if (selection.kind === 'cell') {
      const nextCells = doc.cells.slice()
      nextCells[selection.index] = null
      next = { ...doc, cells: nextCells }
    } else if (selection.kind === 'prop') {
      const nextProps = doc.props.slice()
      nextProps.splice(selection.index, 1)
      next = { ...doc, props: nextProps }
    } else if (selection.kind === 'label') {
      const nextLabels = doc.labels.slice()
      nextLabels.splice(selection.index, 1)
      next = { ...doc, labels: nextLabels }
    } else if (selection.kind === 'obstacle') {
      next = { ...doc, obstacles: obstaclesOf(doc).filter((_, i) => i !== selection.index) }
    } else if (selection.kind === 'start' || selection.kind === 'goal') {
      next = applyErase(doc, selection)
    } else {
      next = { ...doc, strokes: doc.strokes.filter((stroke) => stroke.id !== selection.id) }
    }

    useEditorStore.getState().commitDoc(next)
    useEditorStore.getState().setSelection(null)
  }

  /** 선택된 stroke가 정점 편집 가능한 spline/line인지 좁혀 돌려줍니다. */
  private getSelectedEditableStroke(doc: MapDoc): Extract<Stroke, { kind: 'spline' | 'line' }> | null {
    const selection = useEditorStore.getState().selection
    if (selection?.kind !== 'stroke') return null
    const stroke = doc.strokes.find((candidate) => candidate.id === selection.id)
    return stroke && (stroke.kind === 'spline' || stroke.kind === 'line') ? stroke : null
  }

  /** 화면 px로 판정해 줌 배율과 무관하게 7px 정점·작은 핸들을 잡을 수 있게 합니다. */
  private hitStrokeEditTarget(
    stroke: Extract<Stroke, { kind: 'spline' | 'line' }>,
    sx: number,
    sy: number,
  ): StrokeEditTarget | null {
    for (let index = stroke.points.length - 1; index >= 0; index--) {
      const point = stroke.points[index]
      const screen = this.viewport.mapToScreen(point[0], point[1])
      if (Math.hypot(sx - screen.x, sy - screen.y) <= 7) {
        return { strokeId: stroke.id, vertexIndex: index, part: 'vertex' }
      }
    }

    const active = this.overlay.activeStrokeVertex
    if (stroke.kind === 'spline' && active?.strokeId === stroke.id) {
      const index = active.vertexIndex
      if (index >= 0 && index < stroke.points.length) {
        const handles = splineControlHandles(stroke, index)
        for (const [part, point] of [
          ['handle-in', handles.in],
          ['handle-out', handles.out],
        ] as const) {
          const screen = this.viewport.mapToScreen(point[0], point[1])
          if (Math.hypot(sx - screen.x, sy - screen.y) <= 6) {
            return { strokeId: stroke.id, vertexIndex: index, part }
          }
        }
      }
    }

    return null
  }

  private updateStrokeEdit(mapPt: MapPoint): void {
    const doc = this.getDoc()
    const target = this.strokeEditTarget
    if (!doc || !target) return
    const index = doc.strokes.findIndex((stroke) => stroke.id === target.strokeId)
    const stroke = doc.strokes[index]
    if (!stroke || (stroke.kind !== 'spline' && stroke.kind !== 'line')) return

    let nextStroke: typeof stroke
    if (target.part === 'vertex') {
      const points = stroke.points.map(([x, y]) => [x, y] as Point)
      points[target.vertexIndex] = [mapPt.mx, mapPt.my]
      nextStroke = { ...stroke, points }
    } else if (stroke.kind === 'spline') {
      const anchor = stroke.points[target.vertexIndex]
      const vector: Point = [mapPt.mx - anchor[0], mapPt.my - anchor[1]]
      const handles = Array.from({ length: stroke.points.length }, (_, i) => ({ ...(stroke.handles?.[i] ?? {}) }))
      // 한쪽 핸들을 끌면 반대쪽을 같은 길이로 대칭 이동해 접선을 매끄럽게 유지합니다.
      // 사용자가 뾰족한 모서리를 만드는 별도 모드는 PRD에 없으므로 smooth가 안전한 기본입니다.
      if (target.part === 'handle-in') handles[target.vertexIndex] = { in: vector, out: [-vector[0], -vector[1]] }
      else handles[target.vertexIndex] = { in: [-vector[0], -vector[1]], out: vector }
      nextStroke = { ...stroke, handles }
    } else {
      return
    }

    if (JSON.stringify(nextStroke) === JSON.stringify(stroke)) return

    const strokes = doc.strokes.slice()
    strokes[index] = nextStroke
    this.commitDocChange({ ...doc, strokes })
    this.overlay.strokeSelection = nextStroke
  }

  private insertStrokeVertex(
    stroke: Extract<Stroke, { kind: 'spline' | 'line' }>,
    insertIndex: number,
    point: Point,
  ): void {
    const doc = this.getDoc()
    if (!doc) return
    const strokeIndex = doc.strokes.findIndex((candidate) => candidate.id === stroke.id)
    if (strokeIndex < 0) return
    const points = stroke.points.map(([x, y]) => [x, y] as Point)
    points.splice(insertIndex, 0, [point[0], point[1]])
    let nextStroke: typeof stroke
    if (stroke.kind === 'spline' && stroke.handles) {
      const handles = stroke.handles.map((handle) => ({ ...handle }))
      handles.splice(insertIndex, 0, {})
      nextStroke = { ...stroke, points, handles }
    } else {
      nextStroke = { ...stroke, points }
    }
    const strokes = doc.strokes.slice()
    strokes[strokeIndex] = nextStroke
    useEditorStore.getState().commitDoc({ ...doc, strokes })
    this.overlay.activeStrokeVertex = { strokeId: stroke.id, vertexIndex: insertIndex }
    this.overlay.strokeSelection = nextStroke
  }

  private deleteStrokeVertex(strokeId: string, vertexIndex: number): void {
    const doc = this.getDoc()
    if (!doc) return
    const strokeIndex = doc.strokes.findIndex((candidate) => candidate.id === strokeId)
    const stroke = doc.strokes[strokeIndex]
    if (!stroke || (stroke.kind !== 'spline' && stroke.kind !== 'line') || stroke.points.length <= 2) return
    const points = stroke.points.map(([x, y]) => [x, y] as Point)
    points.splice(vertexIndex, 1)
    let nextStroke: typeof stroke
    if (stroke.kind === 'spline' && stroke.handles) {
      const handles = stroke.handles.map((handle) => ({ ...handle }))
      handles.splice(vertexIndex, 1)
      nextStroke = { ...stroke, points, handles }
    } else {
      nextStroke = { ...stroke, points }
    }
    const strokes = doc.strokes.slice()
    strokes[strokeIndex] = nextStroke
    useEditorStore.getState().commitDoc({ ...doc, strokes })
    this.overlay.activeStrokeVertex = null
    this.overlay.strokeSelection = nextStroke
  }

  /**
   * editorStore의 selection을 읽어 overlay.selectionBox를 다시 계산합니다. V 도구의
   * pointerdown뿐 아니라, 나중에 인스펙터에서 항목을 클릭해 selection이 바뀌는 경우처럼
   * "포인터 이벤트가 아예 없는" 경로도 있을 수 있어 이 클래스 안의 사설(private) 로직이
   * 아니라 CanvasViewport.tsx가 selection 값을 구독했다가 바뀔 때마다 불러주는 public
   * 메서드로 뺐습니다.
   */
  syncSelectionOverlay(): void {
    const doc = this.getDoc()
    let { selection } = useEditorStore.getState()
    // 실행취소·격자 리사이즈처럼 문서가 통째로 바뀌면 방금 선택한 배열 항목이나 stroke id가
    // 더 이상 존재하지 않을 수 있습니다. 그 상태를 유지하면 화면에는 유령 윤곽이 남고
    // Delete도 없는 대상을 가리키므로, 동기화 시점에 선택 자체를 함께 정리합니다.
    if (doc && selection) {
      let exists = false
      if (selection.kind === 'cell') exists = doc.cells[selection.index] !== null && doc.cells[selection.index] !== undefined
      else if (selection.kind === 'prop') exists = doc.props[selection.index] !== undefined
      else if (selection.kind === 'label') exists = doc.labels[selection.index] !== undefined
      else if (selection.kind === 'obstacle') exists = obstaclesOf(doc)[selection.index] !== undefined
      else if (selection.kind === 'start') exists = doc.markers.start !== null
      else if (selection.kind === 'goal') exists = doc.markers.goals[selection.index] !== undefined
      else {
        const strokeId = selection.id
        exists = doc.strokes.some((stroke) => stroke.id === strokeId)
      }
      if (!exists) {
        useEditorStore.getState().setSelection(null)
        selection = null
      }
    }
    this.overlay.selectionBox = doc && selection ? this.computeSelectionBoxFor(doc, selection) : null
    const selectedStrokeId = selection?.kind === 'stroke' ? selection.id : null
    this.overlay.strokeSelection =
      doc && selectedStrokeId ? (doc.strokes.find((stroke) => stroke.id === selectedStrokeId) ?? null) : null
    if (this.overlay.activeStrokeVertex?.strokeId !== selectedStrokeId) this.overlay.activeStrokeVertex = null
    if (
      this.overlay.activeStrokeVertex &&
      this.overlay.strokeSelection &&
      (this.overlay.strokeSelection.kind !== 'spline' && this.overlay.strokeSelection.kind !== 'line' ||
        this.overlay.activeStrokeVertex.vertexIndex >= this.overlay.strokeSelection.points.length)
    ) {
      this.overlay.activeStrokeVertex = null
    }
    this.markDirty('overlay')
    this.requestRender()
  }

  private computeSelectionBoxFor(doc: MapDoc, selection: Selection): OverlayState['selectionBox'] {
    if (!selection) return null
    if (selection.kind === 'cell') {
      const { cols, pitch } = doc.board
      const c = selection.index % cols
      const r = Math.floor(selection.index / cols)
      const center = nodeCenterMm(c, r, pitch)
      return { mx: center.mx, my: center.my, wMm: pitch, hMm: pitch, rot: 0, handles: [] }
    }
    if (selection.kind === 'start' || selection.kind === 'goal') {
      // 출발·도착은 크기를 끌어 바꾸지 않으므로 핸들 없이 윤곽만 그립니다.
      const marker = selection.kind === 'start' ? doc.markers.start : doc.markers.goals[selection.index]
      if (!marker) return null
      const box = markerBoxMm(marker, doc.board.pitch)
      return { mx: box.cx, my: box.cy, wMm: box.w, hMm: box.h, rot: 0, handles: [] }
    }
    if (selection.kind === 'label') {
      const label = doc.labels[selection.index]
      if (!label) return null
      // hitTest.ts와 반드시 같은 측정 함수를 씁니다 — 그래야 "클릭해서 잡히는 범위"와
      // "화면에 그려지는 선택 사각형"이 어긋나지 않습니다.
      const { wMm, hMm } = measureLabelBoxMmCached(label)
      return { mx: label.x, my: label.y, wMm, hMm, rot: label.rot, handles: [] }
    }
    // 그림·장애물·원·타원·라운드 사각은 상자 + 크기 핸들. 꺾은선·곡선은 상자 대신
    // strokeSelection의 경로·정점 오버레이로 표시합니다(정점을 끌어 모양을 바꿈).
    const box = editBoxOf(doc, selection)
    if (!box) return null
    return { mx: box.cx, my: box.cy, wMm: box.w, hMm: box.h, rot: box.rot, handles: handlesFor(doc, selection) }
  }

  // ── 선택 도구: 크기 핸들·끌어 옮기기(docs/06 §2.5) ──────────────────────

  /** 화면 좌표 (sx, sy)가 선택 대상의 크기 핸들 위인지. 줌과 무관하게 화면 7px 안이면 잡습니다. */
  private hitHandle(doc: MapDoc, selection: NonNullable<Selection>, sx: number, sy: number): HandleId | null {
    const box = editBoxOf(doc, selection)
    if (!box) return null
    for (const handle of handlesFor(doc, selection)) {
      const [hx, hy] = handlePositionMm(box, handle)
      const screen = this.viewport.mapToScreen(hx, hy)
      if (Math.abs(screen.x - sx) <= HANDLE_GRAB_PX && Math.abs(screen.y - sy) <= HANDLE_GRAB_PX) return handle
    }
    return null
  }

  /** mm 점이 선택 대상(상자로 다루는 것)의 상자 안인지. */
  private isInsideSelectionBox(doc: MapDoc, selection: Selection, mapPt: MapPoint): boolean {
    const box = editBoxOf(doc, selection)
    if (!box) return false
    const rad = (-box.rot * Math.PI) / 180
    const dx = mapPt.mx - box.cx
    const dy = mapPt.my - box.cy
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
    return Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.h / 2
  }

  /** 끌어 옮기기 한 걸음. 시작 문서에서 (지금 − 시작) 만큼, 1mm 단위로 옮깁니다. */
  private updateMove(mapPt: MapPoint): void {
    const state = this.moveState
    if (!state) return
    // Ctrl+끌기: 처음 움직이는 순간 복제본을 만들고, 그 뒤로는 복제본을 옮깁니다(원본은 그대로).
    // 칸 타일은 복제본을 따로 만들지 않고 "원래 칸을 비우지 않는" 방식으로 복사합니다.
    if (state.duplicate && !state.duplicated && state.selection.kind !== 'cell') {
      const clip = copySelection(state.base, state.selection)
      const pasted = clip ? pasteClip(state.base, clip, null, 0, createStrokeId) : null
      if (pasted && pasted.selection) {
        state.base = pasted.doc
        state.selection = pasted.selection
      }
      state.duplicated = true
    }
    const dx = Math.round(mapPt.mx - state.origin.mx)
    const dy = Math.round(mapPt.my - state.origin.my)
    const moved = translateSelection(state.base, state.selection, dx, dy, state.duplicate)
    this.commitDocChange(moved.doc, false, false)
    const current = useEditorStore.getState().selection
    if (JSON.stringify(current) !== JSON.stringify(moved.selection)) useEditorStore.getState().setSelection(moved.selection)
  }

  /** 크기 핸들 끌기 한 걸음. Shift = 비율 유지(그림은 반대로 Shift = 비율 풀기). */
  private updateResize(mapPt: MapPoint, shift: boolean): void {
    const state = this.resizeState
    if (!state) return
    const keepRatio = state.uniform || (state.ratioByDefault ? !shift : shift)
    const box = resizeBox(state.orig, state.handle, mapPt.mx, mapPt.my, keepRatio)
    this.commitDocChange(applyEditBox(state.base, state.selection, box), false, false)
  }

  // ── 복사·붙여넣기·복제(Ctrl+C / Ctrl+V / Ctrl+D, docs/06 §2.5) ──────────

  /** Ctrl+C. 선택한 것이 없으면 false(브라우저 기본 복사를 막지 않도록). */
  copy(): boolean {
    const doc = this.getDoc()
    const { selection } = useEditorStore.getState()
    if (!doc || !selection) return false
    const clip = copySelection(doc, selection)
    if (!clip) return false
    this.clipboard = clip
    this.pasteCount = 0
    return true
  }

  /** Ctrl+V. 커서가 종이 위에 있으면 커서 자리에, 아니면 원래 자리에서 10mm씩 비켜 놓습니다. */
  paste(): boolean {
    const doc = this.getDoc()
    if (!doc || !this.clipboard) return false
    const at = this.cursorOnBoard(doc)
    this.pasteCount += 1
    const result = pasteClip(doc, this.clipboard, at, PASTE_OFFSET_MM * this.pasteCount, createStrokeId)
    if (!result) return false
    useEditorStore.getState().commitDoc(result.doc)
    useEditorStore.getState().setSelection(result.selection)
    useEditorStore.getState().setTool('select')
    return true
  }

  /** Ctrl+D. 복사 + 10mm 옆에 붙여넣기를 한 번에(클립보드는 건드리지 않음). */
  duplicate(): boolean {
    const doc = this.getDoc()
    const { selection } = useEditorStore.getState()
    if (!doc || !selection) return false
    const clip = copySelection(doc, selection)
    const result = clip ? pasteClip(doc, clip, null, PASTE_OFFSET_MM, createStrokeId) : null
    if (!result) return false
    useEditorStore.getState().commitDoc(result.doc)
    useEditorStore.getState().setSelection(result.selection)
    return true
  }

  /** 마지막으로 안 커서 자리가 종이 위면 그 mm 좌표. */
  private cursorOnBoard(doc: MapDoc): [number, number] | null {
    if (!this.lastScreen) return null
    const p = this.viewport.screenToMap(this.lastScreen.x, this.lastScreen.y)
    if (!isInsideBoard(p.mx, p.my, doc.board.cols, doc.board.rows, doc.board.pitch)) return null
    return [p.mx, p.my]
  }

  private resetGestureState(): void {
    this.activeGesture = null
    this.gestureSnapshot = null
    this.gestureAlt = false
    this.gestureShift = false
    this.dragMoved = false
    this.downScreen = null
    this.lastPaintedIndex = null
    this.lastNode = null
    this.lastPointerMapPt = null
    this.lastFreePropCenter = null
    this.fillStartCell = null
    this.shapeStart = null
    this.strokeEditTarget = null
    this.moveState = null
    this.resizeState = null
    if (this.overlay.curveDraft && this.penDraftPoints.length === 0 && this.overlay.curveDraft.mode === 'pen') {
      this.overlay.curveDraft = null
    }
    this.overlay.linePreview = null
    this.overlay.fillRect = null
    this.overlay.shapeDraft = null
    if (this.freeDrawPoints.length > 0) {
      this.freeDrawPoints = []
      this.overlay.curveDraft = null
    }
  }
}
