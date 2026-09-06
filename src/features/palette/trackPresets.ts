import type { Point, Stroke } from '@/lib/model/types'

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
    create: (cx, cy, id) => ({ id, kind: 'ellipse', cx, cy, rx: 115, ry: 75, width }),
  },
  splinePreset('curve-s', 'S 곡선', [[-90, -45], [-45, -45], [0, 0], [45, 45], [90, 45]]),
  splinePreset('curve-u', 'U 곡선', [[-80, -55], [-80, 20], [-45, 60], [45, 60], [80, 20], [80, -55]]),
  linePreset('maze', '미로형 트랙', [[-90, -60], [60, -60], [60, -20], [-45, -20], [-45, 20], [90, 20], [90, 60], [-90, 60]]),
  linePreset('corner-left-60', '60mm 왼쪽 직각', [[30, 30], [-30, 30], [-30, -30]]),
  linePreset('corner-right-60', '60mm 오른쪽 직각', [[-30, 30], [30, 30], [30, -30]]),
]
