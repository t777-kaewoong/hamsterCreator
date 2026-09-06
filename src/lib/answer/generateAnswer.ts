import { sampleStroke } from '@/features/canvas/strokeGeometry'
import { findShortestPath } from '@/lib/geometry/gridGraph'
import type { Direction, GoalMarker, MapDoc, NodeCoord } from '@/lib/model/types'

export type BoardCommand = 'board_forward' | 'board_left' | 'board_right'

export interface AnswerGoalStop {
  goal: GoalMarker
  pathIndex: number
}

export interface GridAnswer {
  path: NodeCoord[]
  goalStops: AnswerGoalStop[]
  commands: BoardCommand[]
  pythonCode: string
  moveCount: number
  rotationCount: number
  finalHeading: Direction
}

export type GridAnswerFailureCode = 'no-start' | 'no-goal' | 'unreachable'

export interface GridAnswerFailure {
  code: GridAnswerFailureCode
  message: string
  at?: NodeCoord
}

export type GridAnswerResult =
  | { ok: true; answer: GridAnswer }
  | { ok: false; error: GridAnswerFailure }

export interface LineTracerAnswer {
  pythonCode: string
  lengthMm: number
  strokeCount: number
}

const HEADINGS: Direction[] = ['N', 'E', 'S', 'W']

function movementHeading(from: NodeCoord, to: NodeCoord): Direction {
  if (to[0] > from[0]) return 'E'
  if (to[0] < from[0]) return 'W'
  if (to[1] > from[1]) return 'S'
  return 'N'
}

function appendTurn(commands: BoardCommand[], current: Direction, target: Direction): Direction {
  const delta = (HEADINGS.indexOf(target) - HEADINGS.indexOf(current) + HEADINGS.length) % HEADINGS.length
  if (delta === 1) commands.push('board_right')
  else if (delta === 2) commands.push('board_right', 'board_right')
  else if (delta === 3) commands.push('board_left')
  return target
}

function createPythonCode(commands: BoardCommand[]): string {
  const body = commands.map((command) => `hamster.${command}()`).join('\n')
  return `from roboid import *\n\nhamster = HamsterS()${body ? `\n\n${body}` : ''}`
}

/** 출발점부터 지정된 도착 순서대로 각 구간의 BFS 최단 경로를 이어 정답을 만듭니다. */
export function createGridAnswer(doc: MapDoc, goals: GoalMarker[] = doc.markers.goals): GridAnswerResult {
  const start = doc.markers.start
  if (!start) {
    return { ok: false, error: { code: 'no-start', message: '출발점이 없습니다. M 도구로 출발점을 지정하세요.' } }
  }
  if (goals.length === 0) {
    return { ok: false, error: { code: 'no-goal', message: '도착점이 없습니다. M 도구에서 Alt+클릭으로 지정하세요.', at: start.cell } }
  }

  const path: NodeCoord[] = [start.cell]
  const goalStops: AnswerGoalStop[] = []
  let segmentStart = start.cell
  for (const goal of goals) {
    const segment = findShortestPath(doc, segmentStart, goal.cell)
    if (!segment.path) {
      return {
        ok: false,
        error: {
          code: 'unreachable',
          message: `${goal.name || '도착'}까지 이어진 길이 없습니다. 마지막으로 갈 수 있는 지점을 확인하세요.`,
          at: segment.closest,
        },
      }
    }
    path.push(...segment.path.slice(1))
    goalStops.push({ goal, pathIndex: path.length - 1 })
    segmentStart = goal.cell
  }

  const commands: BoardCommand[] = []
  let heading = start.heading
  for (let index = 1; index < path.length; index++) {
    const nextHeading = movementHeading(path[index - 1], path[index])
    heading = appendTurn(commands, heading, nextHeading)
    commands.push('board_forward')
  }

  return {
    ok: true,
    answer: {
      path,
      goalStops,
      commands,
      pythonCode: createPythonCode(commands),
      moveCount: path.length - 1,
      rotationCount: commands.filter((command) => command !== 'board_forward').length,
      finalHeading: heading,
    },
  }
}

/** 모든 자유곡선의 샘플 꺾은선 길이를 합산해 라인트레이싱 참고 답안을 만듭니다. */
export function createLineTracerAnswer(doc: MapDoc): LineTracerAnswer | null {
  if (doc.strokes.length === 0) return null
  let lengthMm = 0
  for (const stroke of doc.strokes) {
    const points = sampleStroke(stroke)
    for (let index = 1; index < points.length; index++) {
      lengthMm += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1])
    }
  }
  return {
    lengthMm,
    strokeCount: doc.strokes.length,
    pythonCode: [
      'from roboid import *',
      '',
      'hamster = HamsterS()',
      'hamster.line_speed(5)',
      'hamster.line_gain(5)',
      'hamster.line_both()',
    ].join('\n'),
  }
}
