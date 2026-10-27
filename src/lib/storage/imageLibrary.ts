// 내 이미지 보관함 — 선생님이 올린 타일 이미지를 이 브라우저에 보관합니다(docs/07 §2.3).
//
// [왜 맵 파일 말고 따로 보관하는가]
// 올린 이미지는 원래 맵 파일(userAssets)에만 들어갑니다(D4 자기 완결성). 그래서 새 맵을 만들면
// 지난번에 올린 학교 마스코트·교실 사진을 매번 다시 올려야 했습니다. 이 보관함은 "팔레트에 계속
// 보이게" 하는 용도일 뿐이고, 맵에 놓는 순간 그 이미지는 지금처럼 맵 파일에도 들어갑니다 —
// 그래서 파일을 다른 컴퓨터에서 열어도 그림이 빠지지 않습니다.
//
// [왜 localStorage가 아니라 IndexedDB인가]
// 이미지 한 장이 100~200KB(433px PNG의 base64)라 localStorage(보통 5MB, 초안 저장도 같이 씀)로는
// 금방 찹니다. IndexedDB는 수백 MB까지 쓸 수 있습니다. 막힌 환경(파일로 연 단일 HTML·사생활 보호 창
// 일부)에서는 조용히 빈 보관함으로 동작합니다 — 이미지는 여전히 맵 파일에는 들어갑니다.
import type { UserAsset } from '@/lib/model/types'

export interface LibraryImage extends UserAsset {
  id: string
  /** 보관한 시각(ms). 팔레트에 올린 순서대로 보여 주는 데 씁니다. */
  addedAt: number
}

const DB_NAME = 'hamsterS.imageLibrary'
const STORE = 'images'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** 한 번의 읽기/쓰기. 보관함을 못 열면 fallback을 돌려줍니다. */
async function withStore<T>(mode: IDBTransactionMode, fallback: T, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  if (!db) return fallback
  try {
    return await new Promise<T>((resolve) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => resolve(fallback)
    })
  } catch {
    return fallback
  } finally {
    db.close()
  }
}

/** 보관한 이미지 전부(올린 순서). */
export async function listLibraryImages(): Promise<LibraryImage[]> {
  const all = await withStore<LibraryImage[]>('readonly', [], (store) => store.getAll())
  return all.slice().sort((a, b) => a.addedAt - b.addedAt)
}

/** 이미지를 보관합니다. 같은 그림(dataUrl이 같음)이 이미 있으면 다시 넣지 않습니다. */
export async function addLibraryImage(asset: UserAsset): Promise<void> {
  const existing = await listLibraryImages()
  if (existing.some((image) => image.dataUrl === asset.dataUrl)) return
  const image: LibraryImage = {
    ...asset,
    id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    addedAt: Date.now(),
  }
  await withStore('readwrite', null, (store) => store.put(image))
}

/** 같은 그림을 보관함에서 뺍니다(맵 파일에 들어간 그림은 건드리지 않음). */
export async function removeLibraryImage(dataUrl: string): Promise<void> {
  const existing = await listLibraryImages()
  for (const image of existing.filter((item) => item.dataUrl === dataUrl)) {
    await withStore('readwrite', null, (store) => store.delete(image.id))
  }
}
