// 맵 파일 저장소의 공통 인터페이스(PRD §4.4).
// 편집기 코드는 FsaStore인지 DownloadStore인지 몰라도 되게, 이 MapStore 인터페이스만
// 보고 open()/save()/saveAs()를 호출합니다. 실제 구현은 FsaStore.ts / DownloadStore.ts 참고.
import type { MapDoc } from '../model/types'

/** 저장소 종류. 상단바 저장 버튼 문구를 "저장"/"내려받기"로 바꾸는 기준으로도 씁니다(§4.4). */
export type StoreKind = 'file-overwrite' | 'file-download'

export interface MapStore {
  /** 이 저장소가 어떤 방식인지(§4.4 표) */
  readonly kind: StoreKind
  /** true면 save()가 실제로 같은 파일에 덮어쓰기됩니다. false면 save()도 매번 새 다운로드입니다 */
  readonly canOverwrite: boolean
  /** 파일 선택 대화상자를 열어 맵을 불러옵니다. 파일 내용이 유효하지 않으면 예외를 던집니다 */
  open(): Promise<MapDoc>
  /** 지금 열려 있는 파일에 저장합니다. 아직 연/저장한 파일이 없으면 saveAs()로 넘어갑니다 */
  save(doc: MapDoc): Promise<void>
  /** 항상 "다른 이름으로 저장" 대화상자(또는 다운로드)를 새로 띄웁니다 */
  saveAs(doc: MapDoc): Promise<void>
}

/**
 * 사용자가 파일 선택/저장 대화상자를 그냥 닫았을 때(취소) 던지는 전용 오류입니다.
 *
 * 브라우저는 이 상황에서 DOMException("AbortError")를 던지는데, 이건 앱이 뭔가 실패한 게
 * 아니라 사용자가 마음을 바꾼 정상적인 동작입니다. 그래서 이 오류로 바꿔서 던지고,
 * 호출부(App.tsx 등)는 `err instanceof UserCancelledError`일 때 토스트를 띄우지 않고
 * 조용히 무시하면 됩니다. (반대로 일반 Error를 던지면 "저장 실패" 토스트가 뜨는 게 맞습니다)
 */
export class UserCancelledError extends Error {
  constructor(message = '사용자가 취소했습니다.') {
    super(message)
    this.name = 'UserCancelledError'
  }
}

/** 브라우저가 파일 선택/저장 대화상자에서 사용자가 취소했을 때 던지는
 *  DOMException("AbortError")인지 확인합니다. FsaStore에서 UserCancelledError로 바꿔치기할 때 씁니다. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
