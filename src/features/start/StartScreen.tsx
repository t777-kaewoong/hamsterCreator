// 시작 화면 (PRD §9.8).
//
// "목적은 10초 안에 클릭할 것을 찾게 하는 것"(U1) — 그래서 이 화면은 설명 문단을 두지
// 않고, 제목 한 줄 + 부제 한 줄 다음 곧바로 프리셋 카드 그리드로 들어갑니다. 카드를
// 클릭하면 중간에 아무 대화상자도 없이 바로 편집기로 넘어갑니다(NFR-9) — 그 전환은 이
// 컴포넌트가 하지 않고, 부모(App.tsx)가 onOpen(doc) 콜백을 받아 화면을 바꿔줍니다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button, useToast } from '@/components'
import type { MapDoc } from '@/lib/model/types'
import { parseMap } from '@/lib/model/serialize'
import { clearDraft, isDraftAvailable, listDrafts, loadDraft } from '@/lib/storage/draft'
import { loadDraftAssets } from '@/lib/storage/draftAssets'
import type { DraftSummary } from '@/lib/storage/draft'
import { mapStore } from '@/features/editor/editorStore'
import { UserCancelledError } from '@/lib/storage'
import { START_PRESETS } from './presets'
import { renderMapThumbnail } from './thumbnail'
import { tileBitmapCache } from '@/features/canvas/tileBitmaps'
import styles from './StartScreen.module.css'

/** 프리셋 카드 썸네일을 렌더할 캔버스 CSS 크기. 카드 2장이 720px 안에 나란히 놓이므로
 *  (간격 24px) 카드 폭은 약 348px, 썸네일 영역 높이는 180px입니다(docs/14 §2.1).
 *  <img>가 object-fit: contain이라 비율만 맞으면 깨끗하게 보입니다. */
const THUMB_CSS_W = 312
const THUMB_CSS_H = 160

/** 출처 표기(docs/14 §2.1). 햄스터S 사진·말판 자료는 햄스터스쿨 튜토리얼 자료를 참고했습니다. */
const SOURCE_URL = 'https://hamster.school/ko/tutorial/'

export interface StartScreenProps {
  /** 프리셋 클릭 / 파일 열기 / 초안 복구로 문서가 정해졌을 때 호출됩니다.
   *  이 콜백을 받은 쪽(App.tsx)이 편집기 화면으로 전환합니다.
   *  fromDraftId를 넘기면 "그 초안 슬롯을 이어서 쓴다"는 뜻입니다(초안 복구 경로 전용). */
  onOpen: (doc: MapDoc, fromDraftId?: string) => void
}

export default function StartScreen({ onOpen }: StartScreenProps) {
  const { show: showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [latestDraft, setLatestDraft] = useState<DraftSummary | null>(null)

  const buildThumbnails = useCallback(() => {
    const map = new Map<string, string>()
    for (const preset of START_PRESETS) {
      map.set(preset.id, renderMapThumbnail(preset.create(), THUMB_CSS_W, THUMB_CSS_H))
    }
    return map
  }, [])
  const [thumbnails, setThumbnails] = useState(buildThumbnails)

  // 교과서 프리셋의 아이콘 비트맵이 비동기로 준비되면 한 프레임에 묶어 썸네일을 다시
  // 그립니다. 그렇지 않으면 새로고침 직후 아이콘이 빠진 이미지만 계속 남습니다.
  useEffect(() => {
    let frame: number | null = null
    const unsubscribe = tileBitmapCache.onLoad(() => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        setThumbnails(buildThumbnails())
      })
    })
    return () => {
      unsubscribe()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [buildThumbnails])

  // 초안 복구 배너(§9.16). isDraftAvailable()이 false면 대피로(file://) 빌드처럼
  // localStorage 자체를 못 쓰는 환경이라 listDrafts()를 불러봐야 항상 빈 배열이므로
  // 아예 조회하지 않습니다(draft.ts 주석과 같은 이유).
  useEffect(() => {
    if (!isDraftAvailable()) return
    // 초안이 여러 개(최근 5개까지)여도 배너에는 가장 최근 것 하나만 보여줍니다. 이 화면의
    // 목적은 "10초 안에 하나를 고르는 것"인데, 초안을 여러 줄로 나열하면 정작 프리셋
    // 카드로 눈이 가는 걸 방해합니다. 나머지 오래된 초안은 언급하지 않아도, 다음에 그
    // 초안 슬롯이 다시 최신이 되지 않는 한 자연스럽게 잊혀집니다.
    setLatestDraft(listDrafts()[0] ?? null)
  }, [])

  async function handleRecoverDraft() {
    if (!latestDraft) return
    const loaded = loadDraft(latestDraft.id)
    // 초안의 사용자 이미지는 IndexedDB에 따로 있습니다(draftAssets.ts). 함께 붙여야 칸에 놓인
    // 그림이 비지 않고, 다음에 올리는 이미지가 기존 번호를 덮어쓰지 않습니다.
    const doc = loaded ? { ...loaded, userAssets: await loadDraftAssets(latestDraft.id) } : null
    if (!doc) {
      // 배너를 보여준 시점과 복구를 누른 시점 사이에 초안이 지워졌거나 손상됐을 때만
      // 일어나는 드문 경우입니다.
      showToast({ message: '초안을 불러오지 못했습니다.', tone: 'danger' })
      setLatestDraft(null)
      return
    }
    // 복구한 초안은 원래 슬롯을 그대로 이어 씁니다 — 복구할 때마다 슬롯이 늘어나면
    // 최근 5개 자리를 스스로 밀어내서 다른 초안이 사라집니다(draft.ts 주석 참고).
    onOpen(doc, latestDraft.id)
  }

  function handleDiscardDraft() {
    if (!latestDraft) return
    clearDraft(latestDraft.id)
    setLatestDraft(null)
  }

  /**
   * 파일 열기.
   *
   * [왜 <input type="file">이 아니라 저장소를 먼저 쓰는가]
   * File System Access API를 쓸 수 있는 브라우저(크롬·엣지)에서는 mapStore.open()으로
   * 열어야 그 파일의 핸들이 저장소 안에 남습니다. 그래야 나중에 "저장"이 대화상자 없이
   * 바로 그 파일에 덮어써집니다(FR-1.4). <input type="file">로 열면 내용만 읽고 핸들이
   * 없어서, 편집 후 저장할 때마다 위치를 다시 골라야 합니다.
   * 지원하지 않는 브라우저에서는 기존 <input type="file">로 그대로 내려갑니다.
   */
  async function openFilePicker() {
    if (!mapStore.canOverwrite) {
      fileInputRef.current?.click()
      return
    }
    try {
      const doc = await mapStore.open()
      onOpen(doc)
    } catch (err) {
      // 대화상자를 그냥 닫은 것은 실패가 아니라 취소입니다 — 아무것도 알리지 않습니다.
      if (err instanceof UserCancelledError) return
      const message = err instanceof Error ? err.message : '파일을 열지 못했습니다.'
      showToast({ message, tone: 'danger' })
    }
  }

  async function handleFile(file: File) {
    const text = await file.text()
    const result = parseMap(text)
    if (!result.ok) {
      // §9.16: "파일 열기 실패 → 모달이 아닌 토스트 + 사유 한 줄"
      showToast({ message: result.error, tone: 'danger' })
      return
    }
    onOpen(result.doc)
  }

  // FR-1.3 "창 어디에 놓아도 열리게" — 드롭존 element 하나에만 dragover/drop을 걸면 창의
  // 다른 부분(제목·프리셋 카드 위 등)에 놓았을 때 브라우저가 파일을 그냥 열어버립니다.
  // 그래서 window 전체에 걸어두고, 기본 동작은 반드시 preventDefault로 막습니다.
  useEffect(() => {
    function handleWindowDragOver(e: DragEvent) {
      e.preventDefault()
      // 텍스트를 드래그하는 것과 파일을 드래그하는 것을 구분합니다 — 텍스트 드래그에도
      // 매번 반응해 드롭존을 강조하면 산만합니다.
      if (e.dataTransfer?.types.includes('Files')) setDragActive(true)
    }
    function handleWindowDragLeave(e: DragEvent) {
      // relatedTarget이 null이면 마우스가 브라우저 창(문서) 밖으로 완전히 나간 것입니다.
      // 자식 요소 사이를 옮겨 다닐 때도 dragleave가 발생하므로 이 조건이 꼭 필요합니다.
      if (!e.relatedTarget) setDragActive(false)
    }
    function handleWindowDrop(e: DragEvent) {
      e.preventDefault() // 막지 않으면 브라우저가 파일을 새 탭으로 열어버립니다.
      setDragActive(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) void handleFile(file)
    }
    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('dragleave', handleWindowDragLeave)
    window.addEventListener('drop', handleWindowDrop)
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('dragleave', handleWindowDragLeave)
      window.removeEventListener('drop', handleWindowDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`${styles.root} ${dragActive ? styles.rootDragActive : ''}`}>
      {latestDraft && (
        <div className={styles.draftBanner} role="status">
          <span className={styles.draftText}>
            저장하지 않은 초안이 있습니다 — <strong>{latestDraft.title}</strong>
          </span>
          <div className={styles.draftActions}>
            <Button variant="secondary" size="sm" onClick={handleRecoverDraft}>
              복구
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDiscardDraft}>
              버리기
            </Button>
          </div>
        </div>
      )}

      <main className={styles.content}>
        {/* 애플 제품 페이지처럼 큰 제목 한 줄 + 넓은 여백 + 큰 카드 두 장(docs/14 §2.1).
            부제는 후기 11차에서 뺐습니다 — 카드 그림만 봐도 무엇을 고르는지 알 수 있습니다. */}
        <h1 className={styles.title}>햄스터S 말판 만들기</h1>

        <div className={styles.presetGrid}>
          {START_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={styles.presetCard}
              onClick={() => onOpen(preset.create())}
            >
              <div className={styles.presetThumb}>
                <img src={thumbnails.get(preset.id)} alt="" className={styles.presetThumbImg} />
              </div>
              <div className={styles.presetInfo}>
                <span className={styles.presetName}>{preset.name}</span>
                <span className={styles.presetSpec}>{preset.specLabel}</span>
              </div>
            </button>
          ))}
        </div>

        {/* 파일 열기. 끌어 놓기는 창 전체(위 window 이벤트)에서 받으므로, 여기에는 커다란 점선
            상자 대신 버튼 하나와 작은 안내만 둡니다. 드래그가 서툰 사용자는 버튼을 누르면 됩니다. */}
        <div className={styles.openArea}>
          <button type="button" className={styles.openButton} onClick={() => void openFilePicker()}>
            <FolderOpen size={18} aria-hidden="true" />
            말판 파일 열기
          </button>
          <span className={styles.openHint}>또는 .hsmap.json 파일을 창에 끌어 놓기</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className={styles.hiddenFileInput}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = '' // 같은 파일을 다시 골라도 onChange가 또 발생하도록 비움
          }}
        />

        {/*
          최근 파일 목록(§9.8 항목 5)은 만들지 않았습니다. 이 앱에는 DB나 서버 저장소가
          없어서 "최근에 연 파일이 무엇인지" 실제로 기록할 수단이 없습니다. PRD §9.15의
          "최근 파일 없음 → 해당 영역 자체를 숨김" 규칙을 그대로 적용했습니다.
        */}
      </main>

      <footer className={styles.footer}>
        햄스터S 자료 출처:{' '}
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          햄스터스쿨(hamster.school) 튜토리얼
        </a>
        {' · '}일부 그림은 AI로 생성했습니다
      </footer>
    </div>
  )
}
