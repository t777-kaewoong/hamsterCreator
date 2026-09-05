// 저장소 어댑터 진입점.
// 다른 코드는 FsaStore/DownloadStore를 직접 고르지 말고, 여기의 createMapStore()만 부르세요.
// 지금 이 브라우저가 File System Access API를 지원하는지 보고 알맞은 구현을 골라줍니다(§4.4).
import type { MapStore } from './types'
import { FsaStore } from './FsaStore'
import { DownloadStore } from './DownloadStore'

export type { MapStore, StoreKind } from './types'
export { UserCancelledError, isAbortError } from './types'
export { FsaStore } from './FsaStore'
export { DownloadStore } from './DownloadStore'

/** 이 브라우저가 파일 덮어쓰기 저장(File System Access API)을 지원하는지 확인합니다. */
export function supportsFileOverwrite(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

/**
 * 지금 브라우저에 맞는 MapStore 구현을 하나 만들어 돌려줍니다.
 *
 * 주의: FsaStore는 마지막으로 연/저장한 파일의 핸들을 인스턴스 안에 들고 있어야 진짜
 * 덮어쓰기가 됩니다. 그러니 이 함수로 만든 인스턴스 하나를 앱 전체에서 계속 재사용하세요
 * (예: 최상위 컴포넌트의 useState(() => createMapStore())). 호출할 때마다 새로 만들면
 * 매번 핸들이 사라져서 "저장"이 항상 "다른 이름으로 저장"처럼 동작하게 됩니다.
 */
export function createMapStore(): MapStore {
  return supportsFileOverwrite() ? new FsaStore() : new DownloadStore()
}
