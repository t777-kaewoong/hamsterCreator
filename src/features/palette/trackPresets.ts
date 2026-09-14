import type { Point, Stroke } from '@/lib/model/types'
import { OFFICIAL_ELLIPSE_HEIGHT_MM, OFFICIAL_ELLIPSE_WIDTH_MM } from '@/lib/model/constants'

export interface TrackPreset {
  id: string
  name: string
  create: (cx: number, cy: number, strokeId: string) => Stroke
}

const width = 8

function linePreset(id: string, name: string, points: Point[]): TrackPreset {
  return {
    id,
    name,
    create: (cx, cy, strokeId) => ({
      id: strokeId,
      kind: 'line',
      width,
      points: points.map(([x, y]) => [x + cx, y + cy]),
    }),
  }
}

function splinePreset(id: string, name: string, points: Point[]): TrackPreset {
  return {
    id,
    name,
    create: (cx, cy, strokeId) => ({
      id: strokeId,
      kind: 'spline',
      width,
      closed: false,
      points: points.map(([x, y]) => [x + cx, y + cy]),
    }),
  }
}

/** FR-10.7의 규격 5종과 곡선·미로·직각 변형을 합친 팔레트 10종. */
export const TRACK_PRESETS: TrackPreset[] = [
  linePreset('straight-270', '직선 270mm', [[-135, 0], [135, 0]]),
  {
    id: 'circle-100',
    name: '원 Ø100mm',
    create: (cx, cy, id) => ({ id, kind: 'circle', cx, cy, r: 50, width }),
  },
  {
    id: 'circle-130',
    name: '원 Ø130mm',
    create: (cx, cy, id) => ({ id, kind: 'circle', cx, cy, r: 65, width }),
  },
  {
    id: 'circle-150',
    name: '원 Ø150mm',
    create: (cx, cy, id) => ({ id, kind: 'circle', cx, cy, r: 75, width }),
  },
  {
    id: 'ellipse-230-150',
    name: '타원 230×150mm',
    create: (cx, cy, id) => ({
      id,
      kind: 'ellipse',
      cx,
      cy,
      rx: OFFICIAL_ELLIPSE_WIDTH_MM / 2,
      ry: OFFICIAL_ELLIPSE_HEIGHT_MM / 2,
      width,
    }),
  },
  // 5개 정점으로 양끝을 평평하게 만든 이전 좌표는 전환 구간이 급해 최소 곡률 반경이
  // 약 26mm까지 작아졌습니다. 사인 곡선에 가까운 7개 정점으로 나눠 S 형태와 기존
  // 가로 폭을 유지하면서 FR-10.8 검증값에 충분한 여유(약 67mm)를 둡니다.
  splinePreset('curve-s', 'S 곡선', [[-90, -40], [-60, -34], [-30, -20], [0, 0], [30, 20], [60, 34], [90, 40]]),
  // 기존 U는 최소 곡률 반경이 약 43mm였습니다. 형태 비율을 유지한 채 1.2배 확대하면
  // 약 51.65mm가 되어 기준에 여유가 생기며, 선을 포함해도 200×146mm라 기본 말판 안에 듭니다.
  splinePreset('curve-u', 'U 곡선', [[-96, -66], [-96, 24], [-54, 72], [54, 72], [96, 24], [96, -66]]),
  linePreset('maze', '미로형 트랙', [[-90, -60], [60, -60], [60, -20], [-45, -20], [-45, 20], [90, 20], [90, 60], [-90, 60]]),
  linePreset('corner-left-60', '60mm 왼쪽 직각', [[30, 30], [-30, 30], [-30, -30]]),
  linePreset('corner-right-60', '60mm 오른쪽 직각', [[-30, 30], [30, 30], [30, -30]]),
]
