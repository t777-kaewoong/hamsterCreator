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
import { REFERENCE_PX_PER_MM, Viewport, ZOOM_WHEEL_STEP } from './viewport'
import { LayeredRenderer } from './renderer'
import type { LayerName } from './renderer'
import { drawArtLayer, drawGridLayer, drawPaperLayer, mapSizeMm } from './drawBoard'
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

  // doc은 React state라 값이 바뀔 때마다 다시 렌더되므로, 항상 최신 값을 docRef에 반영해두고
  // 격자·아트 레이어를 다시 그리게 합니다(문서가 아예 없다가 생기는 최초 순간 포함,
  // 그리고 도구 동작이 setDoc으로 문서를 바꿀 때마다도 이 경로를 그대로 탑니다).
  useEffect(() => {
    docRef.current = doc
    if (doc) {
      rendererRef.current?.markDirty('paper', 'art', 'grid')
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
      else if (name === 'overlay') {
        const overlay = toolControllerRef.current?.overlay
        if (overlay) drawOverlayLayer(ctx, viewportRef.current, currentDoc, tokens, overlay)
      }
      // 'props'는 프롭·라벨을 놓는 도구가 아직 없어 계속 빈 채로 둡니다.
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
    function handlePointerDown(e: PointerEvent) {
      const isMiddleButton = e.button === 1
      const isSpaceDrag = e.button === 0 && isSpaceDownRef.current
      if (isMiddleButton || isSpaceDrag) {
        e.preventDefault()
        isPanningRef.current = true
        lastPointerRef.current = { x: e.clientX, y: e.clientY }
        bodyWrap!.setPointerCapture(e.pointerId)
        bodyWrap!.style.cursor = 'grabbing'
        return
      }
      if (e.button !== 0 && e.button !== 2) return
      // 포인터 캡처: 드래그 도중 커서가 캔버스 밖으로 나가도(빠르게 훑거나 가장자리
      // 근처에서 영역을 채울 때) pointermove/pointerup이 계속 이 요소로 들어오게 합니다.
      bodyWrap!.setPointerCapture(e.pointerId)
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
