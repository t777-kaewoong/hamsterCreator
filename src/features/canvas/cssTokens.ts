// 디자인 토큰(CSS 변수)을 읽어와 캔버스 그리기 코드에서 쓸 수 있게 캐싱해두는 헬퍼.
//
// [왜 이 파일이 필요한가]
// <canvas>에 그림을 그릴 때는 CSS 클래스를 못 쓰고 JS 문자열로 색을 직접 넘겨야 합니다.
// 그렇다고 캔버스 코드 안에 "#4F46E5" 같은 색을 직접 적으면(하드코딩) tokens.css를 고쳐도
// 캔버스만 색이 안 바뀌는 문제가 생깁니다. 그래서 매번 getComputedStyle로 실제 CSS 변수
// 값을 읽어다 씁니다. 다만 getComputedStyle은 매 프레임 부르기엔 느리므로, 한 번 읽은 값을
// 캐시해두고 필요할 때(이론상 테마가 바뀔 때 등)만 refreshTokens()로 다시 읽습니다.
//
// 인쇄용 검정(--c-print-black)도 예외 없이 이 파일을 통해 읽습니다. "색은 전부 토큰에서만
// 가져온다"는 규칙에 예외를 두지 않기 위함이며, 그 토큰의 실제 값은 항상 #000000으로 고정
//되어 있습니다(tokens.css 주석 참고 — 로봇 센서 때문에 바뀌면 안 되는 값).

/** 캔버스 코드에서 실제로 쓰는 토큰 이름 목록. 새로 쓸 토큰이 생기면 여기 추가하세요. */
const TOKEN_NAMES = [
  '--c-paper',
  '--c-canvas-bg',
  '--c-guide',
  '--c-node',
  '--c-surface',
  '--c-surface-2',
  '--c-border',
  '--c-border-strong',
  '--c-text-2',
  '--c-text-3',
  '--c-text-inverse',
  '--c-primary',
  '--c-primary-soft',
  '--c-hover-cell',
  '--c-ghost',
  '--c-warn',
  '--c-warn-zone',
  '--c-print-black',
  '--e1',
  '--e2',
] as const

export type TokenName = (typeof TOKEN_NAMES)[number]

let cache: Record<TokenName, string> | null = null

function readAllTokens(): Record<TokenName, string> {
  const style = getComputedStyle(document.documentElement)
  const result = {} as Record<TokenName, string>
  for (const name of TOKEN_NAMES) {
    result[name] = style.getPropertyValue(name).trim()
  }
  return result
}

/** 캐시된 토큰 값을 돌려줍니다. 처음 호출할 때만 실제로 CSS를 읽고, 그 뒤로는 캐시를 그대로 씁니다. */
export function getTokens(): Record<TokenName, string> {
  if (!cache) cache = readAllTokens()
  return cache
}

/** 토큰 값을 강제로 다시 읽습니다. v1은 라이트 모드만 있어 평소엔 부를 일이 없지만,
 *  나중에 테마 전환이 생기면 이 함수를 테마 전환 시점에 호출하면 됩니다. */
export function refreshTokens(): void {
  cache = readAllTokens()
}

/** --e1/--e2처럼 "0 4px 12px rgba(...)" 형태로 적힌 그림자 토큰을 오프셋·번짐·색으로 풀어냅니다.
 *  캔버스는 box-shadow 문자열을 그대로 못 쓰고 shadowOffsetX/Y, shadowBlur, shadowColor를
 *  각각 따로 지정해야 하기 때문입니다. 형식이 tokens.css의 표기와 다르면 null을 돌려줍니다. */
export function parseShadowToken(raw: string): { offsetX: number; offsetY: number; blur: number; color: string } | null {
  const match = raw.match(/^(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(.+)$/)
  if (!match) return null
  const [, x, y, blur, color] = match
  return { offsetX: Number(x), offsetY: Number(y), blur: Number(blur), color: color.trim() }
}
