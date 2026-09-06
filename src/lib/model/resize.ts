import type { Cell, Edges, MapDoc } from './types'

/** 격자 크기를 바꾸면서 row-major 셀과 범위를 벗어난 연결 데이터를 함께 정리합니다. */
export function resizeMapDoc(doc: MapDoc, nextCols: number, nextRows: number): MapDoc {
  const { cols: oldCols, rows: oldRows } = doc.board
  const nextCells: (Cell | null)[] = new Array(nextCols * nextRows).fill(null)
  for (let row = 0; row < nextRows; row++) {
    for (let column = 0; column < nextCols; column++) {
      if (column < oldCols && row < oldRows) {
        nextCells[row * nextCols + column] = doc.cells[row * oldCols + column]
      }
    }
  }

  const inRange = (column: number, row: number) => column >= 0 && column < nextCols && row >= 0 && row < nextRows
  const nextEdges: Edges = {
    h: doc.edges.h.filter(([column, row]) => inRange(column, row) && inRange(column + 1, row)),
    v: doc.edges.v.filter(([column, row]) => inRange(column, row) && inRange(column, row + 1)),
  }

  return {
    ...doc,
    board: { ...doc.board, cols: nextCols, rows: nextRows },
    cells: nextCells,
    edges: nextEdges,
    stubs: doc.stubs.filter((stub) => inRange(stub.node[0], stub.node[1])),
    markers: {
      start: doc.markers.start && inRange(doc.markers.start.cell[0], doc.markers.start.cell[1]) ? doc.markers.start : null,
      goals: doc.markers.goals.filter((goal) => inRange(goal.cell[0], goal.cell[1])),
    },
  }
}
