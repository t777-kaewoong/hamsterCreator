// 시작 화면 프리셋 카드의 썸네일 렌더 (PRD §9.8).
//
// "해당 맵을 실제로 렌더한 이미지를 contain으로 배치합니다. 아이콘이나 글자로 대체하지
// 않습니다"(U2) — 그래서 이 파일은 진짜로 종이·격자를 그려서 <img>에 넣을 data URL을
// 만듭니다. CanvasViewport(renderer.ts의 LayeredRenderer)는 "팬·줌 때마다 계속 다시
// 그리는" 라이브 렌더러라 5장짜리 오프스크린 레이어와 dirty 추적을 갖고 있지만, 여기는
// "한 번 그리고 이미지로 굳혀서 끝"인 단발성 작업이라 그 장치가 필요 없습니다. 그래서
// LayeredRenderer는 쓰지 않고, 이 함수 안에서 캔버스 하나에 draw*Layer 함수들을 순서대로
// 직접 호출합니다.
import type { MapDoc } from '@/lib/model/types'
import { MAX_PX_PER_MM, MIN_PX_PER_MM, Viewport } from '@/features/canvas/viewport'
import { drawArtLayer, drawGridLayer, drawPaperLayer, drawPropsLayer, mapSizeMm } from '@/features/canvas/drawBoard'
import { getTokens } from '@/features/canvas/cssTokens'

/**
 * 썸네일 안에서 아트보드 주위에 남기는 여백(CSS px).
 *
 * viewport.ts의 FIT_MARGIN_PX(48px)는 본체 캔버스(수백~수천 px)를 기준으로 정해진 값이라
 * 여기 그대로 가져다 쓰면 안 됩니다. 이 함수가 그리는 카드 썸네일 영역은 세로 112px밖에
 * 안 되는데, 위아래로 48px씩(총 96px) 여백을 남기면 맵이 들어갈 자리가 16px밖에 안 남아
 * 사실상 안 보이는 크기가 됩니다. 그래서 FIT_MARGIN_PX를 쓰지 않고, computeFitPxPerMm과
 * 같은 계산식을 이 값(8px)으로 직접 반복합니다.
 */
const THUMBNAIL_MARGIN_PX = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * doc을 cssW×cssH 크기(CSS px)의 오프스크린 캔버스에 그려 PNG data URL로 돌려줍니다.
 *
 * devicePixelRatio를 반영해 실제 픽셀 수는 CSS 크기 × dpr로 만들고, 그리기 좌표계는
 * setTransform(dpr,0,0,dpr,0,0)으로 다시 CSS 픽셀 기준으로 되돌립니다(renderer.ts의
 * LayeredRenderer.resize가 하는 것과 같은 이유 — dpr 배율 화면에서 흐리게 나오지 않게).
 *
 * 주의(아트 타일이 있는 프리셋을 나중에 추가할 때 반드시 읽을 것): drawArtLayer는
 * tileBitmapCache(타일 비트맵을 fetch→createImageBitmap으로 비동기 디코드해두는 캐시,
 * tileBitmaps.ts)를 읽습니다. 이 함수를 부르는 시점에 해당 타일이 아직 디코드되기
 * 전이면 그 칸은 그냥 빈 채로 그려지고, 이 함수는 그걸 기다려주지 않습니다(콜백이나
 * Promise가 없는 동기 함수). 지금 START_PRESETS 5종은 전부 cells가 비어 있어(격자선만
 * 있는 프리셋) 이 문제가 실제로는 나타나지 않지만, 나중에 아트 타일이 채워진 프리셋을
 * 추가하면 새로고침 직후 잠깐(또는 어쩌다 계속) 썸네일이 비어 보일 수 있습니다. 그때는
 * tileBitmapCache.onLoad로 다시 그려 캐시를 갱신하는 방식으로 이 함수를 고쳐야 합니다.
 */
export function renderMapThumbnail(doc: MapDoc, cssW: number, cssH: number): string {
  const canvas = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(cssW * dpr))
  canvas.height = Math.max(1, Math.round(cssH * dpr))

  const ctx = canvas.getContext('2d')
  if (!ctx) return '' // 이론상 거의 일어나지 않지만, 발생해도 <img src="">는 그냥 깨진 이미지일 뿐 앱이 죽지 않습니다.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // ── "맞춤" 배율·원점 계산 (viewport.ts의 Viewport.fit()과 같은 식, 여백만 8px로 축소) ──
  const { wMm, hMm } = mapSizeMm(doc)
  const availW = cssW - THUMBNAIL_MARGIN_PX * 2
  const availH = cssH - THUMBNAIL_MARGIN_PX * 2
  const pxPerMm = clamp(Math.min(availW / wMm, availH / hMm), MIN_PX_PER_MM, MAX_PX_PER_MM)
  const originPx = {
    x: (cssW - wMm * pxPerMm) / 2,
    y: (cssH - hMm * pxPerMm) / 2,
  }
  const viewport = new Viewport(pxPerMm, originPx)

  const tokens = getTokens()
  drawPaperLayer(ctx, viewport, doc, tokens)
  drawArtLayer(ctx, viewport, doc)
  drawGridLayer(ctx, viewport, doc, tokens)
  // 오버레이(호버·고스트)는 상호작용 중에만 존재하므로 애초에 그릴 게 없습니다.
  // props는 지금 프리셋 5종에 전혀 없지만, 있으면 그리라는 작업 지시에 따라 조건 없이
  // 그냥 호출합니다 — doc.props가 빈 배열이면 이 함수는 아무것도 안 그리고 바로 끝납니다.
  drawPropsLayer(ctx, viewport, doc)

  return canvas.toDataURL('image/png')
}
