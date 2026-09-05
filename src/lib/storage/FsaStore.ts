// File System Access API(showOpenFilePicker / showSaveFilePicker) 기반 저장소.
//
// 이 클래스가 존재하는 이유: 브라우저가 돌려준 FileSystemFileHandle을 인스턴스 필드(this.handle)에
// 계속 들고 있다가 save()를 부를 때 재사용하기 위해서입니다. 그래야 "저장" 버튼을 눌렀을 때 매번
// 대화상자를 다시 띄우지 않고, 방금 열었거나 저장한 그 파일에 조용히 덮어쓰기됩니다. 핸들을
// 버리고 매번 showSaveFilePicker를 새로 부르면 이 클래스는 DownloadStore와 다를 게 없어집니다.
import type { MapDoc } from '../model/types'
import { parseMap, serializeMap } from '../model/serialize'
import type { MapStore } from './types'
import { UserCancelledError, isAbortError } from './types'

const FILE_PICKER_TYPES: FileSystemAccessAcceptType[] = [
  {
    description: '햄스터S 말판 파일',
    accept: { 'application/json': ['.hsmap.json'] },
  },
]

export class FsaStore implements MapStore {
  readonly kind = 'file-overwrite' as const
  readonly canOverwrite = true

  /** 마지막으로 열거나 저장한 파일의 핸들. null이면 아직 이 세션에서 연/저장한 파일이 없다는 뜻. */
  private handle: FileSystemFileHandle | null = null

  async open(): Promise<MapDoc> {
    let handles: FileSystemFileHandle[]
    try {
      handles = await window.showOpenFilePicker({
        types: FILE_PICKER_TYPES,
        excludeAcceptAllOption: false,
        multiple: false,
      })
    } catch (err) {
      // 사용자가 대화상자를 그냥 닫으면 AbortError가 던져집니다 — 실패가 아니라 취소입니다.
      throw isAbortError(err) ? new UserCancelledError() : err
    }

    const handle = handles[0]
    const file = await handle.getFile()
    const text = await file.text()

    const result = parseMap(text)
    if (!result.ok) {
      // 파일은 골랐지만 내용이 맵 파일이 아닌 경우. 이때는 핸들을 기억하지 않습니다
      // (잘못된 파일에 다음 "저장"이 덮어써지면 안 되므로).
      throw new Error(result.error)
    }

    // 다음 save()가 대화상자 없이 이 파일에 바로 덮어쓸 수 있도록 핸들을 기억해둡니다.
    this.handle = handle
    return result.doc
  }

  async save(doc: MapDoc): Promise<void> {
    if (!this.handle) {
      // 아직 이 세션에서 연/저장한 파일이 없어 "어디에" 덮어쓸지 알 수 없으므로
      // 다른 이름으로 저장(파일 선택 대화상자)으로 넘깁니다.
      return this.saveAs(doc)
    }
    await this.writeToHandle(this.handle, doc)
  }

  async saveAs(doc: MapDoc): Promise<void> {
    let handle: FileSystemFileHandle
    try {
      handle = await window.showSaveFilePicker({
        types: FILE_PICKER_TYPES,
        excludeAcceptAllOption: false,
        suggestedName: suggestFileName(doc),
      })
    } catch (err) {
      throw isAbortError(err) ? new UserCancelledError() : err
    }

    await this.writeToHandle(handle, doc)
    // 앞으로의 save()가 이번에 고른 파일에 덮어쓰도록 핸들을 갱신합니다.
    this.handle = handle
  }

  private async writeToHandle(handle: FileSystemFileHandle, doc: MapDoc): Promise<void> {
    // createWritable()은 기본값(keepExistingData: false)이라 임시 파일이 빈 상태로
    // 시작합니다. 즉 이전 내용 길이와 상관없이 새 내용으로 완전히 덮어써지고,
    // close()를 부르는 순간에만 실제 디스크 파일에 원자적으로 반영됩니다.
    const writable = await handle.createWritable()
    try {
      await writable.write(serializeMap(doc))
    } finally {
      await writable.close()
    }
  }
}

function suggestFileName(doc: MapDoc): string {
  const title = doc.meta.title.trim()
  return `${title || '이름없음'}.hsmap.json`
}
