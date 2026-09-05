// 시작 화면 프리셋 카드 정의 (PRD §9.8 "프리셋 8종" 표).
//
// PRD 표에는 8종이 나열되어 있지만, 이 파일에는 지금 실제로 만들 수 있는 5종만 담습니다.
//
//   A4 기본 · A4 2장 · A4 4장 · A2 1장 · 빈 격자   ← 여기 있음 (전부 격자만 있는 맵)
//   부록 배리어프리 (교과서 p190 재현)             ← 없음
//   부록 재난구조 (교과서 p185 재현, 격자+곡선 혼합) ← 없음
//   라인트레이서 (곡선 트랙, 격자 없음)             ← 없음
//
// 뒤 3종은 전부 "자유곡선"(strokes: 펜/도형으로 그리는 곡선 트랙)이 있어야 재현되는
// 프리셋인데, 이 프로젝트에는 아직 자유곡선을 실제로 만드는 도구가 없습니다(FR-10,
// M1.5 단계에서 펜·도형 도구와 함께 구현 예정 — src/lib/model/types.ts의 Stroke 타입은
// 이미 있지만 그걸 채워 넣는 편집 기능이 없다는 뜻입니다). 지금 만들면 "곡선이 통째로
// 빠진 격자만 있는 가짜 프리셋"이 되어버립니다.
//
// 그래서 이 3종은 카드 자체를 화면에 올리지 않았습니다. PRD §9.8의 목적이 "10초 안에
// 클릭할 것을 찾게 하는 것"(U1)인데, 눌러도 기대한 모양이 안 나오는 카드가 섞여 있으면
// 오히려 고르는 시간을 늘리고 신뢰를 깎아 먹습니다. 비활성(회색) 카드로 자리만 차지하게
// 두는 것도 같은 이유로 하지 않았습니다 — 아예 없는 편이 "지금 쓸 수 있는 것"만 보여줘서
// 더 빠르게 고를 수 있습니다.
//
// M1.5에서 자유곡선 펜/도형 도구가 들어오면, 이 배열에 위 3개 항목을 create()와 함께
// 추가하면 됩니다(교과서 p190/p185 실측 좌표는 이 작업 범위 밖이라 별도 확인 필요).
import type { MapDoc } from '@/lib/model/types'
import { createEmptyMap, createFullGridMap } from '@/lib/model/factory'
import { PAPER_SIZES, PITCH_MM } from '@/lib/model/constants'

/** 프리셋 카드 하나의 정보. StartScreen이 이 배열을 그대로 매핑해 카드를 그립니다. */
export interface StartPreset {
  /** React key이자, 썸네일 캐시(thumbnail.ts 호출부)의 키로도 씁니다 */
  id: string
  /** 카드 이름(label 크기 글자) */
  name: string
  /** 카드 하단 규격 칩 문구. 예: "A4 · 5×4칸 · 250×200mm" (PRD §9.8 예시 형식 그대로) */
  specLabel: string
  /** PRD §9.8: "A4 기본"에만 붙는 ★기본 표시 */
  isDefault?: boolean
  /** 클릭 시 실제로 만들 맵 문서. 클릭하는 그 순간 호출해서 매번 새 문서를 받습니다
   *  (같은 객체를 여러 카드가 공유하면 한쪽 편집이 다른 쪽에 번지므로) */
  create(): MapDoc
}

/** 용지 id로 §6.1 표시용 라벨을 찾습니다. 못 찾으면(등록 안 된 용지) id 자체를 그대로 씁니다. */
function paperLabel(sheetId: string): string {
  return PAPER_SIZES.find((p) => p.id === sheetId)?.label ?? sheetId
}

/** PRD §9.8 규격 칩 형식: "A4 · 5×4칸 · 250×200mm". mm 크기는 칸 피치(50mm) × 칸 수. */
function buildSpecLabel(sheetId: string, cols: number, rows: number): string {
  const widthMm = cols * PITCH_MM
  const heightMm = rows * PITCH_MM
  return `${paperLabel(sheetId)} · ${cols}×${rows}칸 · ${widthMm}×${heightMm}mm`
}

export const START_PRESETS: StartPreset[] = [
  {
    id: 'a4-basic',
    name: 'A4 기본',
    specLabel: buildSpecLabel('A4', 5, 4),
    isDefault: true,
    create: () => createFullGridMap(5, 4, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
  {
    id: 'a4-two',
    name: 'A4 2장',
    specLabel: buildSpecLabel('A4', 10, 4),
    create: () => createFullGridMap(10, 4, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
  {
    id: 'a4-four',
    name: 'A4 4장',
    specLabel: buildSpecLabel('A4', 10, 8),
    create: () => createFullGridMap(10, 8, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
  {
    id: 'a2-one',
    name: 'A2 1장',
    specLabel: buildSpecLabel('A2', 11, 8),
    create: () => createFullGridMap(11, 8, { title: '새 말판', sheet: 'A2', orientation: 'landscape' }),
  },
  {
    id: 'empty',
    name: '빈 격자',
    specLabel: buildSpecLabel('A4', 5, 4),
    // 엣지(edges.h/v)를 전혀 안 채운 순수 빈 맵. createFullGridMap과 달리 격자선이 하나도
    // 없어 편집기를 열자마자 흰 종이만 보입니다(PRD §9.8 "빈 격자 = 5×4, 엣지 없음").
    create: () => createEmptyMap(5, 4, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
]
