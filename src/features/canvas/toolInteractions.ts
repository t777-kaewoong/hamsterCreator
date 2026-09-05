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
import type { Cell, Direction, GoalMarker, Label, MapDoc, NodeCoord, Prop, StartMarker } from '@/lib/model/types'
import { getTile, TILES_BY_THEME } from '@/lib/tiles/catalog'
import { saveDraft } from '@/lib/storage/draft'
import { useEditorStore } from '@/features/editor/editorStore'
import type { Selection } from '@/features/editor/editorStore'
import type { LayerName } from './renderer'
import type { MapPoint, Viewport } from './viewport'
import { nodeCenterMm } from './drawBoard'
import { hitTest, measureLabelBoxMmCached } from './hitTest'
import {
  areAdjacent,
  cellAtMm,
  clampCellAtMm,
  edgeBetween,
  interpolateMmPoints,
  nearestEdgeToPoint,
  nearestNode,
  setEdge,
  toggleEdge,
  type CellCoord,
} from './gridMath'

/** 지금 진행 중인 제스처의 종류. 스포이드(I)·선택(V)은 문서를 바꾸지 않아 제스처로
 *  치지 않습니다(null로 둠 — 실행취소 대상이 아님). */
type GestureKind = 'stamp' | 'eraser' | 'lineDraw' | 'fill' | null

/** overlay 레이어(drawOverlay.ts)가 그대로 읽어서 그리는 "지금 상호작용 중인 상태".
 *  전부 화면 표시용 데이터일 뿐, MapDoc에는 전혀 반영되지 않습니다. */
export interface OverlayState {
  /** 호버 중인 칸(타일·지우개 도구 전용, §9.12 표) */
  hoverCell: CellCoord | null
  /** 배치 예정 스탬프 고스트(B 도구, 격자에 스냅됨) */
  stampGhost: { c: number; r: number; tileId: string; rot: 0 | 90 | 180 | 270; flip: boolean } | null
  /** Shift 자유 배치 고스트(FR-3.8) — 격자를 무시하고 커서(mm 좌표)를 그대로 따라다닙니다.
   *  stampGhost와 배타적으로 하나만 켜집니다(둘 다 "지금 뭘 어디에 찍을지" 미리보기이므로). */
  freePropGhost: { mx: number; my: number; tileId: string; rot: 0 | 90 | 180 | 270; flip: boolean } | null
  /** 선 긋기 드래그 중 러버밴드 미리보기(L 도구) */
  linePreview: { fromMx: number; fromMy: number; toMx: number; toMy: number } | null
  /** 영역 채우기 드래그 중 사각 범위(R 도구) */
  fillRect: { c0: number; r0: number; c1: number; r1: number } | null
  /** M(마커) 도구가 지금 가리키는 격자 노드와, 클릭하면 무엇이 찍힐지(mode). Alt 키
   *  상태에 따라 실시간으로 바뀝니다(제스처로 고정하지 않음 — M 도구 자체가 드래그가
   *  아니라 클릭 한 번으로 끝나는 즉시 동작이라, "지금 이 순간 Alt를 누르고 있는가"를
   *  그대로 보여줘야 사용자가 헷갈리지 않습니다). */
  markerGhost: { c: number; r: number; mode: 'start' | 'goal' } | null
  /** V(선택) 도구가 고른 대상의 윤곽 표시용 사각형(mm 중심 좌표 기준). editorStore의
   *  selection이 바뀔 때마다(도구 조작뿐 아니라 인스펙터 등 React 쪽에서 바뀌어도)
   *  다시 계산해야 하므로, 포인터 이벤트가 아니라 별도의 public 메서드
   *  (syncSelectionOverlay)로 갱신합니다. */
  selectionBox: { mx: number; my: number; wMm: number; hMm: number; rot: number } | null
  /** 인스펙터 검증 섹션(§9.13) 항목을 클릭해 "여기로 이동해서 0.6초간 깜빡여라"라고
   *  요청받은 칸. §9.12 오버레이 표의 "검증 경고 위치" 행(--c-warn-zone 채움 + 2px
   *  실선 --c-warn 윤곽)을 이 용도로 그대로 씁니다. CanvasViewport.tsx가 editorStore의
   *  focusRequest를 구독했다가, 이 필드를 짧은 간격으로 채웠다 비웠다 해서(setInterval)
   *  실제로 눈에 보이는 깜빡임을 만듭니다 — 다른 오버레이와 달리 포인터 이벤트가 아니라
   *  타이머로 갱신되는 유일한 필드입니다. */
  focusHighlight: { c: number; r: number } | null
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
    focusHighlight: null,
  }
}

/**
 * Shift 자유 배치(FR-3.8)로 놓일 Prop 객체를 만듭니다. 커서/드롭 위치는 "이 오브젝트의
 * 중심"으로 다루지만, Prop.x/y는 좌상단 기준이라(types.ts 참고) 폭·높이의 절반을 빼서
 * 역산합니다. 크기는 PRD가 자유 배치 오브젝트의 기본 크기를 정하지 않아 격자 한 칸
 * 크기(pitch, 기본 50mm)로 임의로 정했습니다 — 팔레트에서 고르는 타일과 같은 크기로
 * 보이는 편이 자연스럽다고 판단했습니다.
 */
function buildFreeProp(assetId: string, centerMx: number, centerMy: number, pitch: number, rot: number, flip: boolean): Prop {
  return {
    asset: assetId,
    x: centerMx - pitch / 2,
    y: centerMy - pitch / 2,
    w: pitch,
    h: pitch,
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
  /** 가장 최근에 알고 있는 Alt 키 상태. M(마커) 도구의 호버 미리보기가 "지금 Alt를
   *  누르면 도착점 모드로 바뀐다"를 실시간으로 보여주기 위해 isShiftDown과 같은
   *  방식으로 둡니다(gestureAlt와 달리 클릭 시점에 고정하지 않고 계속 갱신). */
  private isAltDown = false
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
    this.dragMoved = false
    this.downScreen = { x: sx, y: sy }
    this.gestureAlt = e.altKey
    this.gestureShift = e.shiftKey

    switch (activeTool) {
      case 'stamp':
        this.activeGesture = 'stamp'
        this.gestureSnapshot = structuredClone(doc)
        this.lastPaintedIndex = null
        this.lastPointerMapPt = mapPt
        this.lastFreePropCenter = null
        // FR-3.8: Shift를 누른 채 시작했으면 격자를 무시하고 props에 자유 배치합니다.
        if (this.gestureShift) this.paintFreePropAt(mapPt)
        else this.paintStampAt(mapPt)
        break

      case 'eraser':
        this.activeGesture = 'eraser'
        this.gestureSnapshot = structuredClone(doc)
        this.lastPaintedIndex = null
        this.lastNode = null
        this.lastPointerMapPt = mapPt
        if (this.gestureAlt) {
          this.lastNode = nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        } else {
          this.eraseCellAt(mapPt)
        }
        break

      case 'lineDraw':
        this.activeGesture = 'lineDraw'
        this.gestureSnapshot = structuredClone(doc)
        this.lastNode = nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        this.lastPointerMapPt = mapPt
        break

      case 'fill': {
        this.activeGesture = 'fill'
        this.gestureSnapshot = structuredClone(doc)
        const start = clampCellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        this.fillStartCell = start
        this.overlay.fillRect = { c0: start.c, r0: start.r, c1: start.c, r1: start.r }
        break
      }

      case 'eyedropper':
        // 스포이드는 문서를 바꾸지 않으므로(타일 id를 "읽어오기"만 함) 실행취소 대상인
        // 제스처로 취급하지 않습니다.
        this.pickTile(doc, mapPt)
        break

      case 'select': {
        // hitTest는 문서를 바꾸지 않고 "무엇이 찍혔는지"만 읽으므로 스포이드와 마찬가지로
        // 제스처(실행취소 대상)로 취급하지 않습니다. 실제 이동·크기 조절은 이번 단계
        // 범위 밖입니다(인스펙터의 수치 입력으로만 바꿈).
        const hit = hitTest(doc, mapPt.mx, mapPt.my)
        useEditorStore.getState().setSelection(hit)
        break
      }

      case 'text':
        // T 도구도 그 자리에서 바로 끝나는 즉시 동작이라(우클릭 재사용·M 도구와 같은
        // 성격) activeGesture를 쓰지 않고 pointerdown 안에서 바로 처리합니다.
        this.placeOrEditLabel(doc, mapPt)
        break

      case 'marker':
        // gestureAlt는 이 switch 앞에서 이미 e.altKey로 고정해뒀습니다(위 참고). M
        // 도구는 드래그 개념이 없는 즉시 동작이라 이 값을 그대로 "지금 이 클릭이 도착
        // 지정인지"로 씁니다.
        this.placeMarker(doc, nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch), this.gestureAlt)
        break

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
        if (this.gestureShift) {
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

      case 'eraser':
        if (this.gestureAlt) {
          // Alt+지우개 = 엣지 지우기. L 도구와 완전히 같은 보간 경로를 씁니다
          // (stepEdgesAlongPath 주석 참고).
          if (prevPt) this.stepEdgesAlongPath(doc, prevPt.mx, prevPt.my, mapPt.mx, mapPt.my, false)
          else {
            const node = nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
            if (this.lastNode) this.applyEdgeDrag(this.lastNode, node, false)
            this.lastNode = node
          }
        } else if (prevPt) {
          for (const p of interpolateMmPoints(prevPt.mx, prevPt.my, mapPt.mx, mapPt.my, doc.board.pitch / 2)) {
            this.eraseCellAt(p)
          }
        } else {
          this.eraseCellAt(mapPt)
        }
        this.lastPointerMapPt = mapPt
        break

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

      // L 도구: 드래그 없이 그냥 클릭했으면 가장 가까운 엣지 하나만 토글합니다(FR-2.2).
      if (gestureKind === 'lineDraw' && !this.dragMoved) {
        const nearest = nearestEdgeToPoint(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        if (nearest) {
          const fresh = this.getDoc()
          if (fresh) {
            const nextEdges = toggleEdge(fresh.edges, nearest.kind, nearest.c, nearest.r)
            if (nextEdges !== fresh.edges) this.commitDocChange({ ...fresh, edges: nextEdges })
          }
        }
      }

      // R 도구: 사각 범위를 "놓는" 순간에 실제로 채웁니다(FR-3.5, 3.6).
      if (gestureKind === 'fill' && this.fillStartCell) {
        const endCell = clampCellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        this.commitFill(this.fillStartCell, endCell, this.gestureAlt)
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

    // Delete/Backspace = 선택 항목 삭제. 도구와 무관하게(선택은 V 도구로 잡았더라도
    // 그 뒤 다른 도구로 바꿨을 수 있음) editorStore의 selection이 있으면 항상 동작합니다.
    if (key === 'delete' || key === 'backspace') {
      if (useEditorStore.getState().selection) {
        e.preventDefault() // Backspace의 브라우저 기본 동작(뒤로 가기)을 막음
        this.deleteSelection()
      }
      return
    }

    if (key !== 'r' && key !== 'f') return

    const { activeTool, stampTileId } = useEditorStore.getState()
    // 회전/반전은 "지금 찍으려는 타일의 방향"을 바꾸는 동작이라 타일 배치(B)·영역
    // 채우기(R) 두 도구에서만 의미가 있습니다. 스탬프가 비어있으면(고를 타일이 없으면)
    // 아무 것도 하지 않습니다.
    if ((activeTool !== 'stamp' && activeTool !== 'fill') || !stampTileId) return

    // [PRD 충돌과 그 해결] §9.6 도구 레일 표는 R 키를 "영역 채우기 도구로 전환"에 이미
    // 쓰고 있는데, FR-3.4는 같은 R 키를 "배치 중 90도 회전"에 씁니다. 두 규칙이 정면으로
    // 충돌해서, 이 코드에서는 "지금 스탬프를 들고 있는 중(B/R 도구 + 타일 선택됨)이면
    // 회전이 이긴다"고 정했습니다. ToolRail.tsx의 전역 단축키 핸들러가 activeTool이
    // 'stamp'일 때는 R로 인한 도구 전환을 건너뛰도록 맞춰뒀습니다(자세한 설명은 그 파일 참고).
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
    this.overlay.stampGhost = null
    this.overlay.freePropGhost = null
    this.overlay.markerGhost = null
    const doc = this.getDoc()
    if (!doc || !this.lastScreen) return

    const { activeTool, stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    const mapPt = this.viewport.screenToMap(this.lastScreen.x, this.lastScreen.y)

    // M(마커) 도구: 지금 가장 가까운 노드에 무엇이 찍힐지 미리 보여줍니다. Alt를 누르고
    // 있는지는 매 프레임 새로 확인합니다(this.isAltDown) — 마우스는 그대로 두고 Alt만
    // 눌렀다 떼도 미리보기가 즉시 출발/도착 모드를 오갑니다.
    if (activeTool === 'marker') {
      const node = nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
      this.overlay.markerGhost = { c: node[0], r: node[1], mode: this.isAltDown ? 'goal' : 'start' }
      return
    }

    // FR-3.8: 지금 Shift를 누르고 있으면(this.isShiftDown) 격자 스냅 대신 커서를 그대로
    // 따라다니는 자유 배치 고스트를 보여줍니다. 격자 범위 밖이어도 자유 배치는 상관없어
    // cellAtMm(범위 검사)을 거치지 않고 바로 반환합니다.
    if (activeTool === 'stamp' && stampTileId && this.isShiftDown) {
      this.overlay.freePropGhost = { mx: mapPt.mx, my: mapPt.my, tileId: stampTileId, rot: stampRot, flip: stampFlip }
      return
    }

    const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
    if (!cell) return

    // PRD §9.12 표(작업 지시서 인용본)는 이 행의 대상 도구를 "타일·지우개 도구"로
    // 명시합니다(원문 PRD 표는 "타일 도구"만 적혀 있었으나, 이번 작업 지시서가 지우개를
    // 추가로 명시했으므로 그대로 따랐습니다).
    if (activeTool === 'stamp' || activeTool === 'eraser') {
      this.overlay.hoverCell = cell
    }
    if (activeTool === 'stamp' && stampTileId) {
      this.overlay.stampGhost = { c: cell.c, r: cell.r, tileId: stampTileId, rot: stampRot, flip: stampFlip }
    }
  }

  // ── 내부: 실제 문서 변경 ────────────────────────────────────────────

  /** 문서를 실제로 바꿀 때 항상 이 메서드를 거칩니다. 스토어에 반영 + "미저장" 표시 +
   *  초안 자동 저장까지 한 곳에서 처리해서(작업 지시 4번), 도구마다 이 세 줄을
   *  반복해서 적지 않게 했습니다. */
  private commitDocChange(next: MapDoc): void {
    const store = useEditorStore.getState()
    store.setDoc(next)
    if (store.saveState !== 'unsaved') store.setSaveState('unsaved')
    saveDraft(next)
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
    const cellValue: Cell = { art: stampTileId, rot: stampRot, flip: stampFlip }
    const nextCells = doc.cells.slice()
    nextCells[index] = cellValue
    this.commitDocChange({ ...doc, cells: nextCells })
  }

  /** FR-3.8 Shift 자유 배치. cellAtMm처럼 격자 인덱스로 중복을 거르는 대신, "직전에 놓은
   *  프롭과 너무 가까우면 건너뛴다"는 거리 기준으로 중복을 거릅니다(lastFreePropCenter
   *  필드 주석 참고) — props는 격자 칸이 없어 인덱스 방식의 중복 방지를 그대로 못 씁니다. */
  private paintFreePropAt(mapPt: MapPoint): void {
    const doc = this.getDoc()
    const { stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    if (!doc || !stampTileId) return
    if (this.lastFreePropCenter) {
      const dist = Math.hypot(mapPt.mx - this.lastFreePropCenter.mx, mapPt.my - this.lastFreePropCenter.my)
      if (dist < doc.board.pitch) return
    }
    this.lastFreePropCenter = { mx: mapPt.mx, my: mapPt.my }
    const prop = buildFreeProp(stampTileId, mapPt.mx, mapPt.my, doc.board.pitch, stampRot, stampFlip)
    this.commitDocChange({ ...doc, props: [...doc.props, prop] })
  }

  private eraseCellAt(mapPt: MapPoint): void {
    const doc = this.getDoc()
    if (!doc) return
    const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
    if (!cell) return
    const index = cell.r * doc.board.cols + cell.c
    if (index === this.lastPaintedIndex) return
    this.lastPaintedIndex = index
    if (doc.cells[index] === null) return // 이미 비어있음 — 바꿀 게 없음
    const nextCells = doc.cells.slice()
    nextCells[index] = null
    this.commitDocChange({ ...doc, cells: nextCells })
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

  private commitFill(start: CellCoord, end: CellCoord, alt: boolean): void {
    const doc = this.getDoc()
    if (!doc) return
    const { stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    if (!stampTileId) return

    const c0 = Math.min(start.c, end.c)
    const c1 = Math.max(start.c, end.c)
    const r0 = Math.min(start.r, end.r)
    const r1 = Math.max(start.r, end.r)

    // Alt+드래그 = 같은 테마 안에서 무작위로 골라 채움(FR-3.6). 선택된 스탬프가 내장
    // 타일이 아니라(아이콘·사용자 이미지) 테마 정보가 없으면 고를 후보가 없으므로,
    // 그럴 땐 그냥 평소처럼 같은 스탬프로 채웁니다(PRD에 명시 없어 임의로 정한 대체 동작).
    const theme = getTile(stampTileId)?.theme
    const themeTiles = theme ? TILES_BY_THEME.find((g) => g.theme === theme)?.tiles : undefined

    const nextCells = doc.cells.slice()
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const index = r * doc.board.cols + c
        let art = stampTileId
        if (alt && themeTiles && themeTiles.length > 0) {
          art = themeTiles[Math.floor(Math.random() * themeTiles.length)].id
        }
        nextCells[index] = { art, rot: stampRot, flip: stampFlip }
      }
    }
    this.commitDocChange({ ...doc, cells: nextCells })
  }

  private pickTile(doc: MapDoc, mapPt: MapPoint): void {
    const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
    if (!cell) return
    const index = cell.r * doc.board.cols + cell.c
    const found = doc.cells[index]
    if (!found) return // 빈 칸은 가져올 타일이 없음(FR-3.7)
    const store = useEditorStore.getState()
    store.setStampTile(found.art) // 스토어 로직이 도구도 자동으로 'stamp'(B)로 바꿉니다.
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
    this.commitDocChange(next)
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
  handleDragOver(sx: number, sy: number, shiftKey: boolean): void {
    const doc = this.getDoc()
    const { stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    this.overlay.stampGhost = null
    this.overlay.freePropGhost = null
    if (doc && stampTileId) {
      const mapPt = this.viewport.screenToMap(sx, sy)
      if (shiftKey) {
        this.overlay.freePropGhost = { mx: mapPt.mx, my: mapPt.my, tileId: stampTileId, rot: stampRot, flip: stampFlip }
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
  handleDrop(assetId: string, sx: number, sy: number, shiftKey: boolean): void {
    const doc = this.getDoc()
    this.overlay.stampGhost = null
    this.overlay.freePropGhost = null
    if (doc) {
      const { stampRot, stampFlip } = useEditorStore.getState()
      const mapPt = this.viewport.screenToMap(sx, sy)
      const before = structuredClone(doc)
      let next: MapDoc | null = null

      if (shiftKey) {
        // FR-3.8: Shift를 누른 채 놓으면 격자 무시하고 props에 자유 배치.
        const prop = buildFreeProp(assetId, mapPt.mx, mapPt.my, doc.board.pitch, stampRot, stampFlip)
        next = { ...doc, props: [...doc.props, prop] }
      } else {
        const cell = cellAtMm(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        if (cell) {
          const index = cell.r * doc.board.cols + cell.c
          const nextCells = doc.cells.slice()
          nextCells[index] = { art: assetId, rot: stampRot, flip: stampFlip }
          next = { ...doc, cells: nextCells }
        }
      }

      if (next && !docsEqual(before, next)) {
        this.commitDocChange(next)
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
    const newLabel: Label = { text: '', x: mapPt.mx, y: mapPt.my, rot: 0, size: 8, color: '#111827', onLine: false }
    const nextLabels = [...doc.labels, newLabel]
    useEditorStore.getState().commitDoc({ ...doc, labels: nextLabels })
    const newIndex = nextLabels.length - 1
    useEditorStore.getState().setSelection({ kind: 'label', index: newIndex })
    this.onRequestLabelEdit?.(newIndex, true)
  }

  /** M 도구 클릭 처리. isGoalMode가 false면 출발 지정(같은 자리를 다시 클릭하면 방향
   *  회전), true면 Alt+클릭 = 도착 지정/해제 토글입니다.
   *
   *  [출발·도착이 같은 노드에 공존할 수 없는 이유] 이 둘은 로봇이 "어디서 시작해서
   *  어디로 가야 하는가"를 정의하는 값입니다. 한 노드가 출발이면서 동시에 도착이면
   *  "도착하자마자 다시 출발"이라는 의미가 되어 도달 판정(§검증)이 정의되지 않습니다.
   *  그래서 한쪽을 새로 지정하는 순간 그 자리에 있던 반대쪽은 지웁니다. */
  private placeMarker(doc: MapDoc, node: NodeCoord, isGoalMode: boolean): void {
    if (!isGoalMode) {
      const start = doc.markers.start
      let nextStart: StartMarker
      if (start && start.cell[0] === node[0] && start.cell[1] === node[1]) {
        // 같은 자리를 다시 클릭 — 흔히 "방향이 삐딱하게 잡혔을 때 다시 눌러서 맞추는"
        // 조작이라 N→E→S→W 순으로 한 칸 돌립니다.
        const order: Direction[] = ['N', 'E', 'S', 'W']
        nextStart = { cell: node, heading: order[(order.indexOf(start.heading) + 1) % order.length] }
      } else {
        // 새 자리에 출발 지정. 기본 방향은 PRD 미규정 — 로봇 그림이 흔히 위(북)를
        // 바라보는 모습으로 그려지는 관례를 따라 'N'으로 임의로 정함.
        nextStart = { cell: node, heading: 'N' }
      }
      const nextGoals = doc.markers.goals.filter((g) => !(g.cell[0] === node[0] && g.cell[1] === node[1]))
      useEditorStore.getState().commitDoc({ ...doc, markers: { start: nextStart, goals: nextGoals } })
      return
    }

    // Alt+클릭 = 도착점 토글.
    const existingIndex = doc.markers.goals.findIndex((g) => g.cell[0] === node[0] && g.cell[1] === node[1])
    let nextGoals: GoalMarker[]
    if (existingIndex >= 0) {
      nextGoals = doc.markers.goals.filter((_, i) => i !== existingIndex)
    } else {
      nextGoals = [...doc.markers.goals, { cell: node, name: '' }]
    }
    // 이름은 항상 자동으로 다시 매깁니다: 도착점이 1개면 "도착", 여러 개면 순서대로
    // "도착1","도착2"... — 인스펙터에 이름을 직접 고치는 UI가 아직 없어(§9.13은 다음
    // 단계) 지금은 매번 다시 매겨도 잃어버릴 사용자 입력이 없습니다. 나중에 수동 이름
    // 편집이 생기면 "사용자가 고친 이름은 그대로 두고 새로 생긴 것만 번호를 매긴다"는
    // 식으로 이 로직을 다시 설계해야 합니다(PRD 미규정 — 임의로 정한 임시 규칙).
    nextGoals = nextGoals.map((g, i) => ({ ...g, name: nextGoals.length === 1 ? '도착' : `도착${i + 1}` }))

    let nextStart = doc.markers.start
    if (existingIndex < 0 && nextStart && nextStart.cell[0] === node[0] && nextStart.cell[1] === node[1]) {
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
    } else {
      return // stroke: 곡선 도구가 아직 없어 이 kind로 선택될 일이 없음
    }

    useEditorStore.getState().commitDoc(next)
    useEditorStore.getState().setSelection(null)
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
    const { selection } = useEditorStore.getState()
    this.overlay.selectionBox = doc && selection ? this.computeSelectionBoxFor(doc, selection) : null
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
      return { mx: center.mx, my: center.my, wMm: pitch, hMm: pitch, rot: 0 }
    }
    if (selection.kind === 'prop') {
      const prop = doc.props[selection.index]
      if (!prop) return null
      return { mx: prop.x + prop.w / 2, my: prop.y + prop.h / 2, wMm: prop.w, hMm: prop.h, rot: prop.rot }
    }
    if (selection.kind === 'label') {
      const label = doc.labels[selection.index]
      if (!label) return null
      // hitTest.ts와 반드시 같은 측정 함수를 씁니다 — 그래야 "클릭해서 잡히는 범위"와
      // "화면에 그려지는 선택 사각형"이 어긋나지 않습니다.
      const { wMm, hMm } = measureLabelBoxMmCached(label)
      return { mx: label.x, my: label.y, wMm, hMm, rot: label.rot }
    }
    return null // stroke: 곡선 도구가 아직 없어 이 kind로 선택될 일이 없음
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
    this.overlay.linePreview = null
    this.overlay.fillRect = null
  }
}
