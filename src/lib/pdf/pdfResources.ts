import pretendardPdfFontUrl from '@/assets/fonts/Pretendard-SemiBold.pdf.ttf?url'

/** 단일 HTML에서 2.7MB 폰트 data URL이 중복 인라인되지 않도록 한 모듈에서만 로드합니다. */
export async function loadPdfFontBytes(): Promise<Uint8Array> {
  const response = await fetch(pretendardPdfFontUrl)
  if (!response.ok) throw new Error('PDF 한글 폰트를 불러오지 못했습니다')
  return new Uint8Array(await response.arrayBuffer())
}
