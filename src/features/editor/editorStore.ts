// 편집기 전역 상태 스토어 (Zustand).
//
// 상단바·도구 레일·캔버스·인스펙터는 화면에서 서로 멀리 떨어져 있지만 모두
// "지금 열린 맵 문서"와 "지금 선택된 도구"를 함께 봐야 합니다. props로 한 단계씩
// 내려주면 중간 컴포넌트들이 쓰지도 않는 값을 계속 넘겨야 해서 코드가 지저분해지므로,
// 이 스토어 하나에 모아두고 필요한 컴포넌트가 바로 꺼내 씁니다.
//
// 지금 단계(M1-1, 레이아웃 골격)에서는 아래 값만 다룹니다.
// 실행취소(undo/redo) 스택은 다음 단계에서 별도로 추가합니다.
import { create } from 'zustand'
import type { MapDoc } from '@/lib/model/types'
import { createMapStore } from '@/lib/storage'
import type { StoreKind } from '@/lib/storage'

/** 도구 레일에 나열되는 도구 id (PRD §9.6 도구 레일 매핑 표의 단축키 순서 그대로).
 *  select~marker 는 격자 도구, pen~shape 는 자유곡선 도구 그룹입니다.
 *  이 단계에서는 도구를 "선택"만 하고, 실제로 캔버스에 무엇을 하는지는 다음 단계에서 구현합니다. */
export type ToolId =
  | 'select' // V 선택
  | 'lineDraw' // L 격자선 긋기
  | 'stamp' // B 타일 배치
  | 'fill' // R 영역 채우기
  | 'eyedropper' // I 스포이드
  | 'eraser' // E 지우개
  | 'text' // T 글자
  | 'marker' // M 출발·도착 마커
  | 'pen' // P 곡선 펜
  | 'freeDraw' // D 자유 그리기
  | 'shape' // O 도형

/** 상단바 저장 상태 칩과 그대로 연결되는 값(components/StatusChip.tsx의 StatusChipStatus와 동일). */
export type SaveState = 'saved' | 'saving' | 'unsaved'

interface EditorState {
  /** 현재 편집 중인 맵. 아직 아무 파일도 없으면 null */
  doc: MapDoc | null
  /** 지금 선택된 도구 */
  activeTool: ToolId
  /** 이 브라우저가 파일에 바로 덮어쓸 수 있는 방식인지(§4.4). 세션 내내 바뀌지 않는 값이라
   *  스토어를 만들 때 한 번만 계산합니다. 상단바 "저장"/"내려받기" 버튼 문구 분기에 씁니다. */
  storeKind: StoreKind
  canOverwrite: boolean
  /** 저장 상태 칩에 표시할 상태 */
  saveState: SaveState

  setTool: (id: ToolId) => void
  setDoc: (doc: MapDoc | null) => void
  setSaveState: (saveState: SaveState) => void
}

// storeKind/canOverwrite는 createMapStore()가 돌려주는 값 중 세션 내내 변하지 않는
// 두 값만 뽑아 쓰는 것이라, 실제 파일 저장에 쓰는 인스턴스를 따로 만들 필요 없이
// 스토어 초기화 시점에 딱 한 번만 확인하면 충분합니다.
const probe = createMapStore()

export const useEditorStore = create<EditorState>()((set) => ({
  doc: null,
  activeTool: 'select',
  storeKind: probe.kind,
  canOverwrite: probe.canOverwrite,
  saveState: 'saved',

  setTool: (id) => set({ activeTool: id }),
  setDoc: (doc) => set({ doc }),
  setSaveState: (saveState) => set({ saveState }),
}))
