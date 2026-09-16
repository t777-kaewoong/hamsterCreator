// 초안 자동 저장(PRD §4.3).
//
// 편집 중 500ms 동안 추가 입력이 없으면 localStorage에 지금 맵 상태를 저장해둡니다. 앱을
// 다시 열었을 때 브라우저가 갑자기 닫혔거나 저장을 깜빡한 경우 복구할 수 있게 하기 위해서입니다.
// "지금 편집 중인 문서 하나"마다 초안 슬롯 하나를 계속 덮어쓰고, 최근 5개까지만 남겨둡니다.
//
// [2026-09-16 수정 — 맵을 갈아타면 앞 맵 초안이 사라지던 문제]
// 예전에는 슬롯 id가 "브라우저 페이지 로드 1회당 하나"였습니다. 그래서 한 번 앱을 켠 상태로
// 맵 A를 편집하다 시작 화면으로 나가 맵 B를 열면, B가 A와 같은 슬롯에 덮어써져서 A의 초안이
// 통째로 없어졌습니다(실제로 재현했습니다). 수업 준비 중에 말판 여러 개를 오가는 건 이 앱의
// 일상적인 사용 방식이라 드문 사고가 아니었습니다.
// 이제는 문서를 새로 열 때마다 beginDraftSession()으로 슬롯을 새로 따고, 초안을 복구해서
// 연 경우에만 adoptDraftSession(id)으로 원래 슬롯을 이어서 씁니다(복구할 때마다 슬롯이
// 늘어나 5칸을 금방 밀어내는 걸 막기 위해서입니다).
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

// 지금 편집 중인 문서가 쓰는 초안 슬롯 id. 문서를 새로 열 때 beginDraftSession()이
// 이 값을 비우고, 다음 saveDraft() 호출이 새 id를 하나 만듭니다.
let sessionDraftId: string | null = null
function getSessionDraftId(): string {
  if (!sessionDraftId) {
    sessionDraftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  return sessionDraftId
}

let debounceTimer: number | undefined
// 아직 디바운스 대기 중이라 localStorage에 안 쓰인 내용. 문서를 갈아타거나 탭을 닫을 때
// 이걸 먼저 흘려보내지 않으면 "마지막 0.5초 안의 편집"이 통째로 사라집니다.
let pendingWrite: { id: string; doc: MapDoc } | null = null

/** 대기 중인 초안 쓰기가 있으면 지금 즉시 반영합니다. 없으면 아무 일도 하지 않습니다. */
export function flushDraft(): void {
  if (typeof window !== 'undefined') window.clearTimeout(debounceTimer)
  debounceTimer = undefined
  const pending = pendingWrite
  pendingWrite = null
  if (pending) persistNow(pending.id, pending.doc)
}

/**
 * 새 문서를 열기 직전에 부릅니다. 지금까지 편집하던 문서의 마지막 내용을 확실히 남긴 뒤
 * 슬롯을 새로 따게 만들어서, 새 문서가 이전 문서의 초안을 덮어쓰지 않게 합니다.
 */
export function beginDraftSession(): void {
  flushDraft()
  sessionDraftId = null
}

/**
 * 초안 복구로 문서를 연 경우에 부릅니다. 복구한 그 슬롯을 계속 쓰게 해서, 복구할 때마다
 * 슬롯이 하나씩 늘어나 최근 5개 자리를 스스로 밀어내는 일을 막습니다.
 */
export function adoptDraftSession(id: string): void {
  flushDraft()
  sessionDraftId = id
}

/** 지금 문서가 쓰는 초안 슬롯 id. 아직 한 번도 저장 예약이 없었으면 null.
 *  파일로 정식 저장을 마친 뒤 clearDraft()에 넘겨 초안을 정리하는 용도입니다. */
export function currentDraftId(): string | null {
  return sessionDraftId
}

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
  pendingWrite = { id, doc }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = undefined
    pendingWrite = null
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
  // 지금 슬롯을 지우는 경우, 대기 중인 쓰기가 남아 있으면 지운 직후에 되살아납니다.
  // 그래서 먼저 보류분을 버립니다.
  if (id === sessionDraftId) {
    if (typeof window !== 'undefined') window.clearTimeout(debounceTimer)
    debounceTimer = undefined
    pendingWrite = null
    sessionDraftId = null
  }
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
