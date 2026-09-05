// 새 MapDoc을 만드는 함수들.
// "새 맵 만들기" 버튼, 시작 화면 프리셋 카드(§9.8), "전체 격자 채우기"(FR-2.3) 같은 곳에서
// 이 함수들로 빈 문서를 만들고 편집을 시작합니다. PRD §5의 JSON 구조를 그대로 채웁니다.
import type { BoardConfig, Edges, MapDoc, Markers, NodeCoord, PrintConfig } from './types'
import { DEFAULT_COLS, DEFAULT_ROWS, LINE_WIDTH_MM, PITCH_MM, SCHEMA_VERSION } from './constants'

/** createEmptyMap / createFullGridMap에 줄 수 있는 선택 옵션. 생략한 값은 기본값을 씁니다. */
export interface CreateMapOptions {
  /** 말판 제목. 기본 빈 문자열 */
  title?: string
  /** 출력 용지 id(constants.ts의 PAPER_SIZES 참고). 기본 'A4' */
  sheet?: string
  /** 용지 방향. 기본 'landscape'(가로) — PRD 확정 전제가 "A4 가로"라서 */
  orientation?: 'portrait' | 'landscape'
}

function nowIso(): string {
  return new Date().toISOString()
}

function defaultPrintConfig(sheet: string, orientation: 'portrait' | 'landscape'): PrintConfig {
  return {
    sheet,
    orientation,
    layout: 'single',
    seam: 'butt',
    overlap: 0,
    cropMarks: true,
    scaleRuler: true,
  }
}

/**
 * 빈 맵을 만듭니다. cols·rows를 생략하면 기본값(A4 가로 5×4, PRD 확정 전제)을 씁니다.
 * 격자 칸은 전부 비어 있고(null), 엣지도 전혀 켜져 있지 않은 "빈 격자" 상태입니다.
 * (§9.8 프리셋 중 "빈 격자"가 바로 이 함수 결과)
 */
export function createEmptyMap(
  cols: number = DEFAULT_COLS,
  rows: number = DEFAULT_ROWS,
  opts: CreateMapOptions = {},
): MapDoc {
  const board: BoardConfig = { cols, rows, pitch: PITCH_MM, lineWidth: LINE_WIDTH_MM }
  const edges: Edges = { h: [], v: [] }
  const markers: Markers = { start: null, goals: [] }
  const timestamp = nowIso()

  return {
    schema: SCHEMA_VERSION,
    meta: {
      title: opts.title ?? '',
      unit: '',
      note: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    board,
    // D3: 길이는 반드시 cols×rows, row-major 순서. 빈 칸은 null.
    cells: new Array(cols * rows).fill(null),
    edges,
    stubs: [],
    strokes: [],
    props: [],
    labels: [],
    markers,
    userAssets: {},
    print: defaultPrintConfig(opts.sheet ?? 'A4', opts.orientation ?? 'landscape'),
  }
}

/**
 * 격자 엣지가 전부 켜진 맵을 만듭니다("전체 격자 채우기" 기본 프리셋용, FR-2.3, §9.8의 "A4 기본").
 * 인접한 모든 노드 사이를 가로·세로로 전부 연결합니다.
 */
export function createFullGridMap(
  cols: number = DEFAULT_COLS,
  rows: number = DEFAULT_ROWS,
  opts: CreateMapOptions = {},
): MapDoc {
  const doc = createEmptyMap(cols, rows, opts)

  // h: 노드 (c,r)~(c+1,r) 가로 연결. c는 0 ~ cols-2까지만 존재
  const h: NodeCoord[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) h.push([c, r])
  }
  // v: 노드 (c,r)~(c,r+1) 세로 연결. r은 0 ~ rows-2까지만 존재
  const v: NodeCoord[] = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) v.push([c, r])
  }

  return { ...doc, edges: { h, v } }
}
