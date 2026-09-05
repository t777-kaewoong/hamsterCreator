// 앱 최상위 화면 전환.
// 기본은 편집기(EditorLayout)를 보여주고, 주소 뒤에 ?catalog 를 붙이면 개발용
// 컴포넌트 카탈로그(CatalogPage)를 보여줍니다. 실제 수업에서 쓰는 화면은 편집기뿐이고,
// 카탈로그는 토큰·컴포넌트가 PRD 수치대로 나왔는지 확인할 때만 켜보는 개발자용 화면입니다.
//
// 아직 시작 화면(§9.8, 프리셋 카드로 새 맵을 고르는 화면)이 없어서, 이 단계에서는
// 편집기에 들어오자마자 5×4 전체 격자 맵을 하나 만들어 바로 편집기 스토어에 넣어둡니다.
// 시작 화면은 PRD §9.18 순서상 뒤에(7번) 만들 예정입니다.
import { useEffect, useState } from 'react'
import { DEFAULT_COLS, DEFAULT_ROWS } from '@/lib/model/constants'
import { createFullGridMap } from '@/lib/model/factory'
import { useEditorStore } from '@/features/editor/editorStore'
import EditorLayout from '@/features/editor/EditorLayout'
import CatalogPage from '@/features/catalog/CatalogPage'

function isCatalogRoute(): boolean {
  return new URLSearchParams(window.location.search).has('catalog')
}

export default function App() {
  // 최초 렌더 시점 한 번만 주소를 확인합니다. 편집기 화면 안에서 카탈로그로 왔다갔다 할 때는
  // (EditorLayout의 개발용 링크) 그냥 페이지를 다시 불러오므로 이 값이 다시 계산됩니다.
  const [showCatalog] = useState(isCatalogRoute)
  const doc = useEditorStore((s) => s.doc)
  const setDoc = useEditorStore((s) => s.setDoc)

  useEffect(() => {
    if (!doc) {
      setDoc(createFullGridMap(DEFAULT_COLS, DEFAULT_ROWS, { title: '새 말판' }))
    }
  }, [doc, setDoc])

  if (showCatalog) return <CatalogPage />
  return <EditorLayout />
}
