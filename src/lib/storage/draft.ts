// 초안 자동 저장(PRD §4.3).
//
// 편집 중 500ms 동안 추가 입력이 없으면 localStorage에 지금 맵 상태를 저장해둡니다. 앱을
// 다시 열었을 때 브라우저가 갑자기 닫혔거나 저장을 깜빡한 경우 복구할 수 있게 하기 위해서입니다.
// "이번 실행(세션)"마다 초안 하나를 계속 덮어쓰고, 최근 5번의 실행분까지만 남겨둡니다.
//
// userAssets를 초안에서 빼는 이유: localStorage는 브라우저마다 다르지만 보통 도메인당
// 약 5MB로 한도가 작습니다(PRD §4.3). 사용자 이미지는 base64라 원본보다 커지고 여러 장이면
// 금방 한도를 넘기므로, 초안에는 "구조"만 담고 이미지는 뺍니다. 그래서 초안을 복구하면
// 이미지 자리는 비어 있을 수 있고, 사용자가 다시 첨부해야 할 수 있습니다 — 정식 저장(파일)에는
// 항상 이미지가 그대로 들어갑니다.
import type { MapDoc } from '../model/types'

const STORAGE_KEY = 'hamsterS.drafts.v1'
const MAX_DRAFTS = 5
const DEBOUNCE_MS = 500

/** userAssets를 뺀 맵 문서. 초안에 실제로 저장되는 모양입니다. */
type DraftDoc = Omit<MapDoc, 'userAssets'>

interface DraftRecord {
  id: string
  title: string
  updatedAt: string
  doc: DraftDoc
}

/** listDrafts()가 돌려주는 가벼운 요약 정보(전체 문서를 다 읽지 않아도 목록을 보여줄 수 있게). */
export interface DraftSummary {
  id: string
  title: string
  updatedAt: string
}

// 이번 브라우저 실행(페이지가 로드된 이후) 동안 계속 같은 초안 슬롯에 덮어쓰기 위한 id.
// 모듈이 다시 로드되면(새로고침·재실행) 새 id가 생기고, 이전 실행의 초안은 목록에 그대로 남습니다.
let sessionDraftId: string | null = null
function getSessionDraftId(): string {
  if (!sessionDraftId) {
    sessionDraftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  return sessionDraftId
}

let debounceTimer: number | undefined

/**
 * 지금 맵 상태를 초안으로 저장 예약합니다. 500ms 안에 또 부르면 이전 예약은 취소되고
 * 다시 500ms를 기다립니다(디바운스) — 매 키 입력마다 localStorage에 쓰지 않기 위해서입니다.
 *
 * 반환값은 이번 실행의 초안 id입니다. 실제 쓰기는 나중에(디바운스 이후) 일어나지만,
 * id는 즉시 정해지므로 명시적으로 저장을 마친 뒤 clearDraft(id)를 부를 때 바로 쓸 수 있습니다.
 */
export function saveDraft(doc: MapDoc): string {
  const id = getSessionDraftId()
  if (typeof window === 'undefined') return id

  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    debounceTimer = undefined
    persistNow(id, doc)
  }, DEBOUNCE_MS)

  return id
}

/** 저장된 초안 목록을 최신순으로 돌려줍니다. localStorage를 못 쓰면 빈 배열. */
export function listDrafts(): DraftSummary[] {
  return readAll().map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
}

/** 초안 하나를 불러옵니다. 없거나 localStorage를 못 쓰면 null.
 *  userAssets는 초안에 없었으므로 빈 객체로 채워서 돌려줍니다(위 설명 참고). */
export function loadDraft(id: string): MapDoc | null {
  const record = readAll().find((d) => d.id === id)
  if (!record) return null
  return { ...record.doc, userAssets: {} }
}

/** 초안 하나를 지웁니다. 명시적으로 파일 저장을 마쳤을 때 부르면 됩니다(§4.3). */
export function clearDraft(id: string): void {
  try {
    const remaining = readAll().filter((d) => d.id !== id)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining))
  } catch {
    // 지우기 실패는 치명적이지 않으므로 조용히 무시합니다.
  }
}

/**
 * 이 브라우저 환경에서 초안 자동 저장을 쓸 수 있는지 확인합니다.
 *
 * 대피로 빌드를 file://로 직접 열면 브라우저가 보안상 localStorage 접근 자체를 막아서
 * setItem이 예외를 던집니다(§4.2 "대피로 빌드"). 그런 환경에서도 앱이 죽으면 안 되므로
 * 이 함수로 미리 확인해서, false면 UI가 초안 관련 기능을 아예 숨기게 하세요.
 */
export function isDraftAvailable(): boolean {
  try {
    const probeKey = '__hamsterS_draft_probe__'
    window.localStorage.setItem(probeKey, '1')
    window.localStorage.removeItem(probeKey)
    return true
  } catch {
    return false
  }
}

// ── 내부 구현 ────────────────────────────────────────────────────────────

function readAll(): DraftRecord[] {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY)
    if (!text) return []
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as DraftRecord[]) : []
  } catch {
    // JSON이 깨졌거나 localStorage 자체를 못 쓰는 경우 모두 "초안 없음"으로 취급합니다.
    return []
  }
}

function persistNow(id: string, doc: MapDoc): void {
  // userAssets만 빼고 나머지 구조를 그대로 담습니다(파일 크기를 줄이는 목적).
  const { userAssets: _userAssets, ...withoutAssets } = doc
  const record: DraftRecord = {
    id,
    title: doc.meta.title || '(제목 없음)',
    updatedAt: new Date().toISOString(),
    doc: withoutAssets,
  }

  writeWithQuotaRetry((drafts) => {
    const withoutCurrent = drafts.filter((d) => d.id !== id)
    // 지금 막 저장한 것을 맨 앞(최신)에 두고, 최근 5개까지만 남깁니다.
    return [record, ...withoutCurrent].slice(0, MAX_DRAFTS)
  })
}

/**
 * drafts 배열을 mutate로 바꾼 뒤 저장을 시도합니다. localStorage 용량이 가득 차서
 * QuotaExceededError가 나면, 가장 오래된 초안(배열 맨 뒤 — 위에서 최신순으로 정렬해 둠)부터
 * 하나씩 지우고 다시 시도합니다. 그래도 안 되면 초안 저장 자체를 포기합니다(치명적이지 않으므로).
 */
function writeWithQuotaRetry(mutate: (drafts: DraftRecord[]) => DraftRecord[]): void {
  let next: DraftRecord[]
  try {
    next = mutate(readAll())
  } catch {
    return
  }

  while (true) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return
    } catch (err) {
      if (!isQuotaExceededError(err) || next.length <= 1) {
        // localStorage 자체를 못 쓰거나(file://) 더 지울 초안이 없으면 포기합니다.
        return
      }
      next = next.slice(0, -1) // 가장 오래된 초안(맨 뒤) 하나 제거 후 재시도
    }
  }
}

function isQuotaExceededError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014)
  )
}
