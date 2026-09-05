// 내장 아트 타일 카탈로그.
//
// 로보메이션이 무료 배포한 `말판/board_game_pdf_ko/custom_objects.pdf`에서 뽑아낸
// 50mm 타일 35종을 팔레트(§9.11)에서 쓸 수 있게 목록으로 만들어 둔 파일입니다.
// 그림 파일은 src/assets/tiles/*.png 에 있고, 설명(이름·테마·분류)은 같은 폴더의
// manifest.json 에 있습니다. 이 파일은 그 둘을 짝지어 주는 역할만 합니다.

//
// ⚠ [타일 파일 이름 규칙 — 광고 차단기에 걸리는 이름을 쓰지 마세요]
// 모험 테마 타일은 원래 `adv-book.png` 처럼 `adv-` 로 시작했는데, 크롬에 흔히 깔려
// 있는 광고 차단 확장(uBlock Origin, AdBlock 등)이 `adv-` 를 광고(advertisement)로
// 보고 요청 자체를 막아버립니다(콘솔에 `net::ERR_BLOCKED_BY_CLIENT`).
// 그런데 아래 import.meta.glob 은 eager: true 라서, 개발 서버에서는 이 png 들이
// 하나하나 "모듈"로 불려옵니다. 그중 하나라도 차단되면 모듈 그래프 전체가 실패해
// **앱이 아예 안 뜨고 흰 화면만 나옵니다**(실제로 겪은 문제라 `adventure-` 로 바꿨습니다).
// 그래서 타일·아이콘 파일 이름에 다음 낱말을 넣지 마세요:
//   ad / ads / adv / advert / banner / popup / promo / sponsor / analytics / track
// 학교 컴퓨터에는 광고 차단기가 깔려 있는 경우가 많아 특히 조심해야 합니다.
import manifest from '@/assets/tiles/manifest.json'

/** 타일이 칸을 어떻게 채우는지. 팔레트 묶음과 '영역 채우기' 동작에 씁니다. */
export type TileKind =
  /** 칸을 빈틈없이 채움. 여러 칸에 이어 깔면 바닥이 연속돼 보입니다 */
  | 'floor'
  /** 칸 안에 여백을 두고 들어가는 블록(얼음덩이 등). 칸 사이에 흰 틈이 보입니다 */
  | 'block'
  /** 배경이 없는 낱개 물건(금화, 물약 등). 한 칸씩 놓는 용도입니다 */
  | 'object'

export interface TileDef {
  /** 파일 이름이자 맵 문서에 저장되는 값. 예: 'dungeon-chest' */
  id: string
  /** 팔레트에 보이는 한글 이름 */
  name: string
  /** 테마 영문 키 (탭 구분용) */
  theme: string
  /** 테마 한글 이름 */
  themeName: string
  kind: TileKind
  /** 원본 픽셀 크기. 50mm에 433px이라 약 220dpi입니다 */
  w: number
  h: number
  bytes: number
  /** 브라우저가 실제로 불러올 이미지 주소 (빌드하면 해시가 붙은 경로로 바뀜) */
  url: string
}

// Vite가 빌드할 때 tiles 폴더의 png를 전부 찾아 주소로 바꿔 줍니다.
// eager: true 라서 앱이 시작할 때 주소가 모두 준비됩니다(그림 자체를 다 받는 건 아닙니다).
const urls = import.meta.glob<string>('@/assets/tiles/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})

/** 파일 경로에서 'dungeon-chest' 같은 id만 뽑아냅니다 */
function idFromPath(path: string): string {
  return path.split('/').pop()!.replace(/\.png$/, '')
}

const urlById = new Map<string, string>()
for (const [path, url] of Object.entries(urls)) urlById.set(idFromPath(path), url)

/** 내장 타일 35종 전체 목록 */
export const TILES: TileDef[] = (manifest as Omit<TileDef, 'url'>[]).map((t) => {
  const url = urlById.get(t.id)
  if (!url) throw new Error(`타일 그림 파일을 찾을 수 없습니다: ${t.id}.png`)
  return { ...t, url }
})

/** id로 타일 하나 찾기. 없으면 undefined */
export function getTile(id: string): TileDef | undefined {
  return TILES.find((t) => t.id === id)
}

/** 팔레트 탭 순서. PRD §9.11의 테마 목록과 같은 순서로 둡니다 */
export const THEME_ORDER = ['dungeon', 'forest', 'ice', 'adventure', 'candy', 'dino'] as const

/** 테마별로 묶은 목록. 팔레트가 탭마다 이걸 그대로 뿌리면 됩니다 */
export const TILES_BY_THEME: { theme: string; themeName: string; tiles: TileDef[] }[] =
  THEME_ORDER.map((theme) => {
    const tiles = TILES.filter((t) => t.theme === theme)
    return { theme, themeName: tiles[0]?.themeName ?? theme, tiles }
  })
