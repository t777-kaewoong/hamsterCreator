// 숫자를 교사가 직접 넣는 제한속도 표지판(docs/12 §2.3).
//
// 내장 교통 타일(traffic-speed-30 등)과 같은 모양 — 흰 원, 빨간 테두리, 검은 굵은 숫자 — 을
// 그 자리에서 캔버스로 그려 PNG data URL로 돌려줍니다. 결과는 "내 이미지"(userAssets)로 들어가므로
// 맵 파일 하나만 있으면 다시 그릴 수 있고(D4), PDF·썸네일도 내 이미지와 같은 길로 처리됩니다.
import type { UserAsset } from '@/lib/model/types'

/** 내장 타일과 같은 433px(50mm에 약 220dpi) */
const SIZE = 433
const RED = '#ed1c24'
const BLACK = '#111111'
const NUMBER_FONT = "'Arial', 'Helvetica Neue', 'Malgun Gothic', sans-serif"

/** 표지판에 넣을 글자. 숫자 1~3자리(앞뒤 공백 제거). 맞지 않으면 null */
export function normalizeSignNumber(raw: string): string | null {
  const text = raw.trim()
  return /^\d{1,3}$/.test(text) ? text : null
}

export function drawSpeedSign(text: string): UserAsset {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const c = SIZE / 2
  const outer = SIZE * 0.47
  const inner = outer * 0.8

  ctx.fillStyle = RED
  ctx.beginPath()
  ctx.arc(c, c, outer, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(c, c, inner, 0, Math.PI * 2)
  ctx.fill()

  // 글자 높이가 안쪽 원 지름의 약 55%가 되게 하고, 폭이 넘치면 줄입니다(3자리 100 등).
  const maxW = inner * (text.length < 3 ? 1.55 : 1.65)
  let size = inner * 1.1 * 1.38 // 굵은 고딕의 숫자 높이는 글꼴 크기의 약 72%
  ctx.font = `bold ${size}px ${NUMBER_FONT}`
  const width = ctx.measureText(text).width
  if (width > maxW) {
    size *= maxW / width
    ctx.font = `bold ${size}px ${NUMBER_FONT}`
  }
  const m = ctx.measureText(text)
  ctx.fillStyle = BLACK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  // 실제 글자 윗선·아랫선의 가운데를 원 중심에 맞춥니다.
  ctx.fillText(text, c, c + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)

  return { name: `제한속도 ${text}`, w: SIZE, h: SIZE, dataUrl: canvas.toDataURL('image/png') }
}
