// 선택 도구(V)의 끌어 옮기기·크기 핸들·복사/붙여넣기 계산 (docs/06 §2.5).
//
// [왜 toolInteractions.ts와 따로 두는가]
// 포인터 이벤트 처리(언제 끌기가 시작됐는지, 실행취소를 어떻게 묶는지)와 "문서를 어떻게
// 바꾸는지"를 나눠 두면, 이 파일의 함수는 문서 + 숫자만 받는 순수 계산이 되어 개발 서버에서
// 직접 불러 확인하기 쉽습니다. 모든 결과 좌표·크기는 1mm 단위로 반올림합니다(후기 13번 —
// 원 지름이 소수점 아래 열몇 자리로 나오던 문제).
import type { Cell, Label, MapDoc, Obstacle, Prop, Stroke } from '@/lib/model/types'
import type { Selection } from '@/features/editor/editorStore'
import { shiftStroke } from '@/lib/model/resize'
import { obstaclesOf } from '@/lib/model/obstacles'
import { cellAtMm } from './gridMath'
import { strokeBounds } from './strokeGeometry'

/** 크기 핸들 위치. hx·hy가 -1이면 왼쪽·위, 1이면 오른쪽·아래, 0이면 그 축의 가운데(변 핸들). */
export interface HandleId {
  hx: -1 | 0 | 1
  hy: -1 | 0 | 1
}

/** 옮기기·크기 조절 대상의 중심·크기·회전(mm, 도). */
export interface EditBox {
  cx: number
  cy: number
  w: number
  h: number
  rot: number
}

/** 크기를 이보다 작게 줄이지 않습니다(mm). 핸들이 서로 겹쳐 다시 잡을 수 없게 되는 것을 막습니다. */
export const MIN_SIZE_MM = 4

const CORNERS: HandleId[] = [
  { hx: -1, hy: -1 },
  { hx: 1, hy: -1 },
  { hx: 1, hy: 1 },
  { hx: -1, hy: 1 },
]
const EDGES: HandleId[] = [
  { hx: 0, hy: -1 },
  { hx: 1, hy: 0 },
  { hx: 0, hy: 1 },
  { hx: -1, hy: 0 },
]

const round = (value: number) => Math.round(value)

function findStroke(doc: MapDoc, id: string): Stroke | undefined {
  return doc.strokes.find((stroke) => stroke.id === id)
}

/** 선택 대상의 상자. 상자로 다룰 수 없는 것(꺾은선·곡선·칸 타일)은 null입니다. */
export function editBoxOf(doc: MapDoc, selection: Selection): EditBox | null {
  if (!selection) return null
  if (selection.kind === 'prop') {
    const prop = doc.props[selection.index]
    return prop ? { cx: prop.x + prop.w / 2, cy: prop.y + prop.h / 2, w: prop.w, h: prop.h, rot: prop.rot } : null
  }
  if (selection.kind === 'obstacle') {
    const o = obstaclesOf(doc)[selection.index]
    return o ? { cx: o.cx, cy: o.cy, w: o.d, h: o.d, rot: 0 } : null
  }
  if (selection.kind === 'stroke') {
    const stroke = findStroke(doc, selection.id)
    if (!stroke) return null
    if (stroke.kind === 'circle') return { cx: stroke.cx, cy: stroke.cy, w: stroke.r * 2, h: stroke.r * 2, rot: 0 }
    if (stroke.kind === 'ellipse') return { cx: stroke.cx, cy: stroke.cy, w: stroke.rx * 2, h: stroke.ry * 2, rot: 0 }
    if (stroke.kind === 'roundedRect') return { cx: stroke.cx, cy: stroke.cy, w: stroke.w, h: stroke.h, rot: 0 }
  }
  return null
}

/** 이 선택에 그릴 크기 핸들. 원·장애물은 비율이 고정이라 모서리 4개만 둡니다. */
export function handlesFor(doc: MapDoc, selection: Selection): HandleId[] {
  if (!selection) return []
  if (selection.kind === 'obstacle') return CORNERS
  if (selection.kind === 'prop') return [...CORNERS, ...EDGES]
  if (selection.kind === 'stroke') {
    const stroke = findStroke(doc, selection.id)
    if (stroke?.kind === 'circle') return CORNERS
    if (stroke?.kind === 'ellipse' || stroke?.kind === 'roundedRect') return [...CORNERS, ...EDGES]
  }
  return []
}

/** 원·장애물은 늘 가로세로가 같아야 합니다. */
export function isUniform(doc: MapDoc, selection: Selection): boolean {
  if (!selection) return false
  if (selection.kind === 'obstacle') return true
  return selection.kind === 'stroke' && findStroke(doc, selection.id)?.kind === 'circle'
}

/** 핸들의 mm 위치(회전 반영). */
export function handlePositionMm(box: EditBox, handle: HandleId): [number, number] {
  const lx = (handle.hx * box.w) / 2
  const ly = (handle.hy * box.h) / 2
  const rad = (box.rot * Math.PI) / 180
  return [box.cx + lx * Math.cos(rad) - ly * Math.sin(rad), box.cy + lx * Math.sin(rad) + ly * Math.cos(rad)]
}

/**
 * 핸들을 (px, py)까지 끌었을 때의 새 상자. 맞은편 모서리(변)는 그 자리에 고정됩니다.
 *
 * 회전된 그림도 다루기 위해 끈 점을 상자 기준 좌표로 되돌린 뒤 계산하고, 다시 돌려 놓습니다.
 * keepRatio면 원래 가로세로 비율을 지킵니다(모서리: 더 많이 늘어난 쪽 기준, 변: 반대 축도 같이).
 */
export function resizeBox(orig: EditBox, handle: HandleId, px: number, py: number, keepRatio: boolean): EditBox {
  const rad = (orig.rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - orig.cx
  const dy = py - orig.cy
  const localX = dx * cos + dy * sin
  const localY = -dx * sin + dy * cos
  const anchorX = (-handle.hx * orig.w) / 2
  const anchorY = (-handle.hy * orig.h) / 2

  let w = handle.hx !== 0 ? Math.max(MIN_SIZE_MM, (localX - anchorX) * handle.hx) : orig.w
  let h = handle.hy !== 0 ? Math.max(MIN_SIZE_MM, (localY - anchorY) * handle.hy) : orig.h
  if (keepRatio && orig.w > 0 && orig.h > 0) {
    const scale =
      handle.hx !== 0 && handle.hy !== 0 ? Math.max(w / orig.w, h / orig.h) : handle.hx !== 0 ? w / orig.w : h / orig.h
    w = Math.max(MIN_SIZE_MM, orig.w * scale)
    h = Math.max(MIN_SIZE_MM, orig.h * scale)
  }
  w = round(w)
  h = round(h)

  // 고정된 쪽(anchor)에서 새 크기만큼 떨어진 곳이 새 중심입니다. 변 핸들이면 다른 축은 가운데 유지.
  const centerLocalX = handle.hx !== 0 ? anchorX + (handle.hx * w) / 2 : 0
  const centerLocalY = handle.hy !== 0 ? anchorY + (handle.hy * h) / 2 : 0
  return {
    cx: round(orig.cx + centerLocalX * cos - centerLocalY * sin),
    cy: round(orig.cy + centerLocalX * sin + centerLocalY * cos),
    w,
    h,
    rot: orig.rot,
  }
}

/** 새 상자를 선택 대상에 써 넣은 문서. */
export function applyEditBox(doc: MapDoc, selection: Selection, box: EditBox): MapDoc {
  if (!selection) return doc
  if (selection.kind === 'prop') {
    const prop = doc.props[selection.index]
    if (!prop) return doc
    const props = doc.props.slice()
    props[selection.index] = { ...prop, w: box.w, h: box.h, x: round(box.cx - box.w / 2), y: round(box.cy - box.h / 2) }
    return { ...doc, props }
  }
  if (selection.kind === 'obstacle') {
    const list = obstaclesOf(doc).slice()
    const o = list[selection.index]
    if (!o) return doc
    list[selection.index] = { ...o, cx: box.cx, cy: box.cy, d: box.w }
    return { ...doc, obstacles: list }
  }
  if (selection.kind === 'stroke') {
    const index = doc.strokes.findIndex((stroke) => stroke.id === selection.id)
    const stroke = doc.strokes[index]
    if (!stroke) return doc
    let next: Stroke
    if (stroke.kind === 'circle') next = { ...stroke, cx: box.cx, cy: box.cy, r: box.w / 2 }
    else if (stroke.kind === 'ellipse') next = { ...stroke, cx: box.cx, cy: box.cy, rx: box.w / 2, ry: box.h / 2 }
    else if (stroke.kind === 'roundedRect') {
      next = { ...stroke, cx: box.cx, cy: box.cy, w: box.w, h: box.h, radius: Math.min(stroke.radius, box.w / 2, box.h / 2) }
    } else return doc
    const strokes = doc.strokes.slice()
    strokes[index] = next
    return { ...doc, strokes }
  }
  return doc
}

/**
 * 선택 대상을 (dx, dy)mm 옮긴 문서와 옮긴 뒤의 선택.
 * 칸 타일은 mm로 옮기지 않고, 칸 중심이 옮겨 간 자리의 칸으로 이사합니다(그 칸의 타일은 바뀜).
 * keepSource면 원래 칸을 비우지 않습니다(Ctrl+끌기 복제).
 */
export function translateSelection(
  doc: MapDoc,
  selection: Selection,
  dx: number,
  dy: number,
  keepSource = false,
): { doc: MapDoc; selection: Selection } {
  if (!selection || (dx === 0 && dy === 0)) return { doc, selection }
  if (selection.kind === 'cell') {
    const { cols, rows, pitch } = doc.board
    const cell = doc.cells[selection.index]
    if (!cell) return { doc, selection }
    const c = selection.index % cols
    const r = Math.floor(selection.index / cols)
    const target = cellAtMm(c * pitch + pitch / 2 + dx, r * pitch + pitch / 2 + dy, cols, rows, pitch)
    if (!target) return { doc, selection }
    const targetIndex = target.r * cols + target.c
    if (targetIndex === selection.index) return { doc, selection }
    const cells = doc.cells.slice()
    if (!keepSource) cells[selection.index] = null
    cells[targetIndex] = { ...cell }
    return { doc: { ...doc, cells }, selection: { kind: 'cell', index: targetIndex } }
  }
  if (selection.kind === 'prop') {
    const prop = doc.props[selection.index]
    if (!prop) return { doc, selection }
    const props = doc.props.slice()
    props[selection.index] = { ...prop, x: prop.x + dx, y: prop.y + dy }
    return { doc: { ...doc, props }, selection }
  }
  if (selection.kind === 'label') {
    const label = doc.labels[selection.index]
    if (!label) return { doc, selection }
    const labels = doc.labels.slice()
    labels[selection.index] = { ...label, x: label.x + dx, y: label.y + dy }
    return { doc: { ...doc, labels }, selection }
  }
  if (selection.kind === 'obstacle') {
    const list = obstaclesOf(doc).slice()
    const o = list[selection.index]
    if (!o) return { doc, selection }
    list[selection.index] = { ...o, cx: o.cx + dx, cy: o.cy + dy }
    return { doc: { ...doc, obstacles: list }, selection }
  }
  const index = doc.strokes.findIndex((stroke) => stroke.id === selection.id)
  if (index < 0) return { doc, selection }
  const strokes = doc.strokes.slice()
  strokes[index] = shiftStroke(strokes[index], dx, dy)
  return { doc: { ...doc, strokes }, selection }
}

// ── 복사·붙여넣기 ───────────────────────────────────────────────────────

/** 복사해 둔 항목. 문서와 따로 들고 있어야 원본을 지워도 붙여넣을 수 있습니다. */
export type ClipItem =
  | { kind: 'cell'; item: Cell; index: number }
  | { kind: 'prop'; item: Prop }
  | { kind: 'label'; item: Label }
  | { kind: 'stroke'; item: Stroke }
  | { kind: 'obstacle'; item: Obstacle }

export function copySelection(doc: MapDoc, selection: Selection): ClipItem | null {
  if (!selection) return null
  if (selection.kind === 'cell') {
    const cell = doc.cells[selection.index]
    return cell ? { kind: 'cell', item: structuredClone(cell), index: selection.index } : null
  }
  if (selection.kind === 'prop') {
    const prop = doc.props[selection.index]
    return prop ? { kind: 'prop', item: structuredClone(prop) } : null
  }
  if (selection.kind === 'label') {
    const label = doc.labels[selection.index]
    return label ? { kind: 'label', item: structuredClone(label) } : null
  }
  if (selection.kind === 'obstacle') {
    const o = obstaclesOf(doc)[selection.index]
    return o ? { kind: 'obstacle', item: structuredClone(o) } : null
  }
  const stroke = findStroke(doc, selection.id)
  return stroke ? { kind: 'stroke', item: structuredClone(stroke) } : null
}

/** 복사한 항목의 중심(mm). 붙여넣을 때 커서 위치에 이 점을 맞춥니다. */
function clipCenter(doc: MapDoc, clip: ClipItem): [number, number] {
  if (clip.kind === 'cell') {
    const { cols, pitch } = doc.board
    return [(clip.index % cols) * pitch + pitch / 2, Math.floor(clip.index / cols) * pitch + pitch / 2]
  }
  if (clip.kind === 'prop') return [clip.item.x + clip.item.w / 2, clip.item.y + clip.item.h / 2]
  if (clip.kind === 'label') return [clip.item.x, clip.item.y]
  if (clip.kind === 'obstacle') return [clip.item.cx, clip.item.cy]
  const bounds = strokeBounds(clip.item)
  return bounds ? [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2] : [0, 0]
}

/**
 * 복사한 항목을 붙여넣은 문서와 새 선택. at이 있으면 그 점(커서)에, 없으면 원래 자리에서
 * offsetMm만큼 오른쪽·아래로 비켜 놓습니다. 칸 타일은 그 점이 가리키는 칸(없으면 오른쪽 칸)에 놓습니다.
 * 놓을 자리가 없으면 null.
 */
export function pasteClip(
  doc: MapDoc,
  clip: ClipItem,
  at: [number, number] | null,
  offsetMm: number,
  createStrokeId: (doc: MapDoc) => string,
): { doc: MapDoc; selection: Selection } | null {
  const [ox, oy] = clipCenter(doc, clip)
  const dx = at ? round(at[0] - ox) : offsetMm
  const dy = at ? round(at[1] - oy) : offsetMm

  if (clip.kind === 'cell') {
    const { cols, rows, pitch } = doc.board
    const target = at
      ? cellAtMm(at[0], at[1], cols, rows, pitch)
      : cellAtMm(ox + pitch, oy, cols, rows, pitch) ?? cellAtMm(ox, oy + pitch, cols, rows, pitch)
    if (!target) return null
    const index = target.r * cols + target.c
    const cells = doc.cells.slice()
    cells[index] = structuredClone(clip.item)
    return { doc: { ...doc, cells }, selection: { kind: 'cell', index } }
  }
  if (clip.kind === 'prop') {
    const props = [...doc.props, { ...structuredClone(clip.item), x: clip.item.x + dx, y: clip.item.y + dy }]
    return { doc: { ...doc, props }, selection: { kind: 'prop', index: props.length - 1 } }
  }
  if (clip.kind === 'label') {
    const labels = [...doc.labels, { ...structuredClone(clip.item), x: clip.item.x + dx, y: clip.item.y + dy }]
    return { doc: { ...doc, labels }, selection: { kind: 'label', index: labels.length - 1 } }
  }
  if (clip.kind === 'obstacle') {
    const obstacles = [...obstaclesOf(doc), { ...structuredClone(clip.item), cx: clip.item.cx + dx, cy: clip.item.cy + dy }]
    return { doc: { ...doc, obstacles }, selection: { kind: 'obstacle', index: obstacles.length - 1 } }
  }
  const stroke = { ...shiftStroke(structuredClone(clip.item), dx, dy), id: createStrokeId(doc) }
  return { doc: { ...doc, strokes: [...doc.strokes, stroke] }, selection: { kind: 'stroke', id: stroke.id } }
}
