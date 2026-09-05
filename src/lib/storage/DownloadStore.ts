// File System Access API를 못 쓰는 브라우저(파이어폭스·사파리 등)를 위한 폴백 저장소.
//
// <input type="file">로 파일을 "선택"만 할 수 있고, 저장은 Blob + <a download>로 다운로드
// 폴더에 새 파일을 만드는 것뿐이라 파일 핸들이라는 개념 자체가 없습니다. 그래서 진짜
// 덮어쓰기가 불가능하고(canOverwrite = false), save()도 saveAs()와 똑같이 매번 새로 다운로드합니다.
import type { MapDoc } from '../model/types'
import { parseMap, serializeMap } from '../model/serialize'
import type { MapStore } from './types'
import { UserCancelledError } from './types'

export class DownloadStore implements MapStore {
  readonly kind = 'file-download' as const
  readonly canOverwrite = false

  async open(): Promise<MapDoc> {
    const file = await pickFile()
    if (!file) {
      // 사용자가 파일 선택 대화상자를 취소함 — 실패가 아니라 취소.
      throw new UserCancelledError()
    }

    const text = await file.text()
    const result = parseMap(text)
    if (!result.ok) {
      throw new Error(result.error)
    }
    return result.doc
  }

  async save(doc: MapDoc): Promise<void> {
    // 덮어쓸 파일이라는 개념이 없으므로 저장도 항상 새 다운로드입니다.
    return this.saveAs(doc)
  }

  async saveAs(doc: MapDoc): Promise<void> {
    downloadAsFile(doc)
  }
}

/**
 * 동적으로 <input type="file">을 만들어 사용자가 파일 하나를 고르게 합니다.
 * 취소하면 null을 돌려줍니다.
 *
 * 최신 Chrome/Edge(NFR-6이 지원 대상으로 못박은 브라우저)는 사용자가 대화상자를 취소하면
 * 'cancel' 이벤트를 쏴줍니다. 그 이벤트로 "선택 안 함"과 "아직 선택 안 함"을 구분합니다.
 */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.hsmap.json,application/json'
    // 화면에 보이면 안 되지만, 일부 브라우저는 DOM에 붙어 있어야 click()이 안정적으로 동작합니다.
    input.style.display = 'none'
    document.body.appendChild(input)

    function cleanup() {
      input.remove()
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null
      cleanup()
      resolve(file)
    })
    input.addEventListener('cancel', () => {
      cleanup()
      resolve(null)
    })

    input.click()
  })
}

/** MapDoc을 JSON Blob으로 만들어 <a download>로 즉시 다운로드합니다. */
function downloadAsFile(doc: MapDoc): void {
  const json = serializeMap(doc)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = suggestFileName(doc)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  // 다운로드가 실제로 시작된 뒤에 회수합니다. 클릭 직후 바로 revoke하면 일부 브라우저에서
  // 다운로드가 시작되기 전에 URL이 무효화될 수 있어 약간의 여유를 둡니다.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function suggestFileName(doc: MapDoc): string {
  const title = doc.meta.title.trim()
  return `${title || '이름없음'}.hsmap.json`
}
