// 인쇄용 아이콘 카탈로그 (FR-8.2, PRD §9.6).
//
// 화면 UI 아이콘(도구 레일 등)은 전부 lucide-react를 씁니다. 하지만 이 파일이 다루는
// 7종은 그것과 다릅니다 — 말판에 실제로 인쇄되는 그림(오브젝트)입니다. 그래서 얇은
// 선(2px 스트로크) 대신 꽉 찬 면(fill)으로 그린 자체 제작 SVG를 씁니다(src/assets/icons/*.svg).
//
// TILES(src/lib/tiles/catalog.ts)와 똑같은 모양(id/name/url/kind)으로 내보내서,
// 팔레트 패널이 타일 그리드와 아이콘 그리드를 같은 컴포넌트로 그릴 수 있게 했습니다.

import flagStartUrl from '@/assets/icons/flag-start.svg'
import flagGoalUrl from '@/assets/icons/flag-goal.svg'
import fireUrl from '@/assets/icons/fire.svg'
import valveUrl from '@/assets/icons/valve.svg'
import personUrl from '@/assets/icons/person.svg'
import trafficLightUrl from '@/assets/icons/traffic-light.svg'
import hamsterUrl from '@/assets/icons/hamster.svg'

export interface IconDef {
  /** 아이콘 아이디. 맵 문서에 저장될 때 Prop.asset 값으로 그대로 씁니다 */
  id: string
  /** 팔레트에 보이는 한글 이름 */
  name: string
  /** TILES와 같은 필드 이름을 맞추기 위한 값. 인쇄용 아이콘은 전부 낱개 오브젝트라 'object' 고정 */
  kind: 'object'
  /** 브라우저가 불러올 이미지 주소 (SVG는 별도 디코드 없이 <img src>로 바로 그릴 수 있음) */
  url: string
}

/** 인쇄용 아이콘 7종(FR-8.2). 팔레트 "아이콘" 탭이 이 목록을 그대로 그립니다. */
export const ICONS: IconDef[] = [
  { id: 'flag-start', name: '출발 깃발', kind: 'object', url: flagStartUrl },
  { id: 'flag-goal', name: '도착 깃발', kind: 'object', url: flagGoalUrl },
  { id: 'fire', name: '불', kind: 'object', url: fireUrl },
  { id: 'valve', name: '밸브', kind: 'object', url: valveUrl },
  { id: 'person', name: '사람', kind: 'object', url: personUrl },
  { id: 'traffic-light', name: '신호등', kind: 'object', url: trafficLightUrl },
  { id: 'hamster', name: '햄스터 로봇', kind: 'object', url: hamsterUrl },
]

/** id로 아이콘 하나 찾기. 없으면 undefined */
export function getIcon(id: string): IconDef | undefined {
  return ICONS.find((i) => i.id === id)
}
