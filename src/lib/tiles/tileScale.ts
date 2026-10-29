// 타일 크기 고르기(docs/12 §2.2). 크기는 "격자 몇 칸"으로 고릅니다 — 1칸 = pitch(기본 50mm).
// 1칸이 아니면 칸 타일(cells)이 아니라 자유 배치 그림(props)으로 놓입니다. 칸 타일은 늘 한 칸이라서입니다.

/** 팔레트·인스펙터에 보이는 크기 단추. value는 칸 수 */
export const TILE_SCALE_OPTIONS = [
  { value: '0.5', label: '½' },
  { value: '1', label: '1' },
  { value: '1.5', label: '1½' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
]

/**
 * "칸" 놓기에서 크기가 1칸이 아닐 때 그림 중심을 어디에 둘지(mm).
 * - 2·3칸: 왼쪽 위 모서리를 칸 경계에 붙여 정확히 2×2·3×3칸을 덮게 합니다.
 * - ½·1½칸: 칸 경계에 맞출 수 없으므로 중심을 반 칸(25mm) 격자점(칸 가운데·모서리)에 붙입니다.
 */
export function snapScaledCenter(m: number, sizeMm: number, pitch: number, scale: number): number {
  if (!Number.isInteger(scale)) return Math.round(m / (pitch / 2)) * (pitch / 2)
  return Math.round((m - sizeMm / 2) / pitch) * pitch + sizeMm / 2
}

/** 그림(w×h)이 정확히 몇 칸 크기인지. 정사각형이고 단추 값과 맞을 때만 그 값, 아니면 '' */
export function scaleValueOf(w: number, h: number, pitch: number): string {
  if (Math.abs(w - h) > 0.5) return ''
  const match = TILE_SCALE_OPTIONS.find((o) => Math.abs(Number(o.value) * pitch - w) < 0.5)
  return match ? match.value : ''
}
