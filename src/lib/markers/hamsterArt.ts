// 출발·도착 "햄스터" 모양(docs/06 §3.2) — 위에서 내려다본 햄스터S 사진.
//
// [2026-10-26 사진으로 교체] 처음에는 바퀴·눈을 단순화한 그림(SVG 경로)이었는데, 선생님이
// 실제 햄스터S 윗면 사진으로 바꿔 달라고 하셨습니다. 사진은 배터리·블루투스 표시가 위쪽에,
// "Hamster-S" 글자가 아래쪽에 있는 방향 그대로를 "위(N)를 본다"로 씁니다.
// 바깥 모서리의 흰 배경은 투명하게 잘라 두었습니다(검은 격자선 위에서 네모 흰 판이 보이지 않게).
//
// 화면(drawBoard.ts)·PDF(generateMapPdf.ts)·팔레트 썸네일(PalettePanel.tsx)이 같은 값을 써야
// 화면에서 본 대로 인쇄되므로 크기·윤곽을 여기 모았습니다. 단위는 mm, 원점은 마커 중심입니다.
import hamsterTopUrl from '@/assets/markers/hamster-top.png'
import { ROBOT_WIDTH_MM } from '@/lib/model/constants'

/** 사진 파일 주소. tileBitmaps.ts가 미리 디코드합니다. */
export const HAMSTER_IMAGE_URL = hamsterTopUrl
/** 비트맵 캐시에서 쓰는 id. 타일 id와 겹치지 않게 접두어를 붙였습니다. */
export const HAMSTER_IMAGE_ID = 'marker/hamster-top'

/** 사진 원본 픽셀 크기와, 그 안에서 로봇 몸통이 차지하는 범위(픽셀). */
const IMAGE_W_PX = 183
const IMAGE_H_PX = 189
const BODY_PX = { x0: 8, y0: 2, x1: 176, y1: 189, r: 9 }

/** 몸통 가로가 실제 로봇 폭(40mm)이 되도록 맞춘 배율(mm/px). 실물 크기 그대로 찍힙니다. */
const MM_PER_PX = ROBOT_WIDTH_MM / (BODY_PX.x1 - BODY_PX.x0)

/** 그릴 사진 크기(mm). 사진 한가운데를 마커 중심에 맞춥니다. */
export const HAMSTER_IMAGE_W_MM = IMAGE_W_PX * MM_PER_PX
export const HAMSTER_IMAGE_H_MM = IMAGE_H_PX * MM_PER_PX

/** 몸통 윤곽(mm, 마커 중심 기준). 사진의 회색 테두리가 흐려 흰 종이 위에서 몸통이 묻히므로
 *  이 윤곽을 검은 선으로 한 번 더 그립니다. */
export const HAMSTER_BODY_MM = {
  x: (BODY_PX.x0 - IMAGE_W_PX / 2) * MM_PER_PX,
  y: (BODY_PX.y0 - IMAGE_H_PX / 2) * MM_PER_PX,
  w: (BODY_PX.x1 - BODY_PX.x0) * MM_PER_PX,
  h: (BODY_PX.y1 - BODY_PX.y0) * MM_PER_PX,
  r: BODY_PX.r * MM_PER_PX,
}
/** 몸통 윤곽선 굵기(mm). 격자선(8mm)보다 훨씬 가늘어 사진을 가리지 않습니다. */
export const HAMSTER_OUTLINE_MM = 1

/** 둥근 사각 경로(SVG). PDF의 drawSvgPath와 캔버스 Path2D가 함께 씁니다. */
function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

/** 몸통 윤곽 경로(mm, 마커 중심 기준). */
export const HAMSTER_BODY_PATH = roundedRectPath(HAMSTER_BODY_MM.x, HAMSTER_BODY_MM.y, HAMSTER_BODY_MM.w, HAMSTER_BODY_MM.h, HAMSTER_BODY_MM.r)

/** 이름표를 몸통 아래에 놓기 위한 바깥 반경(mm). 사진 세로 절반 + 윤곽선 절반. */
export const HAMSTER_CAPTION_RADIUS_MM = HAMSTER_IMAGE_H_MM / 2 + HAMSTER_OUTLINE_MM / 2

/** 방향 → 시계방향 회전각(도). 사진은 위(N)를 보고 있으므로 N = 0°. */
export const HEADING_DEGREES = { N: 0, E: 90, S: 180, W: 270 } as const
