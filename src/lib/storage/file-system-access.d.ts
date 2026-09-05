// File System Access API(showOpenFilePicker / showSaveFilePicker) 타입 선언.
// FileSystemFileHandle · FileSystemWritableFileStream 자체는 TypeScript 표준 DOM 타입에
// 이미 있지만, 그걸 얻어오는 전역 함수(window.showOpenFilePicker 등)는 아직 표준
// lib.dom.d.ts에 없어서 FsaStore.ts에서 실제로 쓰는 부분만 최소로 직접 선언합니다.
// 이 파일은 import/export가 없는 "스크립트" 파일이라 자동으로 전역에 합쳐집니다.

interface FileSystemAccessAcceptType {
  description?: string
  /** 예: { 'application/json': ['.hsmap.json', '.json'] } */
  accept: Record<string, string | string[]>
}

interface FileSystemAccessPickerOptionsBase {
  types?: FileSystemAccessAcceptType[]
  excludeAcceptAllOption?: boolean
}

interface OpenFilePickerOptions extends FileSystemAccessPickerOptionsBase {
  multiple?: boolean
}

interface SaveFilePickerOptions extends FileSystemAccessPickerOptionsBase {
  suggestedName?: string
}

interface Window {
  /** 파일 열기 대화상자. 사용자가 취소하면 AbortError(DOMException)로 reject됨. */
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
  /** 파일 저장 대화상자. 돌려준 핸들을 들고 있으면 나중에 대화상자 없이 재저장 가능. */
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
}
