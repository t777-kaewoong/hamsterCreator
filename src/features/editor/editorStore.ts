// 편집기 전역 상태 스토어 (Zustand).
//
// 상단바·도구 레일·캔버스·인스펙터는 화면에서 서로 멀리 떨어져 있지만 모두
// "지금 열린 맵 문서"와 "지금 선택된 도구"를 함께 봐야 합니다. props로 한 단계씩
// 내려주면 중간 컴포넌트들이 쓰지도 않는 값을 계속 넘겨야 해서 코드가 지저분해지므로,
// 이 스토어 하나에 모아두고 필요한 컴포넌트가 바로 꺼내 씁니다.
//
// M1-4(도구 동작)에서 실행취소·재실행 스택과 스탬프 방향(회전·반전) 상태가 추가됐습니다.
// 실제로 스택에 스냅샷을 쌓는 로직은 src/features/canvas/toolInteractions.ts가
// 제스처(드래그 등) 단위로 호출합니다 — 이 파일은 "스택을 어떻게 조작하는지"만 압니다.
import { create } from 'zustand'
import type { MapDoc, UserAsset } from '@/lib/model/types'
import { createMapStore } from '@/lib/storage'
import type { StoreKind } from '@/lib/storage'
import { saveDraft } from '@/lib/storage/draft'

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

/**
 * 실행취소 스택 최대 길이(FR-3.12: "최소 50단계").
 *
 * [메모리 근거] 스냅샷 방식이라 스택 한 칸마다 MapDoc 전체를 깊은 복사해 담습니다. 이
 * 앱이 다루는 맵 문서는 보통 25KB 안팎(A4 5×4칸부터 A0 23×16칸 규모까지 다뤄도 텍스트
 * JSON이라 크게 늘지 않음)이라, 50칸을 전부 채워도 25KB × 50 ≈ 1~2MB입니다. 브라우저
 * 탭 하나가 이미지 몇 장만 열어도 쓰는 메모리에 비하면 무시할 만한 크기라, 셀 단위
 * diff처럼 더 복잡한 구조를 만들 필요 없이 "그냥 통째로 복사해 쌓기"로 충분합니다.
 */
export const MAX_UNDO_STACK = 50

/** V(선택) 도구가 지금 고른 대상 하나를 가리킵니다. 이번 단계(M1-4)는 프롭·라벨·곡선을
 *  실제로 만드는 도구가 아직 없어서 selection은 항상 null이고, 이 타입은 나중에 인스펙터
 *  "선택 항목" 섹션(§9.13: 타일/프롭/라벨/곡선)을 만들 때 채워 넣을 자리만 미리 잡아둔
 *  것입니다(작업 지시: "이번 단계에서는 코드 구조만 잡아두세요"). */
export type Selection =
  | { kind: 'cell'; index: number }
  | { kind: 'prop'; id: string }
  | { kind: 'label'; id: string }
  | { kind: 'stroke'; id: string }
  | null

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

  // ── 실행취소·재실행(FR-3.12) ────────────────────────────────────────
  /** 실행취소 스택. 배열 끝(마지막 항목)이 "가장 최근에 저장된, 되돌아갈 이전 상태"입니다.
   *  toolInteractions.ts가 제스처 하나가 끝날 때(그리고 실제로 문서가 바뀌었을 때만)
   *  그 제스처 시작 시점의 스냅샷을 여기에 넣습니다. */
  undoStack: MapDoc[]
  /** 재실행 스택. undo()가 지금 문서를 여기로 옮기고, redo()가 다시 꺼내 씁니다.
   *  pushUndoSnapshot(=새 편집)이 일어나면 통째로 비웁니다("되돌린 걸 다시 편집하면
   *  그 이후의 재실행은 더 이상 의미가 없다"는 일반적인 실행취소 규칙). */
  redoStack: MapDoc[]

  // ── 스탬프 방향(FR-3.4) ──────────────────────────────────────────────
  /** 지금 스탬프의 회전(도). 팔레트에서 고른 타일 id 자체가 아니라 "그 타일을 어느
   *  방향으로 찍을지"를 따로 들고 있어서, 타일 배치(B)·영역 채우기(R) 두 도구가 같은
   *  방향 상태를 공유합니다. */
  stampRot: 0 | 90 | 180 | 270
  /** 지금 스탬프의 좌우 반전 여부. */
  stampFlip: boolean

  /** V(선택) 도구가 고른 대상. 구조만 미리 마련한 상태라 이번 단계는 항상 null입니다. */
  selection: Selection

  // ── 팔레트 패널(§9.11)이 쓰는 상태 ──────────────────────────────────
  /** 팔레트에서 지금 열려 있는 테마 탭. 'dungeon'~'dino' 6종 + 'icon' · 'track' · 'myImages' */
  activeTheme: string
  /** 팔레트 검색어. 비어있지 않으면 테마 탭을 무시하고 전체 타일을 이름으로 필터링합니다 */
  paletteQuery: string
  /** 지금 스탬프로 선택된 타일/아이콘/내 이미지의 id. 캔버스 타일 도구가 이 값을 찍습니다.
   *  내장 타일·아이콘은 원래 id 그대로, 사용자 이미지는 "asset:u1"처럼 userAssets 키에
   *  "asset:" 접두어를 붙인 값입니다(types.ts의 Cell.art/Prop.asset 참조 규칙과 동일). */
  stampTileId: string | null

  setTool: (id: ToolId) => void
  setDoc: (doc: MapDoc | null) => void
  setSaveState: (saveState: SaveState) => void

  /** 제스처 시작 시점의 스냅샷을 실행취소 스택에 넣습니다(MAX_UNDO_STACK 넘으면 가장
   *  오래된 것부터 버림). 재실행 스택은 항상 함께 비웁니다. toolInteractions.ts 전용 —
   *  "정말 바뀐 게 있을 때만" 불러야 하는 판단은 호출부 책임입니다. */
  pushUndoSnapshot: (snapshot: MapDoc) => void
  /** 상단바 Undo2 버튼·Ctrl+Z. 스택이 비어 있으면 아무 일도 하지 않습니다. */
  undo: () => void
  /** 상단바 Redo2 버튼·Ctrl+Shift+Z. */
  redo: () => void
  /** 스탬프를 시계방향 90도 돌립니다(R 키, FR-3.4). 360도에서 다시 0도로 순환합니다. */
  rotateStamp: () => void
  /** 스탬프 좌우 반전을 토글합니다(F 키, FR-3.4). */
  flipStamp: () => void
  /** 스포이드(I)가 집어온 타일의 방향을 그대로 스탬프 방향에 반영할 때 씁니다. */
  setStampOrientation: (rot: 0 | 90 | 180 | 270, flip: boolean) => void
  setSelection: (selection: Selection) => void

  setActiveTheme: (theme: string) => void
  setPaletteQuery: (query: string) => void
  /**
   * 타일/아이콘/내 이미지를 스탬프로 선택합니다.
   *
   * [왜 도구까지 같이 바꾸는가] PRD §9.11: "타일 클릭 = 스탬프 모드 진입. 동시에 도구가
   * 자동으로 타일(B)로 전환됩니다. 사용자가 도구를 먼저 고르게 강요하지 않습니다."
   * 팔레트에서 그림을 고르는 행위 자체가 "이제 이걸 찍겠다"는 의도이므로, 도구 레일에서
   * 따로 B를 누르게 하지 않고 여기서 activeTool을 함께 바꿔줍니다.
   */
  setStampTile: (id: string | null) => void
  /** 업로드한 이미지를 doc.userAssets에 추가하고, 생성된 키("u1" 등)를 돌려줍니다.
   *  아직 열린 맵이 없으면(doc이 null) 아무 것도 하지 않고 null을 돌려줍니다. */
  addUserAsset: (asset: UserAsset) => string | null
}

// storeKind/canOverwrite는 createMapStore()가 돌려주는 값 중 세션 내내 변하지 않는
// 두 값만 뽑아 쓰는 것이라, 실제 파일 저장에 쓰는 인스턴스를 따로 만들 필요 없이
// 스토어 초기화 시점에 딱 한 번만 확인하면 충분합니다.
const probe = createMapStore()

export const useEditorStore = create<EditorState>()((set, get) => ({
  doc: null,
  activeTool: 'select',
  storeKind: probe.kind,
  canOverwrite: probe.canOverwrite,
  saveState: 'saved',
  activeTheme: 'dungeon',
  paletteQuery: '',
  stampTileId: null,
  undoStack: [],
  redoStack: [],
  stampRot: 0,
  stampFlip: false,
  selection: null,

  setTool: (id) => set({ activeTool: id }),
  setDoc: (doc) => set({ doc }),
  setSaveState: (saveState) => set({ saveState }),

  pushUndoSnapshot: (snapshot) =>
    set((state) => {
      const next = [...state.undoStack, snapshot]
      if (next.length > MAX_UNDO_STACK) next.shift() // 50개 넘으면 가장 오래된 것부터 버림
      return { undoStack: next, redoStack: [] } // 새 편집이 일어났으니 재실행 스택은 비움
    }),

  undo: () => {
    const state = get()
    if (state.undoStack.length === 0 || !state.doc) return
    const prev = state.undoStack[state.undoStack.length - 1]
    const current = state.doc
    set({
      doc: prev,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, current],
      saveState: 'unsaved',
    })
    saveDraft(prev)
  },

  redo: () => {
    const state = get()
    if (state.redoStack.length === 0 || !state.doc) return
    const next = state.redoStack[state.redoStack.length - 1]
    const current = state.doc
    set({
      doc: next,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, current],
      saveState: 'unsaved',
    })
    saveDraft(next)
  },

  rotateStamp: () => set((state) => ({ stampRot: (((state.stampRot + 90) % 360) as 0 | 90 | 180 | 270) })),
  flipStamp: () => set((state) => ({ stampFlip: !state.stampFlip })),
  setStampOrientation: (rot, flip) => set({ stampRot: rot, stampFlip: flip }),
  setSelection: (selection) => set({ selection }),

  setActiveTheme: (theme) => set({ activeTheme: theme }),
  setPaletteQuery: (query) => set({ paletteQuery: query }),
  // 새 타일을 고르면 방향도 기본값(0도·반전 없음)으로 되돌립니다 — 직전 타일의 회전
  // 상태가 다음 타일에도 그대로 남아있으면 "왜 삐딱하게 찍히지?"로 헷갈리기 쉽습니다.
  setStampTile: (id) => set({ stampTileId: id, activeTool: 'stamp', stampRot: 0, stampFlip: false }),

  addUserAsset: (asset) => {
    const doc = get().doc
    if (!doc) return null
    // "u1"부터 시작해 비어있는 번호를 찾습니다. 파일을 열고 닫는 동안 삭제된 번호가
    // 있을 수 있어 항상 개수+1이 아니라 실제로 안 쓰인 번호를 찾습니다.
    let n = 1
    while (doc.userAssets[`u${n}`]) n += 1
    const key = `u${n}`
    set({ doc: { ...doc, userAssets: { ...doc.userAssets, [key]: asset } } })
    return key
  },
}))
