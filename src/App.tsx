// 앱 최상위 화면 전환.
// 주소 뒤에 ?catalog 를 붙이면 개발용 컴포넌트 카탈로그(CatalogPage)를 보여줍니다.
// 그 외에는 시작 화면(§9.8) ↔ 편집기 두 화면을 로컬 useState로 오갑니다.
//
// [왜 editorStore가 아니라 여기 로컬 useState인가] 편집기 스토어(editorStore.ts)는
// 다른 작업자가 이 작업과 동시에 손대고 있어서, "지금 어느 화면인가" 같은 이 작업만의
// 상태를 그 파일에 얹으면 서로의 변경이 충돌합니다. 화면 전환은 App 컴포넌트 하나에서만
// 쓰는 값이라 굳이 전역 스토어에 둘 이유도 없습니다 — useState로 충분합니다.
import { useState } from 'react'
import { useEditorStore } from '@/features/editor/editorStore'
import EditorLayout from '@/features/editor/EditorLayout'
import StartScreen from '@/features/start/StartScreen'
import CatalogPage from '@/features/catalog/CatalogPage'
import type { MapDoc } from '@/lib/model/types'

function isCatalogRoute(): boolean {
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

  // 프리셋 클릭 / 파일 열기 / 초안 복구, 세 경로 전부 결국 "문서 하나가 정해졌다"는
  // 같은 사건이라 하나의 함수로 묶었습니다. StartScreen은 이 함수만 알고, 그 뒤에 어떤
  // 화면이 뜨는지는 신경 쓰지 않습니다(onOpen 콜백 하나로 완전히 분리).
  function openDoc(doc: MapDoc) {
    setDoc(doc)
    setScreen('editor')
  }

  function backToStart() {
    setScreen('start')
  }

  if (showCatalog) return <CatalogPage />
  if (screen === 'start') return <StartScreen onOpen={openDoc} />
  return <EditorLayout onBack={backToStart} />
}
