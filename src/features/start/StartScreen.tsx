// 시작 화면 (PRD §9.8).
//
// "목적은 10초 안에 클릭할 것을 찾게 하는 것"(U1) — 그래서 이 화면은 설명 문단을 두지
// 않고, 제목 한 줄 + 부제 한 줄 다음 곧바로 프리셋 카드 그리드로 들어갑니다. 카드를
// 클릭하면 중간에 아무 대화상자도 없이 바로 편집기로 넘어갑니다(NFR-9) — 그 전환은 이
// 컴포넌트가 하지 않고, 부모(App.tsx)가 onOpen(doc) 콜백을 받아 화면을 바꿔줍니다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button, useToast } from '@/components'
import type { MapDoc } from '@/lib/model/types'
import { parseMap } from '@/lib/model/serialize'
import { clearDraft, isDraftAvailable, listDrafts, loadDraft } from '@/lib/storage/draft'
import type { DraftSummary } from '@/lib/storage/draft'
import { START_PRESETS } from './presets'
import { renderMapThumbnail } from './thumbnail'
import styles from './StartScreen.module.css'

/** 프리셋 카드 썸네일을 렌더할 캔버스 CSS 크기. 카드 자체의 실제 폭은 화면 폭에 따라
 *  1fr로 늘었다 줄었다 하지만(최대 960px 안에서 4등분), <img>가 object-fit: contain으로
 *  담기므로 렌더 해상도가 카드의 정확한 실측 폭과 1px도 안 맞아도 비율만 맞으면 깨끗하게
 *  보입니다. 카드 하나의 대략적인 폭(960px 4등분, 16px 간격 3개)에 맞춰 224px로 잡았습니다. */
const THUMB_CSS_W = 224
const THUMB_CSS_H = 112

export interface StartScreenProps {
  /** 프리셋 클릭 / 파일 열기 / 초안 복구로 문서가 정해졌을 때 호출됩니다.
   *  이 콜백을 받은 쪽(App.tsx)이 편집기 화면으로 전환합니다. */
  onOpen: (doc: MapDoc) => void
}

export default function StartScreen({ onOpen }: StartScreenProps) {
  const { show: showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [latestDraft, setLatestDraft] = useState<DraftSummary | null>(null)

  // 프리셋 썸네일은 실제로 캔버스에 그리는 비용이 있으므로, 화면이 떠 있는 동안 딱 한 번만
  // 만들고 재사용합니다. START_PRESETS는 이 파일 밖의 모듈 상수라 다시 바뀌지 않으므로
  // 의존성 배열을 비워둬도 안전합니다.
  const thumbnails = useMemo(() => {
    const map = new Map<string, string>()
    for (const preset of START_PRESETS) {
      map.set(preset.id, renderMapThumbnail(preset.create(), THUMB_CSS_W, THUMB_CSS_H))
    }
    return map
  }, [])

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

  function handleRecoverDraft() {
    if (!latestDraft) return
    const doc = loadDraft(latestDraft.id)
    if (!doc) {
      // 배너를 보여준 시점과 복구를 누른 시점 사이에 초안이 지워졌거나 손상됐을 때만
      // 일어나는 드문 경우입니다.
      showToast({ message: '초안을 불러오지 못했습니다.', tone: 'danger' })
      setLatestDraft(null)
      return
    }
    onOpen(doc)
  }

  function handleDiscardDraft() {
    if (!latestDraft) return
    clearDraft(latestDraft.id)
    setLatestDraft(null)
  }

  function openFilePicker() {
    fileInputRef.current?.click()
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
    <div className={styles.root}>
      {latestDraft && (
        <div className={styles.draftBanner} role="status">
          <span className="t-body">
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

      <div className={styles.content}>
        <h1 className={`${styles.title} t-display`}>햄스터S 말판 만들기</h1>
        <p className={`${styles.subtitle} t-body`}>프리셋을 고르거나 파일을 열어 바로 시작하세요</p>

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
                <span className={`${styles.presetName} t-label`}>
                  {preset.name}
                  {preset.isDefault && <span className={`${styles.defaultBadge} t-micro`}>★기본</span>}
                </span>
                <span className={`${styles.presetSpec} t-micro`}>{preset.specLabel}</span>
              </div>
            </button>
          ))}
        </div>

        {/* 드롭존. 실제 드래그 앤 드롭은 위 window 이벤트가 처리하고, 이 버튼 자체는
            "드래그를 모르는 사용자"를 위해 클릭하면 같은 파일 선택 대화상자를 엽니다
            (마우스 드래그가 서툰 학생·저경력 사용자가 실제로 존재하므로). <button>으로
            만들어 reset.css의 :focus-visible 링을 그대로 물려받고 Enter/Space로도
            열리게 합니다. */}
        <button
          type="button"
          className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ''}`}
          onClick={openFilePicker}
        >
          <Upload size={24} />
          <span className="t-body">.hsmap.json 파일을 여기에 놓기</span>
        </button>

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
          없어서(§4 "DB 없음") "최근에 연 파일이 무엇인지" 실제로 기록할 수단이 없습니다
          (파일시스템 접근 권한을 매번 새로 받아야 하는 브라우저 보안 모델 때문에, 파일
          경로만 기억해뒀다가 다음에 자동으로 다시 열 수도 없습니다). 있지도 않은 이력을
          빈 상태로 보여주거나 꾸며낼 수는 없으므로, PRD §9.15의 "최근 파일 없음 → 해당
          영역 자체를 숨김" 규칙을 그대로 적용해 이 영역을 아예 만들지 않았습니다.
        */}
      </div>
    </div>
  )
}
