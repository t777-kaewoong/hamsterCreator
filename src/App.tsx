// 앱 최상위 화면 전환.
// 주소 뒤에 ?catalog 를 붙이면 개발용 컴포넌트 카탈로그(CatalogPage)를 보여줍니다.
// 그 외에는 시작 화면(§9.8) ↔ 편집기 두 화면을 로컬 useState로 오갑니다.
//
// [왜 editorStore가 아니라 여기 로컬 useState인가] 편집기 스토어(editorStore.ts)는
// 다른 작업자가 이 작업과 동시에 손대고 있어서, "지금 어느 화면인가" 같은 이 작업만의
// 상태를 그 파일에 얹으면 서로의 변경이 충돌합니다. 화면 전환은 App 컴포넌트 하나에서만
// 쓰는 값이라 굳이 전역 스토어에 둘 이유도 없습니다 — useState로 충분합니다.
import { Suspense, lazy, useEffect, useState } from 'react'
import { useEditorStore } from '@/features/editor/editorStore'
import { adoptDraftSession, beginDraftSession, flushDraft } from '@/lib/storage/draft'
import EditorLayout from '@/features/editor/EditorLayout'
import StartScreen from '@/features/start/StartScreen'
// 개발용 컴포넌트 카탈로그는 lazy로 따로 떼어냅니다.
// 정적으로 import하면 배포 번들 안에 카탈로그 화면 코드가 통째로 들어가서,
// 아무도 열 수 없는 화면 때문에 첫 로딩 용량만 늘어납니다(NFR-2).
// lazy는 별도 파일로 나뉘어, 실제로 ?catalog 를 열 때만 내려받습니다.
const CatalogPage = lazy(() => import('@/features/catalog/CatalogPage'))
import type { MapDoc } from '@/lib/model/types'

/** 주소에 ?catalog 가 붙었는지. 개발 빌드에서만 참이 될 수 있습니다 —
 *  배포본에서는 주소를 직접 쳐도 카탈로그가 열리지 않습니다(개발자용 화면이라). */
function isCatalogRoute(): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(window.location.search).has('catalog')
}

type Screen = 'start' | 'editor'

export default function App() {
  // 최초 렌더 시점 한 번만 주소를 확인합니다. 편집기 화면 안에서 카탈로그로 왔다갔다 할 때는
  // (EditorLayout의 개발용 링크) 그냥 페이지를 다시 불러오므로 이 값이 다시 계산됩니다.
  const [showCatalog] = useState(isCatalogRoute)
  // 처음 앱을 열면 항상 시작 화면부터 봅니다(PRD §9.8 "10초 안에 클릭할 것을 찾게 하는 것").
  const [screen, setScreen] = useState<Screen>('start')
  const setDoc = useEditorStore((s) => s.setDoc)
  const setSaveState = useEditorStore((s) => s.setSaveState)

  // 프리셋 클릭 / 파일 열기 / 초안 복구, 세 경로 전부 결국 "문서 하나가 정해졌다"는
  // 같은 사건이라 하나의 함수로 묶었습니다. StartScreen은 이 함수만 알고, 그 뒤에 어떤
  // 화면이 뜨는지는 신경 쓰지 않습니다(onOpen 콜백 하나로 완전히 분리).
  //
  // fromDraftId는 "초안 복구로 연 경우" 그 초안의 id입니다. 복구한 초안은 원래 슬롯을
  // 그대로 이어 쓰고(adopt), 나머지 경로(프리셋·파일)는 새 슬롯을 땁니다(begin).
  // 이렇게 갈라 놓지 않으면 맵을 갈아탈 때 앞 맵의 초안이 덮어써집니다(draft.ts 주석 참고).
  function openDoc(doc: MapDoc, fromDraftId?: string) {
    if (fromDraftId) adoptDraftSession(fromDraftId)
    else beginDraftSession()
    // 새로 연 문서는 아직 아무것도 고치지 않은 상태입니다. 직전 문서의 "저장 안 됨"이
    // 그대로 남아 있으면, 손대지도 않은 맵에서 뒤로가기 경고가 뜹니다.
    setSaveState('saved')
    setDoc(doc)
    setScreen('editor')
  }

  function backToStart() {
    // 편집기를 떠나도 방금까지의 내용은 초안으로 남아 있어야 합니다. 디바운스 대기 중인
    // 마지막 편집이 있으면 여기서 흘려보냅니다.
    flushDraft()
    setScreen('start')
  }

  // NFR-5 / FR-1.8 — 탭 닫기·새로고침 이탈 경고.
  // 앱 안의 뒤로가기는 TopBar가 확인 모달로 막지만, 브라우저 탭을 닫거나 F5를 누르는 건
  // 그 모달을 거치지 않습니다. 저장 안 된 변경이 있을 때만 브라우저 기본 경고를 띄웁니다.
  // (경고 문구는 브라우저가 정하며 웹페이지가 바꿀 수 없습니다 — preventDefault만이 규격입니다.)
  // 떠나는 김에 대기 중인 초안도 반드시 반영합니다. 사용자가 "나가기"를 골라도 복구할
  // 거리는 남겨두기 위해서입니다.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      flushDraft()
      if (useEditorStore.getState().saveState !== 'unsaved') return
      e.preventDefault()
      // 일부 구형 브라우저는 returnValue가 비어 있으면 경고를 건너뜁니다.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  if (showCatalog) {
    return (
      <Suspense fallback={null}>
        <CatalogPage />
      </Suspense>
    )
  }
  if (screen === 'start') return <StartScreen onOpen={openDoc} />
  return <EditorLayout onBack={backToStart} />
}
