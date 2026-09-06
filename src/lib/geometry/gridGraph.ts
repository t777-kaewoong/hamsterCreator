import type { MapDoc, NodeCoord } from '@/lib/model/types'

function nodeKey([column, row]: NodeCoord): string {
  return `${column},${row}`
}

function parseNodeKey(key: string): NodeCoord {
  const [column, row] = key.split(',').map(Number)
  return [column, row]
}

/** 격자 엣지를 인접 목록으로 바꿉니다. 잘못된 파일의 범위 밖 엣지는 무시합니다. */
export function buildGridAdjacency(doc: MapDoc): Map<string, NodeCoord[]> {
  const adjacency = new Map<string, NodeCoord[]>()
  const inRange = ([column, row]: NodeCoord) =>
    column >= 0 && column < doc.board.cols && row >= 0 && row < doc.board.rows

  function connect(a: NodeCoord, b: NodeCoord) {
    if (!inRange(a) || !inRange(b)) return
    const aKey = nodeKey(a)
    const bKey = nodeKey(b)
    adjacency.set(aKey, [...(adjacency.get(aKey) ?? []), b])
    adjacency.set(bKey, [...(adjacency.get(bKey) ?? []), a])
  }

  for (const [column, row] of doc.edges.h) connect([column, row], [column + 1, row])
  for (const [column, row] of doc.edges.v) connect([column, row], [column, row + 1])
  return adjacency
}

/** 출발점에서 도달 가능한 모든 격자 노드의 키(`c,r`)를 반환합니다. */
export function reachableNodes(doc: MapDoc, from: NodeCoord): Set<string> {
  const adjacency = buildGridAdjacency(doc)
  const startKey = nodeKey(from)
  const inRange = from[0] >= 0 && from[0] < doc.board.cols && from[1] >= 0 && from[1] < doc.board.rows
  if (!inRange) return new Set()

  const seen = new Set([startKey])
  const queue: NodeCoord[] = [from]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    for (const neighbor of adjacency.get(nodeKey(current)) ?? []) {
      const key = nodeKey(neighbor)
      if (seen.has(key)) continue
      seen.add(key)
      queue.push(neighbor)
    }
  }
  return seen
}

export interface ShortestPathResult {
  path: NodeCoord[] | null
  closest: NodeCoord
}

/** 엣지 그래프 BFS 최단 경로와 오류 강조용 마지막 도달 지점을 함께 계산합니다. */
export function findShortestPath(doc: MapDoc, from: NodeCoord, to: NodeCoord): ShortestPathResult {
  const adjacency = buildGridAdjacency(doc)
  const startKey = nodeKey(from)
  const targetKey = nodeKey(to)
  const queue: NodeCoord[] = [from]
  const previous = new Map<string, string | null>([[startKey, null]])
  let closest = from
  let closestDistance = Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1])

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    const currentKey = nodeKey(current)
    const distance = Math.abs(current[0] - to[0]) + Math.abs(current[1] - to[1])
    if (distance < closestDistance) {
      closest = current
      closestDistance = distance
    }
    if (currentKey === targetKey) {
      const path: NodeCoord[] = []
      let cursor: string | null = targetKey
      while (cursor !== null) {
        path.push(parseNodeKey(cursor))
        cursor = previous.get(cursor) ?? null
      }
      path.reverse()
      return { path, closest: to }
    }

    for (const neighbor of adjacency.get(currentKey) ?? []) {
      const key = nodeKey(neighbor)
      if (previous.has(key)) continue
      previous.set(key, currentKey)
      queue.push(neighbor)
    }
  }

  return { path: null, closest }
}
