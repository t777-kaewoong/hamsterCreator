// V(선택) 도구 히트테스트 — mm 좌표(캔버스를 클릭한 지점)에 실제로 무엇이 있는지 찾습니다.
//
// [검사 순서] 렌더 순서(§5: … cells → props → labels → markers)의 역순으로 검사합니다:
// labels → props → cells. 화면에서 위에 그려진 것일수록 시각적으로 먼저 눈에 띄고
// 클릭도 그것을 집으려는 의도일 가능성이 높기 때문입니다(그림판·포토샵 등 대부분의
// 편집기가 따르는 관례). markers는 이번 단계(M1-5a)에서 선택 가능한 대상으로 요구되지
// 않아 검사하지 않습니다 — 위치를 옮기는 인스펙터 UI가 아직 없고, M 도구가 클릭으로
// 바로 지정/토글하는 방식이라 "먼저 선택한 뒤 조작"하는 흐름 자체가 필요 없습니다.
import type { Label, MapDoc } from '@/lib/model/types'
import type { Selection } from '@/features/editor/editorStore'
import { getTile } from '@/lib/tiles/catalog'
import { cellAtMm } from './gridMath'
import { measureLabelBoxMm } from './drawBoard'
import { distanceToStroke } from './strokeGeometry'

// 라벨 폭을 재려면(measureLabelBoxMm) CanvasRenderingContext2D가 있어야 하는데, hitTest는
// "mm 좌표만 주면 무엇이 찍혔는지 알려준다"는 순수 계산 함수로 두고 싶어서 호출부에
// context를 넘기라고 요구하지 않습니다. 대신 화면에 안 붙는 1×1 스크래치 캔버스를 이
// 파일 전용으로 딱 하나만 만들어 재사용합니다 — renderer.ts가 5개 레이어를 오프스크린
// <canvas>로 만드는 것과 같은 방식(DOM에 안 붙여도 2D 컨텍스트 API는 그대로 동작).
let scratchCtx: CanvasRenderingContext2D | null = null
function getScratchCtx(): CanvasRenderingContext2D {
  if (!scratchCtx) {
    scratchCtx = document.createElement('canvas').getContext('2d')!
  }
  return scratchCtx
}

/** measureLabelBoxMm을 이 파일의 공용 스크래치 컨텍스트로 바로 호출하는 편의 함수.
 *  toolInteractions.ts가 선택 오버레이(selectionBox)의 라벨 크기를 잴 때도 이 파일과
 *  똑같은 스크래치 캔버스를 재사용하도록 export합니다 — 컨텍스트를 새로 만드는 곳이
 *  여러 군데로 늘어나지 않게 하기 위함입니다. */
export function measureLabelBoxMmCached(label: Label): { wMm: number; hMm: number } {
  return measureLabelBoxMm(getScratchCtx(), label)
}

/**
 * 점 (px, py)가 중심 (cx, cy), 크기 (wMm × hMm), 회전 rotDeg(시계방향, 도)인 사각형
 * 안에 있는지 검사합니다.
 *
 * [계산 근거] 사각형이 회전되어 있으면 그대로는 "가로/세로 범위 안에 있는가"를 비교할
 * 수 없습니다. 그래서 점을 사각형 중심을 기준으로 -rotDeg만큼(사각형이 돌아간 반대
 * 방향으로) 되돌려 돌리면, 사각형은 다시 축에 나란한 모양이 되고 점도 그 사각형 기준
 * 좌표로 바뀝니다. 이렇게 만든 "로컬 좌표"를 절반 크기와 비교하면 끝입니다 — 마치
 * 기울어진 종이를 다시 똑바로 돌려놓고 자로 재는 것과 같습니다.
 */
function pointInRotatedRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  wMm: number,
  hMm: number,
  rotDeg: number,
): boolean {
  const dx = px - cx
  const dy = py - cy
  const rad = (-rotDeg * Math.PI) / 180
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad)
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad)
  return Math.abs(localX) <= wMm / 2 && Math.abs(localY) <= hMm / 2
}

/** mm 좌표 (mx, my)를 클릭했을 때 무엇이 선택되어야 하는지 판정합니다. 아무 것도 없으면 null. */
export function hitTest(doc: MapDoc, mx: number, my: number): Selection {
  // ① 라벨 — 배열 뒤쪽(나중에 추가된 것)일수록 화면에서 위에 그려지므로 역순으로 검사.
  const ctx = getScratchCtx()
  for (let i = doc.labels.length - 1; i >= 0; i--) {
    const label = doc.labels[i]
    const { wMm, hMm } = measureLabelBoxMm(ctx, label)
    // label.x/y는 drawLabelsLayer가 textAlign='center'/textBaseline='middle'로 그리는
    // 중심점이므로, 히트박스도 그 점을 중심으로 한 사각형이어야 그려진 모습과 일치합니다.
    if (pointInRotatedRect(mx, my, label.x, label.y, wMm, hMm, label.rot)) {
      return { kind: 'label', index: i }
    }
  }

  // ② 프롭 — drawPropsLayer와 마찬가지로 x/y는 좌상단이라 중심은 x+w/2, y+h/2 입니다.
  for (let i = doc.props.length - 1; i >= 0; i--) {
    const prop = doc.props[i]
    const cx = prop.x + prop.w / 2
    const cy = prop.y + prop.h / 2
    if (pointInRotatedRect(mx, my, cx, cy, prop.w, prop.h, prop.rot)) {
      return { kind: 'prop', index: i }
    }
  }

  // ③ 격자선 위에 그려지는 object 셀(사용자 이미지 포함). 곡선보다 화면 앞쪽이라 먼저 잡습니다.
  const cell = cellAtMm(mx, my, doc.board.cols, doc.board.rows, doc.board.pitch)
  if (cell) {
    const index = cell.r * doc.board.cols + cell.c
    const placed = doc.cells[index]
    if (placed && (placed.art.startsWith('asset:') || getTile(placed.art)?.kind === 'object')) {
      return { kind: 'cell', index }
    }
  }

  // ④ 자유곡선 — 화면에서 위에 놓인 마지막 곡선부터, 선폭 절반 + 2mm 선택 여유로 검사합니다.
  // 선 중심만 정확히 눌러야 하면 축소 배율에서 사실상 선택이 불가능해져 작은 여유가 필요합니다.
  for (let i = doc.strokes.length - 1; i >= 0; i--) {
    const stroke = doc.strokes[i]
    if (distanceToStroke(stroke, [mx, my]) <= stroke.width / 2 + 2) return { kind: 'stroke', id: stroke.id }
  }

  // ⑤ 곡선 아래에 그려지는 floor/block 셀. 빈 칸 클릭은 선택 해제로 처리합니다.
  if (cell) {
    const index = cell.r * doc.board.cols + cell.c
    if (doc.cells[index] !== null) return { kind: 'cell', index }
  }

  return null
}
