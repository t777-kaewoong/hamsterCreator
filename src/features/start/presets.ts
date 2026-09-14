// 시작 화면 프리셋 카드 정의 (PRD §9.8 "프리셋 8종" 표).
//
// 기본 용지 5종과 교과서 활동 2종, 라인트레이서 1종을 실제 편집 가능한 MapDoc으로 만듭니다.
import type { Label, MapDoc, NodeCoord, Prop } from '@/lib/model/types'
import { createEmptyMap, createFullGridMap } from '@/lib/model/factory'
import { PAPER_SIZES, PITCH_MM } from '@/lib/model/constants'
import { TRACK_PRESETS } from '@/features/palette/trackPresets'

/** 프리셋 카드 하나의 정보. StartScreen이 이 배열을 그대로 매핑해 카드를 그립니다. */
export interface StartPreset {
  /** React key이자, 썸네일 캐시(thumbnail.ts 호출부)의 키로도 씁니다 */
  id: string
  /** 카드 이름(label 크기 글자) */
  name: string
  /** 카드 하단 규격 칩 문구. 예: "A4 · 5×4칸 · 250×200mm" (PRD §9.8 예시 형식 그대로) */
  specLabel: string
  /** PRD §9.8: "A4 기본"에만 붙는 ★기본 표시 */
  isDefault?: boolean
  /** 클릭 시 실제로 만들 맵 문서. 클릭하는 그 순간 호출해서 매번 새 문서를 받습니다
   *  (같은 객체를 여러 카드가 공유하면 한쪽 편집이 다른 쪽에 번지므로) */
  create(): MapDoc
}

/** 용지 id로 §6.1 표시용 라벨을 찾습니다. 못 찾으면(등록 안 된 용지) id 자체를 그대로 씁니다. */
function paperLabel(sheetId: string): string {
  return PAPER_SIZES.find((p) => p.id === sheetId)?.label ?? sheetId
}

/** PRD §9.8 규격 칩 형식: "A4 · 5×4칸 · 250×200mm". mm 크기는 칸 피치(50mm) × 칸 수. */
function buildSpecLabel(sheetId: string, cols: number, rows: number): string {
  const widthMm = cols * PITCH_MM
  const heightMm = rows * PITCH_MM
  return `${paperLabel(sheetId)} · ${cols}×${rows}칸 · ${widthMm}×${heightMm}mm`
}

function nodeCenter(col: number, row: number): [number, number] {
  return [(col + 0.5) * PITCH_MM, (row + 0.5) * PITCH_MM]
}

function propAtNode(asset: string, col: number, row: number, size = 20): Prop {
  const [cx, cy] = nodeCenter(col, row)
  return { asset, x: cx - size / 2, y: cy - size / 2, w: size, h: size, rot: 0, flip: false }
}

function lineLabel(text: string, col: number, row: number, size = 8): Label {
  const [x, y] = nodeCenter(col, row)
  return { text, x, y, rot: 0, size, color: '#ffffff', onLine: true }
}

/** 교과서 p190: 3×3 교차점과 거실·화장실·현관 위치를 50mm 규격으로 재현합니다. */
function createBarrierFreeMap(): MapDoc {
  const doc = createFullGridMap(3, 3, {
    title: '부록 배리어프리',
    sheet: 'A4',
    orientation: 'landscape',
  })
  return {
    ...doc,
    stubs: [
      ...Array.from({ length: 3 }, (_, row) => ({ node: [0, row] as NodeCoord, dir: 'W' as const })),
      ...Array.from({ length: 3 }, (_, row) => ({ node: [2, row] as NodeCoord, dir: 'E' as const })),
      ...Array.from({ length: 3 }, (_, col) => ({ node: [col, 0] as NodeCoord, dir: 'N' as const })),
      ...Array.from({ length: 3 }, (_, col) => ({ node: [col, 2] as NodeCoord, dir: 'S' as const })),
    ],
    labels: [
      lineLabel('거실', 0, 0),
      lineLabel('화장실', 2, 1),
      { ...lineLabel('↑', 0, 2, 9), y: nodeCenter(0, 2)[1] - 10 },
      { ...lineLabel('현관', 0, 2), y: nodeCenter(0, 2)[1] + 8 },
    ],
  }
}

/** 교과서 p185: 5×5 구조 격자와 아래쪽 원형 임무 구역·시작 경로를 한 문서로 만듭니다. */
function createDisasterRescueMap(): MapDoc {
  const doc = createEmptyMap(6, 7, {
    title: '부록 재난구조',
    sheet: 'A2',
    orientation: 'portrait',
  })
  const h: NodeCoord[] = []
  const v: NodeCoord[] = []

  // 위쪽 5×5 교차점 격자(실제 board의 1~5열)와 아래쪽 시작 경로.
  for (let row = 0; row < 5; row++) {
    for (let col = 1; col < 5; col++) h.push([col, row])
  }
  for (let row = 0; row < 4; row++) {
    for (let col = 1; col < 6; col++) v.push([col, row])
  }
  v.push([1, 4], [1, 5])
  for (let col = 1; col < 5; col++) h.push([col, 6])

  return {
    ...doc,
    edges: { h, v },
    stubs: [
      ...Array.from({ length: 5 }, (_, row) => ({ node: [1, row] as NodeCoord, dir: 'W' as const })),
      ...Array.from({ length: 5 }, (_, row) => ({ node: [5, row] as NodeCoord, dir: 'E' as const })),
      ...Array.from({ length: 5 }, (_, col) => ({ node: [col + 1, 0] as NodeCoord, dir: 'N' as const })),
      ...Array.from({ length: 4 }, (_, col) => ({ node: [col + 2, 4] as NodeCoord, dir: 'S' as const })),
      { node: [5, 6], dir: 'E' },
    ],
    strokes: [{ id: 'preset-disaster-valve-zone', kind: 'circle', cx: 75, cy: 275, r: 50, width: 8 }],
    props: [
      propAtNode('fire', 5, 0),
      propAtNode('fire', 3, 1),
      propAtNode('fire', 5, 2),
      propAtNode('fire', 1, 3),
      propAtNode('person', 5, 1),
      propAtNode('valve', 1, 5, 24),
      { asset: 'fire', x: 208, y: 272, w: 28, h: 28, rot: 0, flip: false },
    ],
    labels: [
      { ...lineLabel('■', 3, 3, 23), color: '#ffb800', onLine: false },
      { text: '가스 밸브 잠그기', x: 22, y: 275, rot: -90, size: 7, color: '#111111', onLine: false },
      { text: '사람 찾기', x: 288, y: 75, rot: -90, size: 7, color: '#111111', onLine: false },
      { text: '문 열기', x: 200, y: 312, rot: 0, size: 7, color: '#111111', onLine: false },
      { text: '시작 위치', x: 288, y: 325, rot: -90, size: 7, color: '#111111', onLine: false },
    ],
  }
}

/** PRD §9.8: 격자 없이 안전 곡률을 만족하는 S 트랙만 배치합니다. */
function createLineTracerMap(): MapDoc {
  const doc = createEmptyMap(5, 4, {
    title: '라인트레이서',
    sheet: 'A4',
    orientation: 'landscape',
  })
  const curve = TRACK_PRESETS.find((preset) => preset.id === 'curve-s')
  if (!curve) throw new Error('S 곡선 트랙 프리셋을 찾을 수 없습니다.')
  return { ...doc, strokes: [curve.create(125, 100, 'preset-line-tracer-s')] }
}

export const START_PRESETS: StartPreset[] = [
  {
    id: 'a4-basic',
    name: 'A4 기본',
    specLabel: buildSpecLabel('A4', 5, 4),
    isDefault: true,
    create: () => createFullGridMap(5, 4, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
  {
    id: 'a4-two',
    name: 'A4 2장',
    specLabel: buildSpecLabel('A4', 10, 4),
    create: () => createFullGridMap(10, 4, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
  {
    id: 'a4-four',
    name: 'A4 4장',
    specLabel: buildSpecLabel('A4', 10, 8),
    create: () => createFullGridMap(10, 8, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
  {
    id: 'a2-one',
    name: 'A2 1장',
    specLabel: buildSpecLabel('A2', 11, 8),
    create: () => createFullGridMap(11, 8, { title: '새 말판', sheet: 'A2', orientation: 'landscape' }),
  },
  {
    id: 'empty',
    name: '빈 격자',
    specLabel: buildSpecLabel('A4', 5, 4),
    // 엣지(edges.h/v)를 전혀 안 채운 순수 빈 맵. createFullGridMap과 달리 격자선이 하나도
    // 없어 편집기를 열자마자 흰 종이만 보입니다(PRD §9.8 "빈 격자 = 5×4, 엣지 없음").
    create: () => createEmptyMap(5, 4, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
  {
    id: 'appendix-barrier-free',
    name: '부록 배리어프리',
    specLabel: buildSpecLabel('A4', 3, 3),
    create: createBarrierFreeMap,
  },
  {
    id: 'appendix-disaster-rescue',
    name: '부록 재난구조',
    specLabel: 'A2 · 혼합 트랙 · 300×350mm',
    create: createDisasterRescueMap,
  },
  {
    id: 'line-tracer',
    name: '라인트레이서',
    specLabel: 'A4 · 곡선 트랙 · 250×200mm',
    create: createLineTracerMap,
  },
]
