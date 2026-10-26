// 출발·도착 "햄스터" 모양(docs/06 §3.2) — 위에서 내려다본 햄스터 로봇이 위쪽을 바라보는 그림.
//
// 화면(drawBoard.ts)·PDF(generateMapPdf.ts)·팔레트 썸네일(PalettePanel.tsx)이 같은 그림을 그려야
// 화면에서 본 대로 인쇄되므로 SVG 경로 문자열 하나로 정의합니다. 캔버스는 Path2D, PDF는
// pdf-lib의 drawSvgPath, 팔레트는 <path d>로 그대로 씁니다.
//
// 좌표 단위는 mm, 원점은 마커 중심, 위쪽(−y)이 로봇의 앞입니다. 방향(heading)에 맞춰 돌려 그립니다.

/** 둥근 사각 경로(SVG). 호(A)로 모서리를 그립니다. */
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

function circlePath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
}

/** 몸통 30×32mm, 모서리 7mm. 흰 채움 + 검은 테두리. */
export const HAMSTER_BODY_PATH = roundedRectPath(-15, -16, 30, 32, 7)
/** 몸통 테두리 굵기(mm). 격자선(8mm)보다 얇아야 선 위에서도 몸통 윤곽이 구분됩니다. */
export const HAMSTER_OUTLINE_MM = 2.5
/** 바퀴 2개(양옆 5×16mm)·눈 2개(앞쪽 Ø5mm)·앞을 가리키는 삼각형 — 전부 검은 채움. */
export const HAMSTER_DETAIL_PATH = [
  roundedRectPath(-19.5, -8, 5, 16, 1.5),
  roundedRectPath(14.5, -8, 5, 16, 1.5),
  circlePath(-6.5, -8, 2.5),
  circlePath(6.5, -8, 2.5),
  'M 0 1 L 5 9 L -5 9 Z',
].join(' ')
/** 이름표를 몸통 아래에 놓기 위한 바깥 반경(mm). 몸통 세로 절반(16) + 테두리 절반. */
export const HAMSTER_CAPTION_RADIUS_MM = 17.25

/** 방향 → 시계방향 회전각(도). 그림은 위(N)를 보고 있으므로 N = 0°. */
export const HEADING_DEGREES = { N: 0, E: 90, S: 180, W: 270 } as const
