import type { Cell, Edges, MapDoc, NodeCoord, Prop, Label, Stroke } from './types'
import { allBoundaryStubs, isBoundaryStub, isFullBoundarySet } from './stubs'
import { withAutoLayout } from '@/lib/print/sheet'

/** 격자 크기를 바꾸면서 row-major 셀과 범위를 벗어난 연결 데이터를 함께 정리합니다.
 *  오른쪽·아래쪽으로만 늘고 줄어듭니다(원점 고정). 인스펙터·출력 계획기의 숫자 입력용. */
export function resizeMapDoc(doc: MapDoc, nextCols: number, nextRows: number): MapDoc {
  return reframeMapDoc(doc, 0, 0, nextCols, nextRows)
}

/** 종이를 붙이거나 뗄 변. */
export type MapSide = 'left' | 'right' | 'top' | 'bottom'

/**
 * 한 변에서 칸을 늘리거나(amount > 0) 줄입니다(amount < 0).
 * 캔버스의 "종이 붙이기·떼기" 버튼이 씁니다. 왼쪽·위쪽은 기존 내용을 그만큼 옮깁니다.
 * 결과가 1칸 미만이 되면 원래 문서를 그대로 돌려줍니다.
 */
export function extendMapDoc(doc: MapDoc, side: MapSide, amount: number): MapDoc {
  const { cols, rows } = doc.board
  const horizontal = side === 'left' || side === 'right'
  const nextCols = horizontal ? cols + amount : cols
  const nextRows = horizontal ? rows : rows + amount
  if (nextCols < 1 || nextRows < 1 || amount === 0) return doc
  const shiftCols = side === 'left' ? amount : 0
  const shiftRows = side === 'top' ? amount : 0
  return reframeMapDoc(doc, shiftCols, shiftRows, nextCols, nextRows)
}

/** 모든 인접 노드가 이어진 "전체 격자"인지. 중복 없이 저장된다는 전제(toggleEdge 규칙)입니다. */
function isFullGrid(edges: Edges, cols: number, rows: number): boolean {
  return edges.h.length === (cols - 1) * rows && edges.v.length === cols * (rows - 1)
}

function fullGridEdges(cols: number, rows: number): Edges {
  const h: NodeCoord[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) h.push([c, r])
  const v: NodeCoord[] = []
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) v.push([c, r])
  return { h, v }
}

/** 곡선의 대략적인 범위(mm). 새 종이와 겹치는지만 보면 되므로 조절점은 무시합니다. */
function strokeBox(stroke: Stroke): { x0: number; y0: number; x1: number; y1: number } {
  if (stroke.kind === 'circle') return { x0: stroke.cx - stroke.r, y0: stroke.cy - stroke.r, x1: stroke.cx + stroke.r, y1: stroke.cy + stroke.r }
  if (stroke.kind === 'ellipse') return { x0: stroke.cx - stroke.rx, y0: stroke.cy - stroke.ry, x1: stroke.cx + stroke.rx, y1: stroke.cy + stroke.ry }
  if (stroke.kind === 'roundedRect') return { x0: stroke.cx - stroke.w / 2, y0: stroke.cy - stroke.h / 2, x1: stroke.cx + stroke.w / 2, y1: stroke.cy + stroke.h / 2 }
  const xs = stroke.points.map(([x]) => x)
  const ys = stroke.points.map(([, y]) => y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

function shiftStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  if (stroke.kind === 'spline' || stroke.kind === 'line') {
    // 스플라인 handles는 정점 기준 상대 벡터라 옮길 필요가 없습니다.
    return { ...stroke, points: stroke.points.map(([x, y]) => [x + dx, y + dy]) }
  }
  return { ...stroke, cx: stroke.cx + dx, cy: stroke.cy + dy }
}

/**
 * 격자를 새 틀에 다시 앉힙니다. 옛 칸 (c, r)은 새 칸 (c + shiftCols, r + shiftRows)가 됩니다.
 *
 * [왜 단순히 배열 길이만 맞추면 안 되는가 — 이 작업에서 가장 틀리기 쉬운 부분]
 * cells 배열은 row-major(인덱스 = r×cols + c)라서 cols가 바뀌면 같은 좌표라도 인덱스
 * 공식이 달라집니다. slice나 null 이어붙이기로 끝내면 타일이 엉뚱한 칸으로 밀립니다.
 * 그래서 새 배열을 (c, r) 좌표 기준으로 처음부터 다시 채웁니다.
 *
 * [전체 격자는 새 영역도 격자로 채움 — 2026-09-28 후기 반영]
 * 공식 말판처럼 선이 전부 이어진 맵에 종이를 붙였는데 새 종이만 텅 비어 있으면 선을 손으로
 * 다시 그어야 합니다. 옛 맵이 전체 격자였을 때만 새 크기로 다시 채우고, 사용자가 일부 선을
 * 지운 맵은 그 모양을 존중해 새 영역을 비워 둡니다.
 */
export function reframeMapDoc(doc: MapDoc, shiftCols: number, shiftRows: number, nextCols: number, nextRows: number): MapDoc {
  const { cols: oldCols, rows: oldRows, pitch } = doc.board
  const inRange = (c: number, r: number) => c >= 0 && c < nextCols && r >= 0 && r < nextRows

  const nextCells: (Cell | null)[] = new Array(nextCols * nextRows).fill(null)
  for (let r = 0; r < oldRows; r++) {
    for (let c = 0; c < oldCols; c++) {
      const nc = c + shiftCols
      const nr = r + shiftRows
      if (inRange(nc, nr)) nextCells[nr * nextCols + nc] = doc.cells[r * oldCols + c]
    }
  }

  const nextEdges: Edges = isFullGrid(doc.edges, oldCols, oldRows)
    ? fullGridEdges(nextCols, nextRows)
    : {
        h: doc.edges.h
          .map(([c, r]): NodeCoord => [c + shiftCols, r + shiftRows])
          .filter(([c, r]) => inRange(c, r) && inRange(c + 1, r)),
        v: doc.edges.v
          .map(([c, r]): NodeCoord => [c + shiftCols, r + shiftRows])
          .filter(([c, r]) => inRange(c, r) && inRange(c, r + 1)),
      }

  const dx = shiftCols * pitch
  const dy = shiftRows * pitch
  const widthMm = nextCols * pitch
  const heightMm = nextRows * pitch
  const overlapsBoard = (x0: number, y0: number, x1: number, y1: number) => x1 > 0 && y1 > 0 && x0 < widthMm && y0 < heightMm

  const nextProps: Prop[] = doc.props
    .map((prop) => ({ ...prop, x: prop.x + dx, y: prop.y + dy }))
    .filter((prop) => overlapsBoard(prop.x, prop.y, prop.x + prop.w, prop.y + prop.h))
  const nextLabels: Label[] = doc.labels
    .map((label) => ({ ...label, x: label.x + dx, y: label.y + dy }))
    .filter((label) => label.x >= 0 && label.y >= 0 && label.x <= widthMm && label.y <= heightMm)
  const nextStrokes: Stroke[] = doc.strokes
    .map((stroke) => (dx === 0 && dy === 0 ? stroke : shiftStroke(stroke, dx, dy)))
    .filter((stroke) => {
      const box = strokeBox(stroke)
      return overlapsBoard(box.x0, box.y0, box.x1, box.y1)
    })

  const shiftNode = (node: NodeCoord): NodeCoord => [node[0] + shiftCols, node[1] + shiftRows]
  const start = doc.markers.start
  const movedStart = start ? { ...start, cell: shiftNode(start.cell) } : null

  return withAutoLayout({
    ...doc,
    board: { ...doc.board, cols: nextCols, rows: nextRows },
    cells: nextCells,
    edges: nextEdges,
    stubs: reframeStubs(doc, shiftCols, shiftRows, nextCols, nextRows),
    strokes: nextStrokes,
    props: nextProps,
    labels: nextLabels,
    markers: {
      start: movedStart && inRange(movedStart.cell[0], movedStart.cell[1]) ? movedStart : null,
      goals: doc.markers.goals
        .map((goal) => ({ ...goal, cell: shiftNode(goal.cell) }))
        .filter((goal) => inRange(goal.cell[0], goal.cell[1])),
    },
  })
}

/**
 * 격자 틀이 바뀔 때 경계 진입로를 정리합니다(2026-09-16 사용자 결정).
 *
 * 1) 사방 경계가 전부 채워져 있던 맵(= "경계 전체에 넣기" 상태, 새 맵의 기본값)이면
 *    새 크기에 맞춰 다시 사방을 채웁니다. 안 그러면 새로 생긴 가장자리에만 진입로가 없습니다.
 * 2) 사용자가 손으로 골라 넣은 맵이면 옮기고 정리만 합니다.
 *    - 격자 밖으로 나간 것은 버립니다.
 *    - **예전에는 가장자리였는데 지금은 아니게 된 것**도 버립니다. 옆 칸을 향하는 반 칸짜리
 *      돌기로 남는데, L 도구 클릭 지우기는 가장자리에서만 동작해 지울 방법이 없기 때문입니다.
 *    - **원래부터 안쪽에 있던** 것은 그대로 둡니다(재난구조 프리셋처럼 일부러 넣은 돌기).
 */
function reframeStubs(doc: MapDoc, shiftCols: number, shiftRows: number, nextCols: number, nextRows: number): MapDoc['stubs'] {
  const { cols: oldCols, rows: oldRows } = doc.board
  if (isFullBoundarySet(doc.stubs, oldCols, oldRows)) return allBoundaryStubs(nextCols, nextRows)

  return doc.stubs.flatMap((stub) => {
    const moved = { ...stub, node: [stub.node[0] + shiftCols, stub.node[1] + shiftRows] as NodeCoord }
    const [column, row] = moved.node
    if (column < 0 || column >= nextCols || row < 0 || row >= nextRows) return []
    const wasBoundary = isBoundaryStub(stub, oldCols, oldRows)
    return !wasBoundary || isBoundaryStub(moved, nextCols, nextRows) ? [moved] : []
  })
}
