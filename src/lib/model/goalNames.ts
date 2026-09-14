import type { GoalMarker } from './types'

/** 도착점 위치는 한 문서 안에서 중복되지 않으므로 표시명 연결에도 같은 키를 씁니다. */
export function goalMarkerKey(goal: Pick<GoalMarker, 'cell'>): string {
  return `${goal.cell[0]},${goal.cell[1]}`
}

/**
 * 저장된 도착점 이름을 화면·PDF에서 쓸 표시명으로 바꿉니다.
 *
 * 비어 있지 않은 이름은 사용자가 정한 값일 수 있으므로 절대 고치지 않습니다. 빈 이름만
 * 현재 순서에 맞춰 자동 이름을 계산하며, 기존 사용자 이름과 겹치면 아직 쓰이지 않은 가장
 * 작은 번호를 찾습니다. 자동 이름을 문서에 다시 저장하지 않는 이유는 도착점을 추가하거나
 * 삭제할 때 다른 도착점의 저장값까지 바뀌어 사용자 이름을 잃는 문제를 원천 차단하기 위해서입니다.
 */
export function goalDisplayNames(goals: readonly GoalMarker[]): string[] {
  const names = new Array<string>(goals.length)
  const used = new Set<string>()

  goals.forEach((goal, index) => {
    const normalized = goal.name.trim()
    if (!normalized) return
    names[index] = goal.name
    used.add(normalized)
  })

  goals.forEach((goal, index) => {
    if (goal.name.trim()) return

    let candidate = goals.length === 1 ? '도착' : `도착${index + 1}`
    if (used.has(candidate)) {
      let number = 1
      while (used.has(`도착${number}`)) number += 1
      candidate = `도착${number}`
    }
    names[index] = candidate
    used.add(candidate)
  })

  return names
}

/** 정답 경유 순서가 바뀌어도 캔버스·지도 PDF와 같은 이름을 찾을 수 있는 위치별 표입니다. */
export function goalDisplayNameMap(goals: readonly GoalMarker[]): Map<string, string> {
  const names = goalDisplayNames(goals)
  return new Map(goals.map((goal, index) => [goalMarkerKey(goal), names[index]]))
}
