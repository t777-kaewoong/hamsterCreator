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
import type { Cell, MapDoc, NodeCoord } from '@/lib/model/types'
import { getTile, TILES_BY_THEME } from '@/lib/tiles/catalog'
import { saveDraft } from '@/lib/storage/draft'
import { useEditorStore } from '@/features/editor/editorStore'
import type { LayerName } from './renderer'
import type { MapPoint, Viewport } from './viewport'
import { nodeCenterMm } from './drawBoard'
import {
  areAdjacent,
  cellAtMm,
  clampCellAtMm,
  edgeBetween,
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
  /** 배치 예정 스탬프 고스트(B 도구) */
  stampGhost: { c: number; r: number; tileId: string; rot: 0 | 90 | 180 | 270; flip: boolean } | null
  /** 선 긋기 드래그 중 러버밴드 미리보기(L 도구) */
  linePreview: { fromMx: number; fromMy: number; toMx: number; toMy: number } | null
  /** 영역 채우기 드래그 중 사각 범위(R 도구) */
  fillRect: { c0: number; r0: number; c1: number; r1: number } | null
}

/** 클릭인지 드래그인지 구분하는 기준(화면 CSS px). L 도구의 "단순 클릭 = 엣지 토글" 대
 *  "드래그 = 지나간 엣지 켜기"를 가르는 데만 씁니다. */
const CLICK_THRESHOLD_PX = 3

function emptyOverlay(): OverlayState {
  return { hoverCell: null, stampGhost: null, linePreview: null, fillRect: null }
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
  private dragMoved = false
  private downScreen: { x: number; y: number } | null = null
  /** 가장 최근에 알고 있는 커서 위치(화면 px). 호버 표시·고스트 미리보기를 회전(R)/
   *  반전(F) 키를 눌렀을 때도(마우스를 움직이지 않아도) 즉시 갱신하기 위해 따로 둡니다. */
  private lastScreen: { x: number; y: number } | null = null
  /** 스탬프·지우개 드래그 중 "직전에 칠한 칸" 인덱스. 같은 칸을 다시 지나가도 중복으로
   *  기록하지 않기 위한 값입니다(같은 칸에 already 같은 타일을 또 써봤자 낭비이고,
   *  나중에 "지나간 칸 개수"를 셀 일이 생기면 이 값이 없으면 셀 수도 없습니다). */
  private lastPaintedIndex: number | null = null
  /** 선 긋기/지우개(Alt) 드래그 중 "직전에 지나간 노드". 다음 노드와 인접하면 그 사이
   *  엣지를 켜거나 끕니다. */
  private lastNode: NodeCoord | null = null
  /** 영역 채우기 드래그 시작 칸. */
  private fillStartCell: CellCoord | null = null

  constructor(
    private readonly viewport: Viewport,
    private readonly getDoc: () => MapDoc | null,
    private readonly markDirty: (...names: LayerName[]) => void,
    private readonly requestRender: () => void,
  ) {}

  // ── 포인터 입력 ──────────────────────────────────────────────────────

  handlePointerDown(e: PointerEvent, rect: DOMRect): void {
    const doc = this.getDoc()
    if (!doc) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    this.lastScreen = { x: sx, y: sy }
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

    switch (activeTool) {
      case 'stamp':
        this.activeGesture = 'stamp'
        this.gestureSnapshot = structuredClone(doc)
        this.lastPaintedIndex = null
        this.paintStampAt(mapPt)
        break

      case 'eraser':
        this.activeGesture = 'eraser'
        this.gestureSnapshot = structuredClone(doc)
        this.lastPaintedIndex = null
        this.lastNode = null
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

      case 'select':
        // 이번 단계는 프롭·라벨 등 선택할 대상이 아직 없어 항상 비웁니다.
        // (인스펙터 §9.13 "선택 항목" 섹션을 만들 때 실제 선택 로직이 들어갈 자리)
        useEditorStore.getState().setSelection(null)
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
    if (!doc) return
    const mapPt = this.viewport.screenToMap(sx, sy)

    if (this.activeGesture && this.downScreen) {
      const dist = Math.hypot(sx - this.downScreen.x, sy - this.downScreen.y)
      if (dist > CLICK_THRESHOLD_PX) this.dragMoved = true
    }

    switch (this.activeGesture) {
      case 'stamp':
        this.paintStampAt(mapPt)
        break

      case 'eraser':
        if (this.gestureAlt) {
          const node = nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
          if (this.lastNode) this.applyEdgeDrag(this.lastNode, node, false)
          this.lastNode = node
        } else {
          this.eraseCellAt(mapPt)
        }
        break

      case 'lineDraw': {
        const node = nearestNode(mapPt.mx, mapPt.my, doc.board.cols, doc.board.rows, doc.board.pitch)
        if (this.lastNode) {
          const from = nodeCenterMm(this.lastNode[0], this.lastNode[1], doc.board.pitch)
          this.applyEdgeDrag(this.lastNode, node, !this.gestureAlt)
          this.overlay.linePreview = { fromMx: from.mx, fromMy: from.my, toMx: mapPt.mx, toMy: mapPt.my }
        }
        this.lastNode = node
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
    const doc = this.getDoc()
    if (!doc || !this.lastScreen) return

    const { activeTool, stampTileId, stampRot, stampFlip } = useEditorStore.getState()
    const mapPt = this.viewport.screenToMap(this.lastScreen.x, this.lastScreen.y)
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
    // 마우스가 빨리 움직여 노드를 2칸 이상 건너뛰면(대각선 포함) 무시합니다 — 그 사이
    // 지나간 노드들을 보간하지 않는 단순화입니다(일반적인 드래그 속도에서는 pointermove가
    // 충분히 자주 와서 거의 발생하지 않습니다).
    if (!areAdjacent(prev, curr)) return
    const doc = this.getDoc()
    if (!doc) return
    const { kind, c, r } = edgeBetween(prev, curr)
    const nextEdges = setEdge(doc.edges, kind, c, r, add)
    if (nextEdges === doc.edges) return // 이미 원하는 상태
    this.commitDocChange({ ...doc, edges: nextEdges })
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

  private resetGestureState(): void {
    this.activeGesture = null
    this.gestureSnapshot = null
    this.gestureAlt = false
    this.dragMoved = false
    this.downScreen = null
    this.lastPaintedIndex = null
    this.lastNode = null
    this.fillStartCell = null
    this.overlay.linePreview = null
    this.overlay.fillRect = null
  }
}
