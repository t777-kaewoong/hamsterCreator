import type { Cell, Edges, MapDoc } from './types'
import { allBoundaryStubs, isBoundaryStub, isFullBoundarySet } from './stubs'

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
    // 진입로 정리(2026-09-16 사용자 결정).
    //
    // 격자를 키우면 예전 가장자리가 한가운데가 되므로, 거기 있던 진입로는 종이 밖이 아니라
    // 옆 칸을 향하는 반 칸짜리 돌기로 남습니다. 그 돌기는 L 도구 클릭으로 지울 수도 없어서
    // (클릭 지우기는 가장자리에서만 동작) "모두 빼기"로 전부 없애는 수밖에 없습니다.
    // 그래서 크기를 바꿀 때 알아서 정리합니다.
    //
    // 단, "원래부터 안쪽에 있던" 진입로는 건드리지 않습니다. 재난구조 프리셋처럼 일부러
    // 안쪽에 넣어 둔 돌기가 있을 수 있는데, 크기를 바꿨다는 이유로 그것까지 지우면
    // 사용자가 만든 것을 임의로 없애는 셈이 됩니다. 판정 기준은 "예전에는 가장자리였는데
    // 지금은 아니게 된 것"뿐입니다.
    stubs: resizeStubs(doc, nextCols, nextRows),
    markers: {
      start: doc.markers.start && inRange(doc.markers.start.cell[0], doc.markers.start.cell[1]) ? doc.markers.start : null,
      goals: doc.markers.goals.filter((goal) => inRange(goal.cell[0], goal.cell[1])),
    },
  }
}

/**
 * 격자 크기가 바뀔 때 경계 진입로를 정리합니다(2026-09-16 사용자 결정).
 *
 * 경우가 둘입니다.
 *
 * 1) 사방 경계가 전부 채워져 있던 맵(= "경계 전체에 넣기"를 누른 상태, 새 맵의 기본값)이면
 *    새 크기에 맞춰 다시 사방을 채웁니다. 이걸 안 하면 크기를 줄였을 때 새로 생긴 가장자리
 *    두 면에만 진입로가 없어서 반쪽짜리로 보입니다.
 *
 * 2) 사용자가 손으로 골라 넣은 맵이면 임의로 늘리지 않고 정리만 합니다.
 *    - 격자 밖으로 나간 것은 버립니다.
 *    - **예전에는 가장자리였는데 지금은 아니게 된 것**도 버립니다. 격자를 키우면 그런 진입로가
 *      종이 밖이 아니라 옆 칸을 향하는 반 칸짜리 돌기로 남는데, 그 돌기는 L 도구 클릭으로
 *      지울 수도 없습니다(클릭 지우기는 가장자리에서만 동작).
 *    - 반대로 **원래부터 안쪽에 있던** 것은 그대로 둡니다. 재난구조 프리셋처럼 일부러 안쪽에
 *      넣어 둔 돌기까지 크기 변경을 이유로 지우면 사용자가 만든 것을 없애는 셈이라서입니다.
 */
function resizeStubs(doc: MapDoc, nextCols: number, nextRows: number): MapDoc['stubs'] {
  const { cols: oldCols, rows: oldRows } = doc.board
  if (isFullBoundarySet(doc.stubs, oldCols, oldRows)) return allBoundaryStubs(nextCols, nextRows)

  return doc.stubs.filter((stub) => {
    const [column, row] = stub.node
    if (column < 0 || column >= nextCols || row < 0 || row >= nextRows) return false
    const wasBoundary = isBoundaryStub(stub, oldCols, oldRows)
    return !wasBoundary || isBoundaryStub(stub, nextCols, nextRows)
  })
}
