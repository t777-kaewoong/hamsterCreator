// 편집기의 캔버스 뷰포트 (PRD §9.12 ★핵심).
//
// 이 컴포넌트가 하는 일: EditorLayout의 캔버스 자리를 4개 <canvas>로 채웁니다
// (좌상단 코너 / 상단 눈금자 / 좌측 눈금자 / 본체). 본체 위에는 줌 클러스터·미니맵을
// 플로팅으로 띄웁니다. 실제 좌표 계산은 viewport.ts, 실제 그리기는 drawBoard.ts·
// ruler.ts·minimap.ts·drawOverlay.ts에 맡기고, 이 파일은 "언제 다시 그릴지"(리사이즈·
// 팬·줌·문서 변경·타일 로드 완료)와 "입력을 어떻게 받을지"(휠·드래그·스페이스바·
// 도구별 클릭/드래그·우클릭·단축키)만 담당합니다.
//
// 도구 동작 자체(타일 찍기, 격자선 긋기, 영역 채우기 등)는 toolInteractions.ts의
// ToolController가 전담합니다. 이 파일은 팬(스페이스바·가운데 버튼 드래그)이 아닌
// 포인터 입력을 전부 ToolController에게 그대로 넘겨주는 "배선" 역할만 합니다 — 팬은
// 어떤 도구를 고르고 있든 항상 동작해야 하므로, 팬 여부를 먼저 가려낸 뒤에만 도구로
// 넘깁니다.
import { useEffect, useRef, useState } from 'react'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { Tooltip } from '@/components'
import { useEditorStore } from '@/features/editor/editorStore'
import type { ToolId } from '@/features/editor/editorStore'
import type { MapDoc } from '@/lib/model/types'
import { saveDraft } from '@/lib/storage/draft'
import { REFERENCE_PX_PER_MM, Viewport, ZOOM_WHEEL_STEP } from './viewport'
import { LayeredRenderer } from './renderer'
import type { LayerName } from './renderer'
import {
  drawArtLayer,
  drawGridLayer,
  drawLabelsLayer,
  drawMarkersLayer,
  drawPaperLayer,
  drawPropsLayer,
  mapSizeMm,
  nodeCenterMm,
} from './drawBoard'
import { drawOverlayLayer } from './drawOverlay'
import { ToolController } from './toolInteractions'
import { drawHorizontalRuler, drawVerticalRuler } from './ruler'
import { computeMinimapSize, drawMinimap, shouldShowMinimap } from './minimap'
import type { PixelSize } from './minimap'
import { getTokens } from './cssTokens'
import { tileBitmapCache } from './tileBitmaps'
import styles from './CanvasViewport.module.css'

/** 눈금자 두께(px). 코너 사각형도 이 크기의 정사각형입니다(PRD §9.12: "두께 24px"). */
const RULER_THICKNESS_PX = 24
/** 미니맵 고정 폭(px). 높이는 맵 종횡비에 맞춰 계산합니다(PRD §9.12: "폭 160px"). */
const MINIMAP_WIDTH_PX = 160

/** 검증 항목 클릭 강조(§9.13: "0.6초간 깜빡입니다")의 총 지속 시간과 켬/끔 간격.
 *  600ms ÷ 100ms = 6단계(켬-끔-켬-끔-켬-끔)라 눈에 또렷하게 두세 번 반짝이는 정도로
 *  보입니다. <canvas>에는 CSS 애니메이션을 못 써서 이렇게 고정 간격 타이머로 토글합니다. */
const FOCUS_BLINK_TOTAL_MS = 600
const FOCUS_BLINK_STEP_MS = 100

/** 지금 포커스가 글자 입력 요소에 있는지. 이럴 때는 Space나 도구 단축키를 눌러도
 *  팬/도구 전환으로 새지 않아야 합니다(예: 파일명 입력 중 스페이스는 그냥 띄어쓰기). */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.hasAttribute('contenteditable')
}

/** 지금 고른 도구에 맞는 캔버스 커서(PRD §9.17: "도구별로 커서를 바꿉니다"). 팬 중이거나
 *  스페이스바를 누르고 있을 때는 이 값 대신 grab/grabbing이 우선합니다(호출부에서 처리). */
function cursorForTool(tool: ToolId): string {
  switch (tool) {
    case 'stamp':
    case 'fill':
      return 'copy'
    case 'lineDraw':
    case 'eraser':
    case 'eyedropper':
      return 'crosshair'
    default:
      return 'default'
  }
}

/** 캔버스 요소의 실제 픽셀 수를 devicePixelRatio에 맞게 키우고, 그리기 좌표계는 다시
 *  CSS 픽셀 기준으로 되돌립니다. 본체 캔버스(renderer.ts)와 똑같은 이유로, 눈금자·미니맵
 *  캔버스에도 각각 적용해야 저해상도로 흐리게 나오지 않습니다. */
function sizeCanvasForDpr(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

export default function CanvasViewport() {
  const doc = useEditorStore((s) => s.doc)
  const activeTool = useEditorStore((s) => s.activeTool)
  const selection = useEditorStore((s) => s.selection)
  const focusRequest = useEditorStore((s) => s.focusRequest)

  const bodyWrapRef = useRef<HTMLDivElement>(null)
  const bodyCanvasRef = useRef<HTMLCanvasElement>(null)
  const rulerTopRef = useRef<HTMLCanvasElement>(null)
  const rulerLeftRef = useRef<HTMLCanvasElement>(null)
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null)

  // 팬·줌 상태(pxPerMm, originPx)는 매 프레임 바뀔 수 있어 React state로 두지 않고
  // ref 하나에 담아 직접 mutate합니다(리렌더 없이 캔버스만 다시 그리기 위함).
  const viewportRef = useRef(new Viewport())
  const rendererRef = useRef<LayeredRenderer | null>(null)
  const toolControllerRef = useRef<ToolController | null>(null)
  const docRef = useRef<MapDoc | null>(doc)
  const bodySizeRef = useRef<PixelSize>({ width: 0, height: 0 })
  const hasFitOnceRef = useRef(false)
  const isPanningRef = useRef(false)
  const isSpaceDownRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  // scheduleAll/syncUiState/maybeFitOnce는 마운트 effect 안에서 만들어지지만, 줌 클러스터
  // 버튼 클릭 같은 다른 이벤트 핸들러에서도 불러야 해서 ref에 담아 밖으로 내보냅니다.
  const engineRef = useRef<{ scheduleAll: () => void; syncUiState: () => void; maybeFitOnce: () => void } | null>(
    null,
  )

  // 화면에 표시할 값만 React state로 둡니다(줌 클러스터 배율 숫자, 미니맵 표시 여부).
  // 팬은 이 값들을 바꾸지 않으므로 팬 중에는 리렌더가 일어나지 않습니다.
  const [zoomPercent, setZoomPercent] = useState(100)
  const [minimapVisible, setMinimapVisible] = useState(false)
  const [minimapSize, setMinimapSize] = useState<PixelSize>({ width: MINIMAP_WIDTH_PX, height: MINIMAP_WIDTH_PX })

  // ── T(텍스트) 도구 인라인 라벨 편집 ─────────────────────────────────────
  // isNew=true면 이 입력창이 방금 T 도구 클릭으로 새로 만든 빈 라벨을 채우는 중이라는
  // 뜻입니다(Esc 취소 시 라벨 자체를 지워야 함). ToolController는 DOM을 모르는 평범한
  // 클래스라 실제 <input>은 만들 수 없어서(파일 맨 위 주석 참고), onRequestLabelEdit
  // 콜백으로 "몇 번 라벨을 편집해야 하는지"만 여기로 넘겨받습니다.
  const [editingLabel, setEditingLabel] = useState<{ index: number; isNew: boolean } | null>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)
  // Enter(확정)와 그로 인한 input unmount가 유발하는 blur(확정)가 거의 동시에 발생해
  // commitLabelEdit이 두 번 불릴 수 있습니다(첫 호출로 setEditingLabel(null)을 걸어도
  // 같은 렌더의 클로저가 이미 붙잡고 있는 값은 그대로라 두 번째 호출도 "아직 안 끝난
  // 편집"으로 보입니다). 그래서 "이번 편집은 이미 처리했다"를 따로 표시해 두 번째
  // 호출을 무시합니다 — 그렇지 않으면 같은 텍스트 변경이 실행취소 스택에 두 번 쌓입니다.
  const labelEditHandledRef = useRef(false)
  // 입력창이 떠 있는 동안 팬·줌을 하면 입력창이 라벨을 따라가야 합니다. 그런데 팬은
  // React state를 전혀 건드리지 않아(위 zoomPercent 주석 참고) 리렌더가 안 일어나고,
  // 입력창은 처음 계산된 화면 좌표에 그대로 붙박여 라벨과 어긋나 버립니다. 그래서
  // "편집 중일 때만" 화면이 움직일 때마다 이 숫자를 1 올려 억지로 리렌더를 일으켜
  // 입력창 위치를 다시 계산하게 합니다. 편집 중이 아닐 때는 전혀 오르지 않으므로
  // 평소 팬 성능에는 영향이 없습니다.
  const [labelInputTick, setLabelInputTick] = useState(0)
  // scheduleAll(마운트 effect 안의 클로저)에서 editingLabel의 최신값을 봐야 하는데,
  // state를 직접 읽으면 마운트 시점의 낡은 값(null)에 붙잡힙니다. ref로 거울을 둡니다.
  const editingLabelRef = useRef<{ index: number; isNew: boolean } | null>(null)

  // ── V(선택) 오버레이 동기화 ──────────────────────────────────────────
  // selection은 지금 이 컴포넌트가 아니라 editorStore에 있고, V 도구의 포인터 클릭뿐
  // 아니라 나중에 인스펙터(§9.13)처럼 캔버스 바깥의 React 쪽 조작으로도 바뀔 수
  // 있습니다. 그래서 "누가 바꿨든" selection 값 자체를 구독했다가 바뀔 때마다
  // ToolController에게 overlay.selectionBox를 다시 계산하라고 시킵니다.
  useEffect(() => {
    toolControllerRef.current?.syncSelectionOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  // ── 인스펙터 검증 섹션(§9.13) 클릭 → 캔버스 이동 + 0.6초 깜빡임 ─────────────────────
  // editorStore.focusRequest가 바뀔 때마다(=requestFocus 호출) 실행됩니다. nonce 덕분에
  // 같은 노드를 연달아 클릭해도 매번 새로 실행됩니다(editorStore.ts의 FocusRequest 타입
  // 주석 참고). Issue.at이 없는 항목은 Inspector.tsx가 애초에 requestFocus를 호출하지
  // 않으므로 이 effect에 도달할 일이 없습니다.
  useEffect(() => {
    if (!focusRequest) return
    const currentDoc = useEditorStore.getState().doc
    if (!currentDoc) return
    const [c, r] = focusRequest.node
    const center = nodeCenterMm(c, r, currentDoc.board.pitch)
    const { width, height } = bodySizeRef.current

    // 지금 배율은 그대로 두고 원점만 옮겨 그 노드가 화면 가운데로 오게 합니다.
    viewportRef.current.centerOn(width, height, center.mx, center.my)
    rendererRef.current?.markAllDirty()
    engineRef.current?.syncUiState()
    engineRef.current?.scheduleAll()
    toolControllerRef.current?.refreshOverlayForViewportChange()

    // 100ms마다 focusHighlight를 켰다 껐다 해서 눈에 보이는 깜빡임을 만듭니다. 홀수
    // 번째 tick에서 켜고 짝수 번째에서 끄면 "켬-끔"이 반복되는 모양이 됩니다.
    const controller = toolControllerRef.current
    const totalTicks = Math.round(FOCUS_BLINK_TOTAL_MS / FOCUS_BLINK_STEP_MS)
    let tick = 0
    const intervalId = window.setInterval(() => {
      tick += 1
      if (controller) {
        controller.overlay.focusHighlight = tick % 2 === 1 ? { c, r } : null
        rendererRef.current?.markDirty('overlay')
        engineRef.current?.scheduleAll()
      }
      if (tick >= totalTicks) window.clearInterval(intervalId)
    }, FOCUS_BLINK_STEP_MS)

    // 깜빡임 도중 다른 항목을 또 클릭하거나(effect 재실행) 컴포넌트가 사라지면 타이머를
    // 반드시 정리하고, 강조 표시도 깨끗하게 꺼둡니다(안 그러면 새 위치와 옛 위치가
    // 동시에 깜빡이거나, 꺼지지 않은 강조가 화면에 남을 수 있습니다).
    return () => {
      window.clearInterval(intervalId)
      if (controller) {
        controller.overlay.focusHighlight = null
        rendererRef.current?.markDirty('overlay')
        engineRef.current?.scheduleAll()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

  // doc은 React state라 값이 바뀔 때마다 다시 렌더되므로, 항상 최신 값을 docRef에 반영해두고
  // 격자·아트 레이어를 다시 그리게 합니다(문서가 아예 없다가 생기는 최초 순간 포함,
  // 그리고 도구 동작이 setDoc으로 문서를 바꿀 때마다도 이 경로를 그대로 탑니다).
  useEffect(() => {
    docRef.current = doc
    if (doc) {
      rendererRef.current?.markDirty('paper', 'art', 'grid', 'props')
      engineRef.current?.maybeFitOnce()
      engineRef.current?.syncUiState()
      engineRef.current?.scheduleAll()
    }
  }, [doc])

  // 팬 중이 아닐 때는 지금 고른 도구에 맞는 커서로 바꿉니다. 팬 관련 핸들러들은 이
  // effect와 별개로 grab/grabbing을 직접 지정하며, 팬이 끝나는 순간 cursorForTool로
  // 되돌립니다(아래 handlePointerUpOrCancel 참고) — 그래서 여기서는 "팬 중이 아닌 지금"만
  // 다루면 됩니다.
  useEffect(() => {
    const bodyWrap = bodyWrapRef.current
    if (!bodyWrap) return
    if (isPanningRef.current || isSpaceDownRef.current) return
    bodyWrap.style.cursor = cursorForTool(activeTool)
  }, [activeTool])

  // 마운트 시 한 번만: 렌더러·도구 컨트롤러·리사이즈 관찰·입력 이벤트를 전부 연결합니다.
  // 아래 함수들은 전부 ref를 통해 "최신" 값(doc, viewport 등)을 읽거나 Zustand의
  // getState()로 그때그때 최신 상태를 읽으므로, 이 effect 자체는 의존성 없이 한 번만
  // 실행해도 안전합니다(클로저 안에 오래된 값이 갇히지 않음).
  useEffect(() => {
    const bodyWrap = bodyWrapRef.current
    const bodyCanvas = bodyCanvasRef.current
    const rulerTop = rulerTopRef.current
    const rulerLeft = rulerLeftRef.current
    if (!bodyWrap || !bodyCanvas || !rulerTop || !rulerLeft) return

    const renderer = new LayeredRenderer(bodyCanvas)
    rendererRef.current = renderer

    function drawMainLayer(name: LayerName, ctx: CanvasRenderingContext2D) {
      const currentDoc = docRef.current
      if (!currentDoc) return
      const tokens = getTokens()
      if (name === 'paper') drawPaperLayer(ctx, viewportRef.current, currentDoc, tokens)
      else if (name === 'art') drawArtLayer(ctx, viewportRef.current, currentDoc)
      else if (name === 'grid') drawGridLayer(ctx, viewportRef.current, currentDoc, tokens)
      else if (name === 'props') {
        // props → labels → markers를 한 레이어 안에서 순서대로 이어 그립니다(§5 고정
        // 렌더 순서). 셋 다 "자유 배치 오브젝트"라는 성격이 같아 항상 같이 dirty해지므로
        // 레이어를 늘려서 얻는 실익이 없습니다(drawBoard.ts의 drawLabelsLayer 주석 참고).
        drawPropsLayer(ctx, viewportRef.current, currentDoc)
        drawLabelsLayer(ctx, viewportRef.current, currentDoc, tokens)
        drawMarkersLayer(ctx, viewportRef.current, currentDoc)
      } else if (name === 'overlay') {
        const overlay = toolControllerRef.current?.overlay
        if (overlay) drawOverlayLayer(ctx, viewportRef.current, currentDoc, tokens, overlay)
      }
    }

    // 도구 컨트롤러: 포인터/키보드 입력을 실제 도구 동작(타일 찍기, 격자선 긋기 등)으로
    // 바꾸는 역할 전체를 여기 위임합니다. requestRender 콜백은 markDirty로 표시된
    // 레이어만 다시 그리므로, 오버레이만 바뀐 경우(마우스만 움직임) 종이·아트·격자는
    // 다시 계산되지 않습니다(작업 지시 3번: "markDirty('overlay')만 호출").
    //
    // [getDoc이 docRef가 아니라 store.getState().doc인 이유] docRef.current는 React가
    // "이 doc으로 다시 그려라"라고 통지받은 뒤 useEffect에서 갱신하는 값이라, 리렌더가
    // 아직 끝나지 않은 그 찰나에는 실제로 setDoc한 값보다 한 박자 뒤처질 수 있습니다.
    // ToolController는 pointerup 안에서 "방금 이 문서를 바꿨는지"를 같은 동기 실행
    // 안에서 바로 비교해야 하므로(제스처 실행취소 판단), 그 순간에도 항상 정확한
    // Zustand의 getState()를 직접 읽어야 합니다 — 그리기 전용 docRef와 용도가 다릅니다.
    const toolController = new ToolController(
      viewportRef.current,
      () => useEditorStore.getState().doc,
      (...names) => renderer.markDirty(...names),
      () => renderer.requestRender(drawMainLayer),
      (index, isNew) => {
        labelEditHandledRef.current = false
        setEditingLabel({ index, isNew })
      },
    )
    toolControllerRef.current = toolController

    function drawRulers() {
      const { width, height } = bodySizeRef.current
      if (width <= 0 || height <= 0) return
      const tokens = getTokens()
      // rulerTop/rulerLeft는 이 effect 맨 위에서 이미 null이 아님을 확인했습니다(TS는 중첩
      // 함수 클로저 안에서는 그 확인을 기억하지 못해 !로 다시 알려줘야 합니다).
      const topCtx = sizeCanvasForDpr(rulerTop!, width, RULER_THICKNESS_PX)
      drawHorizontalRuler(topCtx, viewportRef.current, width, RULER_THICKNESS_PX, tokens)
      const leftCtx = sizeCanvasForDpr(rulerLeft!, RULER_THICKNESS_PX, height)
      drawVerticalRuler(leftCtx, viewportRef.current, RULER_THICKNESS_PX, height, tokens)
    }

    function drawMinimapCanvas() {
      const canvas = minimapCanvasRef.current
      const currentDoc = docRef.current
      if (!canvas || !currentDoc) return
      const { wMm, hMm } = mapSizeMm(currentDoc)
      const size = computeMinimapSize(wMm, hMm, MINIMAP_WIDTH_PX)
      const ctx = sizeCanvasForDpr(canvas, size.width, size.height)
      drawMinimap(ctx, viewportRef.current, currentDoc, bodySizeRef.current, size, getTokens())
    }

    // 본체(5레이어 합성)는 renderer.ts가 자체적으로 requestAnimationFrame 묶음 처리를 하고,
    // 눈금자·미니맵은 이 컴포넌트가 별도의 작은 rAF 묶음으로 처리합니다. 두 묶음 모두 같은
    // 이벤트(팬·줌·리사이즈)에서 같이 호출되므로 사실상 같은 프레임 안에서 함께 그려집니다.
    // ※ 도구 동작으로 인한 다시 그리기(타일 찍기, 오버레이 갱신 등)는 이 scheduleAll이
    //   아니라 ToolController에 넘긴 requestRender(위)만 타므로 눈금자·미니맵을 매번
    //   다시 계산하지 않습니다 — 팬·줌·리사이즈처럼 "화면 전체가 움직이는" 경우에만
    //   눈금자·미니맵도 같이 다시 그리면 됩니다.
    let rulerRafPending = false
    function scheduleAll() {
      renderer.requestRender(drawMainLayer)
      // 라벨 인라인 입력창이 떠 있는 동안에만 리렌더를 걸어 입력창을 라벨 위에 다시
      // 붙입니다(labelInputTick 선언부 주석 참고).
      if (editingLabelRef.current !== null) setLabelInputTick((n) => n + 1)
      if (rulerRafPending) return
      rulerRafPending = true
      requestAnimationFrame(() => {
        rulerRafPending = false
        drawRulers()
        drawMinimapCanvas()
      })
    }

    function syncUiState() {
      const vp = viewportRef.current
      setZoomPercent(Math.round((vp.pxPerMm / REFERENCE_PX_PER_MM) * 100))
      const currentDoc = docRef.current
      if (currentDoc) {
        const { wMm, hMm } = mapSizeMm(currentDoc)
        const size = computeMinimapSize(wMm, hMm, MINIMAP_WIDTH_PX)
        setMinimapSize(size)
        setMinimapVisible(shouldShowMinimap(vp, bodySizeRef.current, wMm, hMm))
      }
    }

    function maybeFitOnce() {
      if (hasFitOnceRef.current) return
      const currentDoc = docRef.current
      const { width, height } = bodySizeRef.current
      if (!currentDoc || width <= 0 || height <= 0) return
      const { wMm, hMm } = mapSizeMm(currentDoc)
      viewportRef.current.fit(width, height, wMm, hMm)
      hasFitOnceRef.current = true
    }

    engineRef.current = { scheduleAll, syncUiState, maybeFitOnce }

    // ── 크기 관찰: 본체 div 크기가 바뀔 때마다(창 크기 변경, 패널 접기/펼치기 등) ──────────
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      bodySizeRef.current = { width: rect.width, height: rect.height }
      renderer.resize(rect.width, rect.height)
      maybeFitOnce()
      syncUiState()
      scheduleAll()
    })
    resizeObserver.observe(bodyWrap)

    // ── 휠: 그냥 = 세로 팬 / Shift = 가로 팬 / Ctrl = 커서 기준 확대·축소 ──────────────────
    function handleWheel(e: WheelEvent) {
      // 브라우저 기본 확대(Ctrl+휠로 페이지 전체가 확대되는 동작)를 캔버스 위에서만 막습니다.
      e.preventDefault()
      const rect = bodyWrap!.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top

      if (e.ctrlKey) {
        const factor = e.deltaY < 0 ? ZOOM_WHEEL_STEP : 1 / ZOOM_WHEEL_STEP
        viewportRef.current.zoomAt(cx, cy, factor)
        syncUiState()
      } else if (e.shiftKey) {
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY
        viewportRef.current.pan(-delta, 0)
      } else {
        viewportRef.current.pan(0, -e.deltaY)
      }
      renderer.markAllDirty()
      scheduleAll()
      // 휠 팬·줌은 마우스가 가만히 있어도 뷰포트를 움직이므로, 스탬프 고스트가 커서
      // 위치를 계속 따라가도록 오버레이도 다시 계산합니다(그렇지 않으면 팬 하는 동안
      // 고스트가 예전 화면 좌표에 붙박여 엉뚱한 칸에 남아 보임).
      toolControllerRef.current?.refreshOverlayForViewportChange()
    }
    bodyWrap.addEventListener('wheel', handleWheel, { passive: false })

    // ── 브라우저 기본 우클릭 메뉴 차단(캔버스 위에서만) ────────────────────────────────────
    // FR-3.3(우클릭 재사용)이 실제로 동작하려면 이 메뉴부터 막아야 합니다. contextmenu는
    // pointerdown(button===2) 다음에 뒤이어 발생하므로, 실제 배치 자체는 아래
    // handlePointerDown이 처리합니다.
    function preventContextMenu(e: MouseEvent) {
      e.preventDefault()
    }
    bodyWrap.addEventListener('contextmenu', preventContextMenu)

    // ── 팬: Space+왼쪽 버튼 드래그, 또는 마우스 가운데 버튼 드래그 ──────────────────────────
    //    그 외의 왼쪽/오른쪽 버튼 입력은 지금 고른 도구(ToolController)에게 넘깁니다.
    /**
     * 포인터 캡처를 걸되, 실패해도 그냥 넘어갑니다.
     *
     * [왜 try/catch가 필요한가] setPointerCapture는 그 pointerId가 "지금 활성 상태"가
     * 아니면 NotFoundError를 던집니다. 그런데 예전 코드는 이 호출을 도구 동작
     * (handlePointerDown)보다 먼저 했기 때문에, 캡처가 한 번 실패하면 예외가 위로
     * 튀면서 그 아래 도구 동작이 통째로 실행되지 않았습니다 — 사용자 눈에는 "클릭했는데
     * 아무 일도 안 일어남"으로 보입니다. 캡처는 어디까지나 "드래그가 캔버스 밖으로
     * 나가도 이어지게 해주는 편의 기능"일 뿐, 클릭 한 번을 처리하는 데 반드시 필요한
     * 것이 아닙니다. 그러니 실패하면 캡처만 포기하고 도구 동작은 정상 진행합니다.
     */
    function tryCapturePointer(pointerId: number) {
      try {
        bodyWrap!.setPointerCapture(pointerId)
      } catch {
        // 캡처 실패 = 드래그가 캔버스 밖으로 나가면 끊길 수 있다는 뜻일 뿐입니다.
      }
    }

    function handlePointerDown(e: PointerEvent) {
      const isMiddleButton = e.button === 1
      const isSpaceDrag = e.button === 0 && isSpaceDownRef.current
      if (isMiddleButton || isSpaceDrag) {
        e.preventDefault()
        isPanningRef.current = true
        lastPointerRef.current = { x: e.clientX, y: e.clientY }
        tryCapturePointer(e.pointerId)
        bodyWrap!.style.cursor = 'grabbing'
        return
      }
      if (e.button !== 0 && e.button !== 2) return
      // 포인터 캡처: 드래그 도중 커서가 캔버스 밖으로 나가도(빠르게 훑거나 가장자리
      // 근처에서 영역을 채울 때) pointermove/pointerup이 계속 이 요소로 들어오게 합니다.
      tryCapturePointer(e.pointerId)
      const rect = bodyWrap!.getBoundingClientRect()
      toolControllerRef.current?.handlePointerDown(e, rect)
    }
    function handlePointerMove(e: PointerEvent) {
      if (isPanningRef.current && lastPointerRef.current) {
        const dx = e.clientX - lastPointerRef.current.x
        const dy = e.clientY - lastPointerRef.current.y
        lastPointerRef.current = { x: e.clientX, y: e.clientY }
        viewportRef.current.pan(dx, dy)
        renderer.markAllDirty()
        scheduleAll()
        return
      }
      const rect = bodyWrap!.getBoundingClientRect()
      toolControllerRef.current?.handlePointerMove(e, rect)
    }
    function handlePointerUpOrCancel(e: PointerEvent) {
      if (isPanningRef.current) {
        isPanningRef.current = false
        lastPointerRef.current = null
        if (bodyWrap!.hasPointerCapture(e.pointerId)) bodyWrap!.releasePointerCapture(e.pointerId)
        bodyWrap!.style.cursor = isSpaceDownRef.current
          ? 'grab'
          : cursorForTool(useEditorStore.getState().activeTool)
        return
      }
      const rect = bodyWrap!.getBoundingClientRect()
      toolControllerRef.current?.handlePointerUp(e, rect)
      if (bodyWrap!.hasPointerCapture(e.pointerId)) bodyWrap!.releasePointerCapture(e.pointerId)
    }
    function handlePointerLeaveBody() {
      toolControllerRef.current?.handlePointerLeave()
    }
    // 가운데 버튼을 눌렀다 뗄 때 브라우저의 자동 스크롤 아이콘이 뜨지 않도록 막습니다.
    function preventAuxClick(e: MouseEvent) {
      if (e.button === 1) e.preventDefault()
    }
    bodyWrap.addEventListener('pointerdown', handlePointerDown)
    bodyWrap.addEventListener('pointermove', handlePointerMove)
    bodyWrap.addEventListener('pointerup', handlePointerUpOrCancel)
    bodyWrap.addEventListener('pointercancel', handlePointerUpOrCancel)
    bodyWrap.addEventListener('pointerleave', handlePointerLeaveBody)
    bodyWrap.addEventListener('auxclick', preventAuxClick)

    // ── FR-3.2: 팔레트 → 캔버스 드래그 앤 드롭 ──────────────────────────────────────
    // dragover에서 반드시 preventDefault()를 호출해야 drop 이벤트가 옵니다(브라우저
    // 기본값은 "이 요소는 드롭을 못 받는다"라서, 막지 않으면 drop이 아예 발생하지 않음).
    function handleDragOver(e: DragEvent) {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      const rect = bodyWrap!.getBoundingClientRect()
      toolControllerRef.current?.handleDragOver(e.clientX - rect.left, e.clientY - rect.top, e.shiftKey)
    }
    // dragleave는 bodyWrap 안의 자식 요소(캔버스, 줌 클러스터 등) 사이를 넘나들 때도
    // 발생합니다(mouseleave와 달리 자식으로 들어가도 한 번 발생). 그걸 그대로 고스트를
    // 지우는 신호로 쓰면 캔버스 위에서 드래그하는 내내 고스트가 깜빡입니다. 그래서 실제로
    // bodyWrap 사각형 밖으로 나갔을 때만(좌표로 직접 확인) 고스트를 지웁니다.
    function handleDragLeaveBody(e: DragEvent) {
      const rect = bodyWrap!.getBoundingClientRect()
      const outside = e.clientX < rect.left || e.clientX >= rect.right || e.clientY < rect.top || e.clientY >= rect.bottom
      if (outside) toolControllerRef.current?.handleDragLeave()
    }
    function handleDrop(e: DragEvent) {
      e.preventDefault()
      const assetId = e.dataTransfer?.getData('text/plain')
      if (!assetId) return
      const rect = bodyWrap!.getBoundingClientRect()
      toolControllerRef.current?.handleDrop(assetId, e.clientX - rect.left, e.clientY - rect.top, e.shiftKey)
    }
    bodyWrap.addEventListener('dragover', handleDragOver)
    bodyWrap.addEventListener('dragleave', handleDragLeaveBody)
    bodyWrap.addEventListener('drop', handleDrop)

    // ── Space바를 누르고 있는 동안 커서를 grab으로(누르기 전엔 도구별 커서) ─────────────────
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' || isTypingTarget(document.activeElement)) return
      e.preventDefault() // Space의 기본 동작(페이지 스크롤)을 막음
      if (isSpaceDownRef.current) return
      isSpaceDownRef.current = true
      if (!isPanningRef.current) bodyWrap!.style.cursor = 'grab'
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      isSpaceDownRef.current = false
      if (!isPanningRef.current) bodyWrap!.style.cursor = cursorForTool(useEditorStore.getState().activeTool)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // ── 도구 단축키(R 회전, F 반전 — FR-3.4)는 ToolController가 직접 처리합니다 ───────────
    function handleToolShortcutKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      toolControllerRef.current?.handleKeyDown(e)
    }
    window.addEventListener('keydown', handleToolShortcutKeyDown)

    // ── 타일 이미지가 새로 디코드될 때마다 아트 레이어만 다시 그림 ───────────────────────────
    const unsubscribeTiles = tileBitmapCache.onLoad(() => {
      renderer.markDirty('art')
      scheduleAll()
    })

    return () => {
      resizeObserver.disconnect()
      bodyWrap.removeEventListener('wheel', handleWheel)
      bodyWrap.removeEventListener('contextmenu', preventContextMenu)
      bodyWrap.removeEventListener('pointerdown', handlePointerDown)
      bodyWrap.removeEventListener('pointermove', handlePointerMove)
      bodyWrap.removeEventListener('pointerup', handlePointerUpOrCancel)
      bodyWrap.removeEventListener('pointercancel', handlePointerUpOrCancel)
      bodyWrap.removeEventListener('pointerleave', handlePointerLeaveBody)
      bodyWrap.removeEventListener('auxclick', preventAuxClick)
      bodyWrap.removeEventListener('dragover', handleDragOver)
      bodyWrap.removeEventListener('dragleave', handleDragLeaveBody)
      bodyWrap.removeEventListener('drop', handleDrop)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('keydown', handleToolShortcutKeyDown)
      unsubscribeTiles()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 줌 클러스터 버튼 핸들러. 전부 "본체 화면 한가운데"를 기준으로 확대/축소합니다 ───────────
  // (마우스가 안 움직여도 뷰포트가 바뀌므로, 휠 팬·줌과 마찬가지로 오버레이도 갱신합니다)
  function zoomByFactor(factor: number) {
    const { width, height } = bodySizeRef.current
    viewportRef.current.zoomAt(width / 2, height / 2, factor)
    rendererRef.current?.markAllDirty()
    engineRef.current?.syncUiState()
    engineRef.current?.scheduleAll()
    toolControllerRef.current?.refreshOverlayForViewportChange()
  }
  function handleZoomOut() {
    zoomByFactor(1 / ZOOM_WHEEL_STEP)
  }
  function handleZoomIn() {
    zoomByFactor(ZOOM_WHEEL_STEP)
  }
  function handleResetZoom() {
    const { width, height } = bodySizeRef.current
    viewportRef.current.zoomTo(width / 2, height / 2, REFERENCE_PX_PER_MM)
    rendererRef.current?.markAllDirty()
    engineRef.current?.syncUiState()
    engineRef.current?.scheduleAll()
    toolControllerRef.current?.refreshOverlayForViewportChange()
  }
  // ── T 도구 인라인 라벨 편집: 입력창이 뜨면 바로 포커스 + 전체 선택 ──────────────────
  useEffect(() => {
    editingLabelRef.current = editingLabel
    if (editingLabel === null) return
    const el = labelInputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [editingLabel])

  /**
   * 라벨 편집을 끝냅니다. cancel=false면 입력창의 값을 doc에 반영(확정)하고,
   * cancel=true면 Esc로 취소한 것이라 값을 버립니다(새로 만든 빈 라벨이었다면 통째로 삭제).
   *
   * [스냅샷 없이 doc만 갱신하는 경우가 있는 이유] T 도구가 라벨을 처음 만들 때 이미
   * commitDoc으로 실행취소 한 단계를 쌓아뒀습니다(ToolController.placeOrEditLabel).
   * 그 위에서 "빈 텍스트 → 사용자가 친 텍스트"를 또 commitDoc으로 쌓으면, 사용자
   * 입장에서는 라벨 하나를 만들었을 뿐인데 Ctrl+Z를 두 번 눌러야 사라지는 것처럼
   * 느껴집니다. 그래서 "방금 만든 라벨의 첫 텍스트 채우기"만 setDoc으로 조용히
   * 반영하고, 이미 있던 라벨을 다시 고치는 경우(isNew=false)에는 평소처럼 정상적으로
   * commitDoc을 씁니다.
   */
  function commitLabelEdit(cancel: boolean) {
    // Enter 확정이 입력창을 없애면서 유발하는 blur도 확정을 한 번 더 시도합니다.
    // 같은 편집을 두 번 처리하면(특히 isNew=false일 때) 실행취소 스택에 똑같은 변경이
    // 중복으로 쌓이므로, 이번 편집을 이미 처리했으면 두 번째 호출은 무시합니다.
    if (labelEditHandledRef.current) return
    labelEditHandledRef.current = true

    const current = editingLabel
    const inputEl = labelInputRef.current
    setEditingLabel(null)
    if (current === null) return
    // toolInteractions.ts의 ToolController 생성자 주석과 같은 이유로 docRef가 아니라
    // 항상 최신 값을 돌려주는 store.getState().doc을 읽습니다 — 이 함수는 키보드/blur
    // 이벤트 핸들러라 React 리렌더 타이밍과 무관하게 "지금 이 순간의 진짜 doc"이 필요합니다.
    const currentDoc = useEditorStore.getState().doc
    if (!currentDoc) return
    const label = currentDoc.labels[current.index]
    if (!label) return

    if (cancel) {
      if (current.isNew) {
        const nextLabels = currentDoc.labels.slice()
        nextLabels.splice(current.index, 1)
        useEditorStore.getState().setDoc({ ...currentDoc, labels: nextLabels })
        useEditorStore.getState().setSelection(null)
      }
      // isNew가 아니면(기존 라벨을 고치던 중이었으면) 아무것도 안 바꾸고 그냥 편집만 닫습니다.
      return
    }

    const nextText = (inputEl?.value ?? label.text).trim()
    const nextLabels = currentDoc.labels.slice()

    // [빈 글자로 확정하면 라벨을 지웁니다]
    // 글자가 없는 라벨은 화면에도 인쇄물에도 아무것도 안 보입니다. 그런데 문서
    // (.hsmap.json)에는 좌표만 가진 유령 항목으로 남아, 나중에 V 도구로 아무것도 없는
    // 자리를 클릭했는데 뭔가 선택되는 등 사용자가 설명할 수 없는 일이 생깁니다.
    // T 도구로 잘못 클릭하고 Esc 대신 그냥 다른 곳을 눌러 빠져나오는 건 아주 흔한
    // 조작이므로, 그 경우를 취소와 똑같이 처리합니다.
    if (nextText === '') {
      nextLabels.splice(current.index, 1)
      const cleaned: MapDoc = { ...currentDoc, labels: nextLabels }
      useEditorStore.getState().setSelection(null)
      if (current.isNew) {
        // 방금 만든 라벨이 그대로 사라졌으니 문서는 만들기 전과 똑같습니다.
        // 라벨을 만들 때 쌓아둔 실행취소 한 칸은 되돌릴 게 없는 빈 칸이라 걷어냅니다.
        useEditorStore.getState().setDoc(cleaned)
        useEditorStore.getState().dropLastUndoSnapshot()
        saveDraft(cleaned)
      } else {
        // 원래 글자가 있던 라벨을 비운 것이므로 이건 진짜 삭제입니다 — 되돌릴 수 있어야 합니다.
        useEditorStore.getState().commitDoc(cleaned)
      }
      return
    }

    nextLabels[current.index] = { ...label, text: nextText }
    const next: MapDoc = { ...currentDoc, labels: nextLabels }

    if (current.isNew) {
      useEditorStore.getState().setDoc(next)
      if (useEditorStore.getState().saveState !== 'unsaved') useEditorStore.getState().setSaveState('unsaved')
      saveDraft(next)
    } else {
      useEditorStore.getState().commitDoc(next)
    }
  }

  function handleFit() {
    const currentDoc = docRef.current
    if (!currentDoc) return
    const { width, height } = bodySizeRef.current
    const { wMm, hMm } = mapSizeMm(currentDoc)
    viewportRef.current.fit(width, height, wMm, hMm)
    rendererRef.current?.markAllDirty()
    engineRef.current?.syncUiState()
    engineRef.current?.scheduleAll()
    toolControllerRef.current?.refreshOverlayForViewportChange()
  }

  return (
    <div className={styles.root}>
      <div className={styles.corner} />
      <canvas ref={rulerTopRef} className={styles.rulerTop} />
      <canvas ref={rulerLeftRef} className={styles.rulerLeft} />

      <div ref={bodyWrapRef} className={styles.body}>
        <canvas ref={bodyCanvasRef} className={styles.bodyCanvas} />

        {editingLabel && doc?.labels[editingLabel.index] && (
          (() => {
            const label = doc.labels[editingLabel.index]
            const screenPos = viewportRef.current.mapToScreen(label.x, label.y)
            return (
              <input
                key={editingLabel.index}
                ref={labelInputRef}
                className={styles.labelInput}
                // labelInputTick 자체는 화면에 쓰이지 않지만, 이 값이 바뀌어야 위 style의
                // 화면 좌표가 다시 계산됩니다(선언부 주석 참고). 속성으로 한 번 읽어 둡니다.
                data-viewport-tick={labelInputTick}
                style={{ left: screenPos.x, top: screenPos.y }}
                defaultValue={label.text}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitLabelEdit(false)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    commitLabelEdit(true)
                  }
                }}
                onBlur={() => commitLabelEdit(false)}
              />
            )
          })()
        )}

        {minimapVisible && doc && (
          <div
            className={styles.minimapPanel}
            style={{ width: minimapSize.width, height: minimapSize.height }}
          >
            <canvas ref={minimapCanvasRef} className={styles.minimapCanvas} />
          </div>
        )}

        <div className={styles.zoomCluster}>
          <Tooltip content="축소" placement="top">
            <button type="button" className={styles.zoomIconButton} aria-label="축소" onClick={handleZoomOut}>
              <ZoomOut size={16} />
            </button>
          </Tooltip>
          <Tooltip content="100%로 보기" placement="top">
            <button type="button" className={`${styles.zoomLabel} t-label t-nums`} onClick={handleResetZoom}>
              {zoomPercent}%
            </button>
          </Tooltip>
          <Tooltip content="확대" placement="top">
            <button type="button" className={styles.zoomIconButton} aria-label="확대" onClick={handleZoomIn}>
              <ZoomIn size={16} />
            </button>
          </Tooltip>
          <span className={styles.zoomDivider} aria-hidden="true" />
          <Tooltip content="화면에 맞춤" placement="top">
            <button type="button" className={styles.zoomIconButton} aria-label="화면에 맞춤" onClick={handleFit}>
              <Maximize2 size={16} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
