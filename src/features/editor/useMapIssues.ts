// 맵 검증 결과를 두 곳(Inspector.tsx의 "검증" 섹션, EditorLayout.tsx의 인스펙터 접기
// 배지)이 나눠 쓰는 작은 훅입니다.
//
// [왜 훅 하나로 뺐는가]
// validateMap(doc)은 lib/geometry/validate.ts의 순수 함수라 아무 데서나 불러도 안전하지만,
// 이 앱은 팬·줌처럼 doc과 무관한 이유로도 자주 리렌더됩니다. 매 렌더마다 다시 계산하지
// 않도록 useMemo로 "doc이 실제로 바뀌었을 때만" 다시 계산합니다.
//
// [Inspector와 EditorLayout이 각자 이 훅을 불러도 계산이 두 번 되지 않는가]
// 됩니다 — 컴포넌트마다 useMemo 캐시가 따로 생기므로, 같은 doc이어도 두 컴포넌트가 각각
// 한 번씩 validateMap을 부릅니다. 이걸 완전히 하나로 합치려면 zustand 스토어에 "지금
// doc의 검증 결과"를 파생 상태로 얹거나 React Context로 값을 한 번만 계산해 내려보내야
// 하는데, 이 앱이 다루는 가장 큰 맵(A0, 23×16=368칸)에서도 validateMap은 격자 그래프
// BFS 한두 번 수준의 가벼운 계산입니다(lib/geometry/validate.ts의 reachableNodes 주석
// 참고 — "칸이 많아도 수백 번 순회라 전혀 부담 없다"). 반면 공유 캐시를 만들면 "누가
// 언제 무효화하는가"라는 새로운 복잡도가 생기므로, 여기서는 "각자 훅을 부르되 훅 내부
// 에서만 메모이즈한다"는 더 단순한 쪽을 택했습니다.
import { useMemo } from 'react'
import { validateMap } from '@/lib/geometry/validate'
import type { Issue } from '@/lib/geometry/validate'
import { useEditorStore } from './editorStore'

/** 지금 열린 맵의 검증 결과. 맵이 없으면 빈 배열. */
export function useMapIssues(): Issue[] {
  const doc = useEditorStore((s) => s.doc)
  return useMemo(() => (doc ? validateMap(doc) : []), [doc])
}
