// 초안의 사용자 이미지(userAssets)를 IndexedDB에 따로 보관합니다.
//
// [왜 필요한가 — 2026-10-27 "이미지를 새로 추가하면 기존에 놓은 이미지가 새 이미지로 바뀜"]
// 초안(draft.ts)은 localStorage(보통 5MB)에 저장하느라 이미지를 뺐습니다. 그래서 초안을 "복구"하면
// 칸에는 asset:u1이 그대로 남아 있는데 u1 그림은 사라진 상태가 됐고, 그다음 이미지를 올리면 비어 있던
// u1 번호를 새 그림이 받아 **기존에 놓은 칸이 전부 새 그림으로 바뀌었습니다.**
// 이미지는 용량이 넉넉한 IndexedDB에 초안 id별로 따로 두고, 복구할 때 다시 붙입니다.
// IndexedDB를 못 쓰는 환경(파일로 연 단일 HTML 등)에서는 예전처럼 이미지 없이 복구됩니다.
import type { UserAssets } from '@/lib/model/types'

const DB_NAME = 'hamsterS.draftAssets'
const STORE = 'assets'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function run<T>(mode: IDBTransactionMode, fallback: T, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  if (!db) return fallback
  try {
    return await new Promise<T>((resolve) => {
      const request = op(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => resolve(fallback)
    })
  } catch {
    return fallback
  } finally {
    db.close()
  }
}

/** 초안마다 마지막으로 쓴 이미지 묶음의 요약. 같은 내용을 500ms마다 다시 쓰지 않으려고 둡니다. */
const lastSaved = new Map<string, string>()
function signature(assets: UserAssets): string {
  return Object.entries(assets)
    .map(([key, asset]) => `${key}:${asset.dataUrl.length}`)
    .sort()
    .join('|')
}

/** 초안 id의 이미지를 보관합니다(바뀐 경우에만 실제로 씀). 기다리지 않아도 됩니다. */
export function saveDraftAssets(id: string, assets: UserAssets): void {
  const sig = signature(assets)
  if (lastSaved.get(id) === sig) return
  lastSaved.set(id, sig)
  void run('readwrite', null, (store) => store.put(assets, id))
}

/** 초안 id의 이미지. 없거나 못 읽으면 빈 객체. */
export async function loadDraftAssets(id: string): Promise<UserAssets> {
  const assets = await run<UserAssets | undefined>('readonly', undefined, (store) => store.get(id))
  return assets ?? {}
}

/** 초안 목록에 없는 이미지 묶음을 지웁니다(초안을 지우거나 오래된 초안이 밀려났을 때). */
export function pruneDraftAssets(keepIds: string[]): void {
  void (async () => {
    const keys = await run<IDBValidKey[]>('readonly', [], (store) => store.getAllKeys())
    for (const key of keys) {
      if (typeof key === 'string' && !keepIds.includes(key)) {
        lastSaved.delete(key)
        await run('readwrite', null, (store) => store.delete(key))
      }
    }
  })()
}
