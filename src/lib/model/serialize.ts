// MapDoc ↔ JSON 문자열 변환과, 파일을 불러올 때의 검증.
// 저장할 때는 serializeMap, 파일을 열 때는 parseMap을 씁니다.
//
// parseMap은 절대 예외(throw)를 던지지 않고 항상 { ok: true/false, ... } 객체를 돌려줍니다.
// 그래야 호출부(FsaStore/DownloadStore, 나중엔 드래그 앤 드롭 핸들러)가 try/catch 없이
// 결과를 그대로 토스트 메시지로 보여줄 수 있습니다.
import type { MapDoc, NodeCoord } from './types'
import { SCHEMA_VERSION } from './constants'

/** JSON으로 직렬화. 사람이 텍스트 에디터로 열어봐도 읽을 수 있게 2칸 들여쓰기(§4.2). */
export function serializeMap(doc: MapDoc): string {
  return JSON.stringify(doc, null, 2)
}

/** parseMap의 결과. ok가 true일 때만 doc이 있습니다. */
export type ParseMapResult =
  | { ok: true; doc: MapDoc; readOnly: boolean }
  | { ok: false; error: string }

/** "hamsterS-map/N" 형식에서 버전 숫자 N만 뽑습니다. 형식이 다르면 null. */
function parseSchemaVersion(schema: unknown): number | null {
  if (typeof schema !== 'string') return null
  const match = /^hamsterS-map\/(\d+)$/.exec(schema)
  return match ? Number(match[1]) : null
}

const DIRECTIONS = new Set<string>(['N', 'E', 'S', 'W'])

/** v가 [col, row] 형태이고 0 ≤ col ≤ maxCol, 0 ≤ row ≤ maxRow 범위 안에 있는지 확인. */
function isNodeCoordInRange(v: unknown, maxCol: number, maxRow: number): v is NodeCoord {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    v[0] >= 0 &&
    v[0] <= maxCol &&
    v[1] >= 0 &&
    v[1] <= maxRow
  )
}

/**
 * 텍스트를 MapDoc으로 파싱하고 검증합니다. 실패해도 예외를 던지지 않고
 * { ok: false, error } 를 돌려줍니다.
 *
 * 검증 범위: 렌더러가 실제로 크래시 날 만한 치명적 항목(스키마 버전, cells 길이,
 * 좌표·인덱스 범위, 필수 배열/객체 필드 존재)만 확인하는 실용적인 수준입니다.
 * 필드 하나하나의 완전한 스키마 검증은 하지 않습니다.
 */
export function parseMap(text: string): ParseMapResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '올바른 JSON 파일이 아닙니다.' }
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '맵 파일 형식이 아닙니다(최상위 값이 객체가 아님).' }
  }
  const obj = raw as Record<string, unknown>

  // 1) schema 필드 존재 및 형식 ------------------------------------------------
  const fileVersion = parseSchemaVersion(obj.schema)
  if (fileVersion === null) {
    return {
      ok: false,
      error: `schema 필드가 없거나 형식이 올바르지 않습니다. (예: "${SCHEMA_VERSION}")`,
    }
  }
  const currentVersion = parseSchemaVersion(SCHEMA_VERSION) ?? 1

  // 2) 상위 버전이면 읽기 전용 경고(FR-1.10).
  //    하위 버전은 원래 "마이그레이션 후 열기"가 목표(§4.2)지만, hamsterS-map/1이 첫
  //    스키마라 지금은 마이그레이션 대상이 없습니다 — 나중에 스키마를 올릴 때 여기에
  //    버전별 변환 로직을 추가하세요.
  const readOnly = fileVersion > currentVersion

  // 3) board / cells 길이 검증(D3) ----------------------------------------------
  const board = obj.board as Record<string, unknown> | undefined
  if (!board || typeof board.cols !== 'number' || typeof board.rows !== 'number') {
    return { ok: false, error: 'board.cols / board.rows 필드가 없습니다.' }
  }
  const cols = board.cols
  const rows = board.rows
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    return { ok: false, error: 'board.cols / board.rows는 1 이상의 정수여야 합니다.' }
  }

  const cells = obj.cells
  if (!Array.isArray(cells) || cells.length !== cols * rows) {
    const actualLength = Array.isArray(cells) ? cells.length : '없음'
    return {
      ok: false,
      error: `cells 배열 길이(${actualLength})가 cols×rows(${cols * rows})와 일치하지 않습니다.`,
    }
  }

  // 4) 좌표·인덱스 범위 검증 ------------------------------------------------------
  const maxCol = cols - 1
  const maxRow = rows - 1

  const edges = (obj.edges ?? {}) as Record<string, unknown>
  const hEdges = Array.isArray(edges.h) ? edges.h : []
  const vEdges = Array.isArray(edges.v) ? edges.v : []
  for (const e of hEdges) {
    // h는 (c,r)~(c+1,r) 가로 연결이라 c는 cols-2까지만 유효(factory.ts와 같은 규칙)
    if (!isNodeCoordInRange(e, cols - 2, maxRow)) {
      return { ok: false, error: `edges.h에 격자 범위를 벗어난 좌표가 있습니다: ${JSON.stringify(e)}` }
    }
  }
  for (const e of vEdges) {
    if (!isNodeCoordInRange(e, maxCol, rows - 2)) {
      return { ok: false, error: `edges.v에 격자 범위를 벗어난 좌표가 있습니다: ${JSON.stringify(e)}` }
    }
  }

  const stubs = Array.isArray(obj.stubs) ? obj.stubs : []
  for (const s of stubs) {
    const stub = (s ?? {}) as Record<string, unknown>
    if (!isNodeCoordInRange(stub.node, maxCol, maxRow) || !DIRECTIONS.has(stub.dir as string)) {
      return { ok: false, error: `stubs에 잘못된 항목이 있습니다: ${JSON.stringify(s)}` }
    }
  }

  const markers = (obj.markers ?? {}) as Record<string, unknown>
  const start = markers.start as Record<string, unknown> | null | undefined
  if (start != null) {
    if (!isNodeCoordInRange(start.cell, maxCol, maxRow) || !DIRECTIONS.has(start.heading as string)) {
      return { ok: false, error: `markers.start 좌표가 격자 범위를 벗어났습니다: ${JSON.stringify(start)}` }
    }
  }
  const goals = Array.isArray(markers.goals) ? markers.goals : []
  for (const g of goals) {
    const goal = (g ?? {}) as Record<string, unknown>
    if (!isNodeCoordInRange(goal.cell, maxCol, maxRow)) {
      return { ok: false, error: `markers.goals 좌표가 격자 범위를 벗어났습니다: ${JSON.stringify(g)}` }
    }
  }

  // 5) 나머지 필수 필드가 최소한 "있기는 한지" 확인 -------------------------------
  //    (없으면 편집기가 doc.strokes.map(...) 같은 코드에서 그대로 죽어버리므로,
  //     여기서 미리 걸러 에러 메시지로 바꿔줍니다)
  if (typeof obj.meta !== 'object' || obj.meta === null) {
    return { ok: false, error: 'meta 필드가 없습니다.' }
  }
  if (!Array.isArray(obj.strokes)) {
    return { ok: false, error: 'strokes 필드가 배열이 아닙니다.' }
  }
  if (!Array.isArray(obj.props)) {
    return { ok: false, error: 'props 필드가 배열이 아닙니다.' }
  }
  if (!Array.isArray(obj.labels)) {
    return { ok: false, error: 'labels 필드가 배열이 아닙니다.' }
  }
  if (typeof obj.userAssets !== 'object' || obj.userAssets === null) {
    return { ok: false, error: 'userAssets 필드가 없습니다.' }
  }
  if (typeof obj.print !== 'object' || obj.print === null) {
    return { ok: false, error: 'print 필드가 없습니다.' }
  }

  return { ok: true, doc: obj as unknown as MapDoc, readOnly }
}
