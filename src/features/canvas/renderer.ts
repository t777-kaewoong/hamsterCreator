// 레이어 분리 렌더 파이프라인.
//
// [왜 레이어를 5장으로 나누는가]
// 팬·줌은 화면 전체가 바뀌니 다시 그려야 하지만, "타일 하나만 바꿨다"처럼 작은 변경까지
// 매번 격자선·안내선·종이 배경까지 전부 다시 그리면 느려집니다. 그래서 성격이 다른 그림을
// 5장의 캔버스(레이어)로 나눠 각자 따로 그리고, 마지막에 화면에 보이는 캔버스 하나에
// 순서대로 겹쳐(합성) 찍습니다. "더티(dirty)" 표시가 있는 레이어만 실제로 다시 그리고,
// 나머지 레이어는 지난번에 그려둔 내용을 그대로 재사용합니다.
//
// 레이어 순서(아래가 위에 겹쳐짐, PRD §9.12):
//   ① paper   종이 배경 + 셀 경계 안내선 + 격자 노드 점
//   ② art     칸에 놓인 아트 타일
//   ③ grid    격자선(및 장차 자유곡선)
//   ④ props   자유 배치 오브젝트(Shift로 놓은 props). 라벨은 아직 배치 도구가 없어 항상 비어 있음
//   ⑤ overlay 호버·고스트 등 상호작용 표시(이번 단계는 자리만 두고 비워둠 — 다음 단계에서 채움)
//
// [왜 OffscreenCanvas API 대신 평범한 <canvas> 요소를 쓰는가]
// 레이어 5장은 화면에 안 붙이고(DOM에 넣지 않고) 메모리에서만 쓰는 "오프스크린" 용도라는
// 점에서 이름이 같은 OffscreenCanvas API를 쓸 수도 있었지만, 그냥 document.createElement
// ('canvas')로 만든 요소도 DOM에 안 붙이면 화면에 안 보이면서 그대로 오프스크린으로 씁니다.
// API 하나를 덜 배워도 되고 구형 브라우저 호환성 걱정도 없어 이 방식을 골랐습니다.
export type LayerName = 'paper' | 'art' | 'grid' | 'props' | 'overlay'

/** 합성(겹쳐 그리기) 순서. 배열의 앞이 아래, 뒤가 위에 그려집니다. */
const LAYER_ORDER: LayerName[] = ['paper', 'art', 'grid', 'props', 'overlay']

export type DrawLayerFn = (name: LayerName, ctx: CanvasRenderingContext2D) => void

export class LayeredRenderer {
  private layers = new Map<LayerName, HTMLCanvasElement>()
  private dirty = new Set<LayerName>(LAYER_ORDER) // 시작할 땐 전부 그려야 하므로 전부 dirty
  private cssWidth = 0
  private cssHeight = 0
  private dpr = 1
  private rafId: number | null = null

  constructor(private readonly visible: HTMLCanvasElement) {
    for (const name of LAYER_ORDER) {
      this.layers.set(name, document.createElement('canvas'))
    }
  }

  /** 지금 캔버스가 화면에서 차지하는 CSS 픽셀 크기. requestRender에서 clearRect 범위 계산에 씁니다. */
  get size(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight }
  }

  /**
   * 캔버스 표시 크기(CSS px)가 바뀔 때마다 호출합니다(최초 마운트 포함).
   *
   * [DPR 처리 — 저해상도 렌더 금지]
   * 모니터 배율(devicePixelRatio, 이하 dpr)이 2인 화면(흔한 노트북·맥)에서 캔버스의 실제
   * 픽셀 수(width/height 속성)를 CSS 크기와 똑같이 두면, 그 캔버스는 물리 픽셀의 1/4만 쓰는
   * 흐릿한 그림이 됩니다. 그래서 실제 픽셀 수는 "CSS크기 × dpr"로 크게 만들고, 대신
   * setTransform(dpr,0,0,dpr,0,0)으로 그리기 좌표계를 다시 CSS 픽셀 단위로 되돌립니다.
   * 이렇게 하면 그리기 코드(drawBoard.ts 등)는 dpr을 전혀 신경 쓰지 않고 항상 "CSS 픽셀
   * 기준"으로 좌표를 계산해도, 화면에는 물리 해상도 그대로 선명하게 나옵니다.
   */
  resize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = cssWidth
    this.cssHeight = cssHeight
    this.dpr = window.devicePixelRatio || 1
    const pxW = Math.max(1, Math.round(cssWidth * this.dpr))
    const pxH = Math.max(1, Math.round(cssHeight * this.dpr))

    this.applySize(this.visible, cssWidth, cssHeight, pxW, pxH)
    for (const canvas of this.layers.values()) {
      this.applySize(canvas, cssWidth, cssHeight, pxW, pxH)
    }
    this.markAllDirty()
  }

  private applySize(canvas: HTMLCanvasElement, cssW: number, cssH: number, pxW: number, pxH: number): void {
    canvas.width = pxW
    canvas.height = pxH
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
  }

  /** 이 레이어들은 다음 requestRender 때 다시 그려야 한다고 표시합니다. */
  markDirty(...names: LayerName[]): void {
    for (const name of names) this.dirty.add(name)
  }

  /** 팬·줌처럼 화면 전체가 움직일 때 전부 다시 그리도록 표시합니다. */
  markAllDirty(): void {
    for (const name of LAYER_ORDER) this.dirty.add(name)
  }

  /**
   * dirty 표시된 레이어만 drawLayer 콜백으로 다시 그리고, 5장을 순서대로 합성해
   * 화면에 보이는 캔버스에 그립니다. requestAnimationFrame 하나로 묶여 있어서, 같은
   * 프레임 안에서 이 함수가 여러 번 불려도(예: 마우스move 이벤트가 여러 번 와도)
   * 실제 그리기는 프레임당 한 번만 실행됩니다.
   */
  requestRender(drawLayer: DrawLayerFn): void {
    if (this.rafId !== null) return // 이미 이번 프레임 그리기가 예약되어 있으면 또 예약하지 않음
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      for (const name of LAYER_ORDER) {
        if (!this.dirty.has(name)) continue // 안 바뀐 레이어는 지난 내용을 그대로 재사용
        const canvas = this.layers.get(name)!
        const ctx = canvas.getContext('2d')!
        ctx.save()
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0) // 그리기 좌표계를 CSS 픽셀 기준으로
        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight)
        drawLayer(name, ctx)
        ctx.restore()
      }
      this.dirty.clear()
      this.composite()
    })
  }

  /** 레이어 5장을 정해진 순서대로 겹쳐서 화면에 보이는 캔버스 하나로 합칩니다. */
  private composite(): void {
    const ctx = this.visible.getContext('2d')!
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0) // 레이어 캔버스를 물리 픽셀 그대로 복사(이미 dpr 반영됨)
    ctx.clearRect(0, 0, this.visible.width, this.visible.height)
    for (const name of LAYER_ORDER) {
      ctx.drawImage(this.layers.get(name)!, 0, 0)
    }
    ctx.restore()
  }
}
