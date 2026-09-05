// 캔버스 상단·좌측 눈금자를 그리는 함수들 (PRD §9.12 표).
//
// 눈금자의 원점은 항상 "아트보드 좌상단(맵의 0mm)"입니다. 팬·줌을 하면 viewport의
// originPx/pxPerMm이 바뀌고, 이 파일은 그 값을 그대로 써서 눈금 위치를 계산하므로
// 본체 캔버스와 자동으로 같이 움직입니다 — 눈금자만 따로 관리하는 상태는 없습니다.
import type { Viewport } from './viewport'
import type { TokenName } from './cssTokens'

/** 작은 눈금 간격(mm). PRD: "눈금 10mm마다 4px" */
const MINOR_STEP_MM = 10
/** 큰 눈금 간격(mm) — 숫자가 붙는 눈금. PRD: "50mm마다 8px + micro 크기 숫자" */
const MAJOR_STEP_MM = 50
const MINOR_TICK_PX = 4
const MAJOR_TICK_PX = 8
/** 작은 눈금끼리의 화면 간격이 이 값(px) 미만이 되면 작은 눈금을 생략하고 큰 눈금만
 *  표시합니다(PRD §9.12: "간격 4px 미만"). 너무 촘촘하면 눈금이 아니라 회색 띠로 보이기 때문. */
const MIN_MINOR_SPACING_PX = 4

/** micro 타이포(PRD §9.4: 11px, weight 600)를 캔버스 폰트 문자열로. typography.css의 폴백
 *  스택과 맞췄습니다(캔버스는 CSS 클래스를 못 써서 폰트 문자열을 직접 적어야 합니다). */
const TICK_FONT = '600 11px Pretendard, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif'

type Tokens = Record<TokenName, string>

interface Tick {
  /** 이 눈금이 그려질 화면 좌표(CSS px), 가로 눈금자면 x, 세로 눈금자면 y */
  screenPos: number
  /** 맵 좌표(mm). 반올림해서 숫자로 표시 */
  mm: number
  /** 50mm 단위 눈금(숫자가 붙는 큰 눈금)인지 */
  major: boolean
}

/** 지금 화면에 보이는 mm 범위 안에서 그려야 할 눈금 목록을 계산합니다. */
function collectTicks(viewport: Viewport, axis: 'x' | 'y', lengthPx: number): Tick[] {
  const minorSpacingPx = MINOR_STEP_MM * viewport.pxPerMm
  const showMinor = minorSpacingPx >= MIN_MINOR_SPACING_PX
  const stepMm = showMinor ? MINOR_STEP_MM : MAJOR_STEP_MM

  const startMm = axis === 'x' ? viewport.screenToMap(0, 0).mx : viewport.screenToMap(0, 0).my
  const endMm = axis === 'x' ? viewport.screenToMap(lengthPx, 0).mx : viewport.screenToMap(0, lengthPx).my

  // 화면 맨 앞(0px)보다 앞선 mm부터 시작해야 화면 가장자리에서 눈금이 잘려 보이지 않습니다.
  const firstMm = Math.floor(startMm / stepMm) * stepMm

  const ticks: Tick[] = []
  for (let mm = firstMm; mm <= endMm + stepMm; mm += stepMm) {
    const screenPos = axis === 'x' ? viewport.mapToScreen(mm, 0).x : viewport.mapToScreen(0, mm).y
    // Math.round로 부동소수점 오차(예: 49.9999999)를 정수로 정리한 뒤 50의 배수인지 확인합니다.
    const major = Math.round(mm) % MAJOR_STEP_MM === 0
    ticks.push({ screenPos, mm, major })
  }
  return ticks
}

/** 상단(가로) 눈금자. widthPx는 본체 캔버스와 같은 폭, heightPx는 눈금자 두께(24px 고정). */
export function drawHorizontalRuler(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  widthPx: number,
  heightPx: number,
  tokens: Tokens,
): void {
  ctx.clearRect(0, 0, widthPx, heightPx)
  ctx.fillStyle = tokens['--c-surface-2']
  ctx.fillRect(0, 0, widthPx, heightPx)

  ctx.font = TICK_FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  for (const tick of collectTicks(viewport, 'x', widthPx)) {
    const tickLen = tick.major ? MAJOR_TICK_PX : MINOR_TICK_PX
    ctx.strokeStyle = tick.major ? tokens['--c-text-2'] : tokens['--c-border-strong']
    ctx.lineWidth = 1
    ctx.beginPath()
    // 본체(캔버스 몸통)와 맞닿는 아래쪽 끝에서 시작해 위로 tickLen만큼만 그립니다.
    ctx.moveTo(tick.screenPos, heightPx)
    ctx.lineTo(tick.screenPos, heightPx - tickLen)
    ctx.stroke()

    if (tick.major) {
      ctx.fillStyle = tokens['--c-text-2']
      ctx.fillText(String(Math.round(tick.mm)), tick.screenPos + 2, heightPx - tickLen - 6)
    }
  }
}

/** 좌측(세로) 눈금자. widthPx는 눈금자 두께(24px 고정), heightPx는 본체와 같은 높이. */
export function drawVerticalRuler(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  widthPx: number,
  heightPx: number,
  tokens: Tokens,
): void {
  ctx.clearRect(0, 0, widthPx, heightPx)
  ctx.fillStyle = tokens['--c-surface-2']
  ctx.fillRect(0, 0, widthPx, heightPx)

  ctx.font = TICK_FONT

  for (const tick of collectTicks(viewport, 'y', heightPx)) {
    const tickLen = tick.major ? MAJOR_TICK_PX : MINOR_TICK_PX
    ctx.strokeStyle = tick.major ? tokens['--c-text-2'] : tokens['--c-border-strong']
    ctx.lineWidth = 1
    ctx.beginPath()
    // 본체와 맞닿는 오른쪽 끝에서 시작해 왼쪽으로 tickLen만큼만 그립니다.
    ctx.moveTo(widthPx, tick.screenPos)
    ctx.lineTo(widthPx - tickLen, tick.screenPos)
    ctx.stroke()

    if (tick.major) {
      // 세로 눈금자는 폭이 24px뿐이라 숫자를 가로로 쓰면 "150" 같은 세 자리가 잘립니다.
      // 그래서 글자를 90도 돌려 눈금을 따라 세로로 눕혀 씁니다.
      ctx.save()
      ctx.fillStyle = tokens['--c-text-2']
      ctx.translate(widthPx - tickLen - 2, tick.screenPos)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(Math.round(tick.mm)), 0, 0)
      ctx.restore()
    }
  }
}
