// 경계 진입로(stub) 데이터 조작 (FR-2.4).
//
// 진입로는 "경계 노드에서 종이 바깥쪽으로 나가는 반 칸(25mm)짜리 선"입니다. 로보메이션
// 공식 playbot 말판은 경계 노드마다 이걸 달아 두어, 로봇이 말판 밖에서 선을 따라 들어오거나
// 라인트레이서 트랙과 이어 붙일 수 있게 되어 있습니다.
//
// [왜 features/canvas가 아니라 여기인가]
// 이 파일의 함수들은 화면 좌표를 전혀 모르는 순수 데이터 조작이고, 맵을 만드는 factory.ts와
// 크기를 바꾸는 resize.ts가 모두 써야 합니다. lib/model 이 features/ 를 가져다 쓰면 의존
// 방향이 거꾸로 되므로, 공용으로 쓰이는 부분만 모델 쪽에 둡니다.
// 클릭 지점(mm)에서 어느 진입로인지 찾는 stubAtPoint 는 화면 조작 전용이라
// features/canvas/gridMath.ts 에 그대로 둡니다.
import type { Stub } from './types'

/** 같은 진입로가 이미 있는지. */
export function stubExists(stubs: Stub[], stub: Stub): boolean {
  return stubs.some((s) => s.node[0] === stub.node[0] && s.node[1] === stub.node[1] && s.dir === stub.dir)
}

/** 진입로를 켜거나 끕니다. 바뀌지 않으면 원래 배열을 그대로 돌려줍니다
 *  (호출부가 === 비교만으로 "변화 없음"을 알 수 있게 — toggleEdge와 같은 규칙). */
export function setStub(stubs: Stub[], stub: Stub, on: boolean): Stub[] {
  if (stubExists(stubs, stub) === on) return stubs
  if (on) return [...stubs, stub]
  return stubs.filter((s) => !(s.node[0] === stub.node[0] && s.node[1] === stub.node[1] && s.dir === stub.dir))
}

/** 있으면 지우고 없으면 넣습니다. */
export function toggleStub(stubs: Stub[], stub: Stub): Stub[] {
  return setStub(stubs, stub, !stubExists(stubs, stub))
}

/**
 * 이 진입로가 주어진 격자 크기에서 "바깥으로 나가는" 위치에 있는지.
 * 예를 들어 dir이 'W'면 맨 왼쪽 열(c === 0)에 있어야 종이 밖으로 나갑니다.
 * 안쪽 노드에 붙어 있으면 종이 밖이 아니라 옆 칸을 향하는 반 칸짜리 돌기가 됩니다.
 */
export function isBoundaryStub(stub: Stub, cols: number, rows: number): boolean {
  const [c, r] = stub.node
  switch (stub.dir) {
    case 'W': return c === 0
    case 'E': return c === cols - 1
    case 'N': return r === 0
    case 'S': return r === rows - 1
  }
}

/**
 * 격자의 모든 경계 노드에 바깥 방향 진입로를 만든 목록.
 * 공식 playbot 말판과 같은 모양입니다. 모서리 노드는 두 방향 다 생깁니다.
 * 예: 5×4 격자 → 위 5 + 아래 5 + 왼쪽 4 + 오른쪽 4 = 18개.
 */
export function allBoundaryStubs(cols: number, rows: number): Stub[] {
  const stubs: Stub[] = []
  for (let c = 0; c < cols; c++) {
    stubs.push({ node: [c, 0], dir: 'N' })
    stubs.push({ node: [c, rows - 1], dir: 'S' })
  }
  for (let r = 0; r < rows; r++) {
    stubs.push({ node: [0, r], dir: 'W' })
    stubs.push({ node: [cols - 1, r], dir: 'E' })
  }
  return stubs
}

/**
 * 이 진입로 목록이 "경계 전체에 넣기"를 누른 것과 똑같은 상태인지.
 * 순서는 보지 않고 구성만 비교합니다(사용자가 하나씩 눌러 채웠을 수도 있으므로).
 */
export function isFullBoundarySet(stubs: Stub[], cols: number, rows: number): boolean {
  const full = allBoundaryStubs(cols, rows)
  if (stubs.length !== full.length) return false
  return full.every((stub) => stubExists(stubs, stub))
}
