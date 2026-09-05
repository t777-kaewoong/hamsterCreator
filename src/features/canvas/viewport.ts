// 캔버스 좌표 변환기 (mm 맵 좌표 ↔ 화면 CSS 픽셀 좌표).
//
// 이 파일이 하는 일은 딱 하나, "지금 화면 어디에 맵의 몇 mm 지점이 그려져야 하는가"를
// 계산하는 것입니다. React나 캔버스 API를 전혀 모르는 순수 계산 코드라서, 나중에
// 이 파일만 따로 테스트(단위 테스트)하기 쉽습니다. 실제로 화면에 그리는 코드는
// renderer.ts / drawBoard.ts 에 있습니다.
//
// PRD §9.12 "좌표 변환" 절의 수식을 그대로 옮겼습니다. 여기 숫자가 하나라도 틀리면
// 격자선, 타일, 눈금자, 마우스 클릭 위치까지 전부 어긋나므로 수정 시 특히 주의하세요.

/** 화면(브라우저 창) 위의 한 점. 단위는 CSS 픽셀(=devicePixelRatio를 곱하기 전 크기). */
export interface ScreenPoint {
  x: number
  y: number
}

/** 맵 위의 한 점. 단위는 mm, 원점은 맵 좌상단(PRD §5 D1). */
export interface MapPoint {
  mx: number
  my: number
}

/** 확대 배율(pxPerMm)이 가질 수 있는 범위. 이 숫자를 바꾸면 "더 이상 확대/축소 안 됨"이
 *  걸리는 지점이 바뀝니다. PRD §9.12에 0.5~8로 명시되어 있습니다. */
export const MIN_PX_PER_MM = 0.5
export const MAX_PX_PER_MM = 8

/** 아트보드(종이)와 뷰포트 가장자리 사이에 "맞춤" 시 남기는 여백(CSS 픽셀).
 *  이 값을 키우면 맞춤했을 때 종이가 더 작게(여백이 더 넓게) 보입니다. PRD §9.12 명시값. */
export const FIT_MARGIN_PX = 48

/** 휠로 확대/축소할 때 한 번에 곱해지는 배율. 1.15보다 크게 하면 한 번의 휠 입력으로
 *  더 크게 확대/축소되어 화면이 더 "성큼성큼" 움직입니다. PRD §9.12 명시값. */
export const ZOOM_WHEEL_STEP = 1.15

/** "배율 100%"의 기준값(PRD가 정확한 정의를 주지 않아 이 파일에서 임의로 정한 값 — 아래 설명 참고).
 *
 *  [왜 pxPerMm = 1 을 100%로 정했는가]
 *  줌 클러스터의 배율 표시(예: "140%")와 "클릭하면 100%로" 동작이 있으려면, 어떤 pxPerMm 값을
 *  "100%"라고 부를지부터 정해야 합니다. 두 가지 후보가 있었습니다.
 *    1) 맞춤(fit) 배율을 100%로 본다 — 하지만 맞춤 배율은 창 크기가 바뀔 때마다 값이 달라지는
 *       상대적인 수치라서, "100%"라는 절대적인 기준으로 쓰기에는 계속 움직이는 과녁입니다.
 *    2) pxPerMm = 1 (지도의 1mm를 화면의 1 CSS픽셀로 그림)을 100%로 본다 — 창 크기와 무관하게
 *       항상 같은 배율을 가리키므로, "100%"라는 이름에 어울리는 고정된 기준입니다.
 *  그래서 2번을 골랐습니다. 즉 표시 배율(%) = Math.round(pxPerMm / REFERENCE_PX_PER_MM * 100).
 */
export const REFERENCE_PX_PER_MM = 1

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 캔버스 뷰포트 상태(배율 + 원점)를 들고 있는 작은 클래스.
 *
 * 상태값은 딱 2개뿐입니다.
 * - pxPerMm: 맵의 1mm가 화면에서 몇 CSS픽셀인지 (확대 배율)
 * - originPx: 맵 원점(0mm, 0mm)이 캔버스 요소 안 어디(CSS픽셀 좌표)에 놓이는지
 *
 * 이 두 값만 있으면 맵의 모든 mm 좌표를 화면 좌표로, 화면의 모든 클릭 좌표를 mm 좌표로
 * 바꿀 수 있습니다(아래 mapToScreen / screenToMap).
 */
export class Viewport {
  pxPerMm: number
  originPx: ScreenPoint

  constructor(pxPerMm = 1, originPx: ScreenPoint = { x: 0, y: 0 }) {
    this.pxPerMm = pxPerMm
    this.originPx = { ...originPx }
  }

  /**
   * 맵 좌표(mm) → 화면 좌표(CSS px).
   *
   * 왜 이렇게 계산하는가: 화면에서 원점(맵의 0,0mm)이 놓인 자리가 originPx이고,
   * 거기서 맵 좌표만큼(mx, my) 떨어진 지점을 그리려면 "mm 거리 × 1mm당 픽셀 수(pxPerMm)"를
   * 더해주면 됩니다. 자를 대고 원점에서 몇 mm 떨어진 곳에 점을 찍는 것과 똑같은 계산입니다.
   */
  mapToScreen(mx: number, my: number): ScreenPoint {
    return {
      x: this.originPx.x + mx * this.pxPerMm,
      y: this.originPx.y + my * this.pxPerMm,
    }
  }

  /**
   * 화면 좌표(CSS px) → 맵 좌표(mm). mapToScreen의 역연산입니다.
   *
   * 왜 이렇게 계산하는가: 화면 좌표에서 원점 위치(originPx)를 먼저 빼서 "원점으로부터
   * 화면상으로 얼마나 떨어져 있는지"를 구하고, 그 픽셀 거리를 pxPerMm으로 나누면
   * "mm로는 얼마나 떨어져 있는지"가 나옵니다. (픽셀 거리 ÷ 1mm당 픽셀 수 = mm 거리)
   */
  screenToMap(sx: number, sy: number): MapPoint {
    return {
      mx: (sx - this.originPx.x) / this.pxPerMm,
      my: (sy - this.originPx.y) / this.pxPerMm,
    }
  }

  /** mm 길이 하나를 지금 배율에서의 화면 픽셀 길이로 바꿉니다.
   *  격자선 굵기·타일 크기처럼 "실제 크기가 있는 것"을 그릴 때 씁니다. 좌표가 아니라
   *  "길이(거리)"라서 원점을 더하지 않고 pxPerMm만 곱합니다. */
  mmToPx(mm: number): number {
    return mm * this.pxPerMm
  }

  /**
   * 커서(화면) 위치를 기준으로 확대/축소합니다. 확대해도 커서 아래에 있던 맵 지점이
   * 화면에서 그대로 그 자리에 남아있어야 "확대 중심이 커서"라고 느껴집니다.
   *
   * 방법: ① 확대하기 전, 커서 아래 맵 좌표(before)를 기억해둡니다.
   *      ② 배율을 바꿉니다.
   *      ③ "커서 화면 좌표 = 새 배율로 그 맵 좌표를 그렸을 때의 화면 좌표"가 되도록
   *         원점을 역산합니다. mapToScreen 식을 originPx에 대해 풀면 이 식이 나옵니다:
   *         cx = originPx.x + before.mx * 새pxPerMm  →  originPx.x = cx - before.mx * 새pxPerMm
   *
   * @param cx, cy 커서의 화면 좌표(CSS px), 보통 캔버스 요소 기준 좌표
   * @param factor 곱할 배율. 1보다 크면 확대, 1보다 작으면 축소
   */
  zoomAt(cx: number, cy: number, factor: number): void {
    const before = this.screenToMap(cx, cy)
    this.pxPerMm = clamp(this.pxPerMm * factor, MIN_PX_PER_MM, MAX_PX_PER_MM)
    this.originPx.x = cx - before.mx * this.pxPerMm
    this.originPx.y = cy - before.my * this.pxPerMm
  }

  /** 특정 배율로 "직접" 맞추면서, zoomAt과 똑같이 (cx, cy) 아래 맵 좌표는 유지합니다.
   *  줌 클러스터의 "배율 클릭 → 100%" 버튼처럼 목표 배율이 이미 정해져 있을 때 씁니다. */
  zoomTo(cx: number, cy: number, targetPxPerMm: number): void {
    // factor = 목표배율 / 현재배율로 바꾸면 zoomAt과 완전히 같은 계산이 됩니다.
    this.zoomAt(cx, cy, targetPxPerMm / this.pxPerMm)
  }

  /**
   * 지정한 mm 좌표가 뷰포트 정중앙에 오도록 원점만 옮깁니다(배율 pxPerMm은 그대로
   * 유지 — "확대 정도"까지 바꾸면 사용자가 보던 크기가 갑자기 달라져 놀랄 수 있으므로,
   * 이 메서드는 "같은 배율로 그 자리를 가운데에 보여달라"만 처리합니다).
   *
   * [계산 근거] mapToScreen(mx, my) = originPx + (mx,my)×pxPerMm 식을 "그 결과가
   * 정확히 뷰포트 중앙(viewW/2, viewH/2)이 되도록" originPx에 대해 풀면 이 식이 나옵니다.
   * zoomAt의 originPx 역산과 같은 방식입니다.
   *
   * 인스펙터 검증 섹션(§9.13)에서 문제 위치를 클릭했을 때처럼, "이 mm 좌표를 화면
   * 가운데로 보여달라"는 요청에 씁니다.
   */
  centerOn(viewW: number, viewH: number, mx: number, my: number): void {
    this.originPx.x = viewW / 2 - mx * this.pxPerMm
    this.originPx.y = viewH / 2 - my * this.pxPerMm
  }

  /** 드래그로 화면을 미는(팬) 동작. 그냥 원점을 델타만큼 옮기면 됩니다 —
   *  같은 원점에서 같은 배율로 다시 그리되, 시작점만 이동한 것과 같기 때문입니다. */
  pan(dx: number, dy: number): void {
    this.originPx.x += dx
    this.originPx.y += dy
  }

  /**
   * "맞춤(fit)" — 아트보드 전체가 지정한 여백(FIT_MARGIN_PX)을 남기고 뷰포트 안에
   * 들어오는 배율/원점을 계산합니다. 맵을 처음 열었을 때, 그리고 줌 클러스터의
   * "맞춤" 버튼을 눌렀을 때 씁니다.
   *
   * 계산 순서:
   * 1) 여백을 뺀 "실제 쓸 수 있는 공간"(availW, availH)을 구합니다(양쪽 여백이라 2배로 뺌).
   * 2) 가로/세로 중 "더 빡빡한 쪽"에 맞춰야 종이가 잘리지 않으므로 작은 배율을 고릅니다.
   * 3) 그 배율로 그린 종이 크기(mapWmm × pxPerMm)를 뷰포트 한가운데에 놓기 위해
   *    남는 공간(뷰포트 크기 − 종이 크기)의 절반을 원점으로 삼습니다.
   *
   * @param viewW, viewH 캔버스 뷰포트(본체)의 CSS 픽셀 크기
   * @param mapWmm, mapHmm 맵 전체 크기(mm) = cols×pitch, rows×pitch
   */
  fit(viewW: number, viewH: number, mapWmm: number, mapHmm: number): void {
    const availW = viewW - FIT_MARGIN_PX * 2
    const availH = viewH - FIT_MARGIN_PX * 2
    this.pxPerMm = clamp(Math.min(availW / mapWmm, availH / mapHmm), MIN_PX_PER_MM, MAX_PX_PER_MM)
    this.originPx.x = (viewW - mapWmm * this.pxPerMm) / 2
    this.originPx.y = (viewH - mapHmm * this.pxPerMm) / 2
  }
}

/** 주어진 뷰포트 크기에서 "맞춤" 시 나오게 될 배율만 계산합니다(원점은 바꾸지 않음).
 *  미니맵을 "맞춤 배율 이하일 때 자동 숨김" 처리하려면, 실제로 fit()을 호출해 원점을
 *  바꿔버리지 않고 배율값만 미리 알아야 해서 별도 함수로 뺐습니다. */
export function computeFitPxPerMm(viewW: number, viewH: number, mapWmm: number, mapHmm: number): number {
  const availW = viewW - FIT_MARGIN_PX * 2
  const availH = viewH - FIT_MARGIN_PX * 2
  return clamp(Math.min(availW / mapWmm, availH / mapHmm), MIN_PX_PER_MM, MAX_PX_PER_MM)
}
