// 장애물 자리 표시와 출발·도착 위치 계산 (docs/06 §2.6).
//
// 화면(drawBoard.ts)·PDF(generateMapPdf.ts)·선택·지우개가 같은 값을 봐야 하므로 한곳에 모았습니다.
import type { GoalMarker, MapDoc, Obstacle, ObstacleKind, Point, StartMarker } from './types'

export interface ObstaclePreset {
  kind: ObstacleKind
  name: string
  /** 기본 지름(mm) */
  d: number
}

/**
 * 장애물 3종의 기본 지름.
 * - 종이컵: 6.5온스 자판기컵 입구 70mm·바닥 52mm. 수업에서는 엎어 두는 경우가 많아 큰 쪽(입구).
 * - 소주컵: 입구 약 48mm → 50mm로 잡음(엎으면 입구가 바닥).
 * - 병뚜껑: PET·소주병 뚜껑 약 30mm.
 * 실제 컵이 다르면 인스펙터에서 지름만 바꾸면 됩니다.
 */
export const OBSTACLE_PRESETS: ObstaclePreset[] = [
  { kind: 'paperCup', name: '종이컵', d: 70 },
  { kind: 'sojuCup', name: '소주컵', d: 50 },
  { kind: 'bottleCap', name: '병뚜껑', d: 30 },
]

export function obstaclePreset(kind: ObstacleKind): ObstaclePreset {
  return OBSTACLE_PRESETS.find((preset) => preset.kind === kind) ?? OBSTACLE_PRESETS[0]
}

/** 예전 파일에는 obstacles가 없으므로 항상 이 함수로 읽습니다. */
export function obstaclesOf(doc: MapDoc): Obstacle[] {
  return doc.obstacles ?? []
}

/** 출발·도착이 실제로 그려지는 위치(mm). 자유 위치(at)가 있으면 그 값, 없으면 격자점. */
export function markerPositionMm(marker: Pick<StartMarker | GoalMarker, 'cell' | 'at'>, pitch: number): Point {
  if (marker.at) return [marker.at[0], marker.at[1]]
  return [marker.cell[0] * pitch + pitch / 2, marker.cell[1] * pitch + pitch / 2]
}
