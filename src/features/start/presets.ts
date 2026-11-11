// 시작 화면 프리셋 카드 정의 (PRD §9.8).
//
// [2026-11-11 후기 11차 — "simple is best"] 예전에는 용지 4종·교과서 부록 2종·라인트레이서까지
// 8종이었는데, 교사가 실제로 고르는 건 "A4 기본"과 "빈 격자" 두 가지뿐이었습니다. 나머지는
// 편집기에서 종이 붙이기·인스펙터 용지 바꾸기로 언제든 만들 수 있어 카드에서 뺐습니다(docs/14 §2.1).
import type { MapDoc } from '@/lib/model/types'
import { createEmptyMap, createFullGridMap } from '@/lib/model/factory'
import { PAPER_SIZES, PITCH_MM } from '@/lib/model/constants'

/** 프리셋 카드 하나의 정보. StartScreen이 이 배열을 그대로 매핑해 카드를 그립니다. */
export interface StartPreset {
  /** React key이자, 썸네일 캐시(thumbnail.ts 호출부)의 키로도 씁니다 */
  id: string
  /** 카드 이름 */
  name: string
  /** 카드 아래 규격 문구. 예: "A4 · 5×4칸 · 250×200mm" */
  specLabel: string
  /** 클릭 시 실제로 만들 맵 문서. 클릭하는 그 순간 호출해서 매번 새 문서를 받습니다
   *  (같은 객체를 여러 카드가 공유하면 한쪽 편집이 다른 쪽에 번지므로) */
  create(): MapDoc
}

/** 용지 id로 표시용 라벨을 찾습니다. 못 찾으면(등록 안 된 용지) id 자체를 그대로 씁니다. */
function paperLabel(sheetId: string): string {
  return PAPER_SIZES.find((p) => p.id === sheetId)?.label ?? sheetId
}

/** 규격 문구 "A4 · 5×4칸 · 250×200mm". mm 크기는 칸 피치(50mm) × 칸 수. */
function buildSpecLabel(sheetId: string, cols: number, rows: number): string {
  return `${paperLabel(sheetId)} · ${cols}×${rows}칸 · ${cols * PITCH_MM}×${rows * PITCH_MM}mm`
}

export const START_PRESETS: StartPreset[] = [
  {
    id: 'a4-basic',
    name: 'A4 기본',
    specLabel: buildSpecLabel('A4', 5, 4),
    create: () => createFullGridMap(5, 4, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
  {
    id: 'empty',
    name: '빈 격자',
    specLabel: buildSpecLabel('A4', 5, 4),
    // 엣지를 전혀 안 채운 순수 빈 맵. 편집기를 열자마자 흰 종이만 보입니다.
    create: () => createEmptyMap(5, 4, { title: '새 말판', sheet: 'A4', orientation: 'landscape' }),
  },
]
