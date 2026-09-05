// 맵 문서 전반에서 쓰는 고정 상수.
// PRD §5(D6·D8), §6.1(용지 규격), FR-10.7~10.9의 근거 수치를 한곳에 모았습니다.
// 아래 숫자들은 "적당히 정한 기본값"이 아니라 로보메이션 공식 자료의 실측값이거나
// 로봇 하드웨어 규격에서 나온 값입니다. 바꾸고 싶으면 먼저 PRD를 다시 확인하세요.

/** 격자 한 칸의 크기(mm). 로보메이션 공식 말판 자료 실측값.
 *  이 값이 아니면 실제 정품 말판·타일과 크기가 어긋나므로, 편집기에서 pitch를
 *  이 값과 다르게 바꾸면 경고를 띄워야 합니다(D6). */
export const PITCH_MM = 50

/** 격자선(트랙 선) 폭(mm). 역시 공식 자료 실측값(D6·D8 기본값).
 *  자유곡선의 기본 선폭도 이 값을 씁니다(D8). */
export const LINE_WIDTH_MM = 8

/** 자유곡선 최소 곡률 반경(mm)(FR-10.8 검증 기준).
 *  근거: 제공된 linetracer.pdf에서 가장 작은 원이 Ø100mm(반경 50mm). 공식 자료가 그보다
 *  작은 곡선을 만들지 않았다는 것이 실질적인 하한선입니다. */
export const MIN_CURVE_RADIUS_MM = 50

/** 햄스터S 로봇 폭(mm)(FR-10.9). 평행한 두 트랙 구간 사이 간격이 이보다 좁으면
 *  로봇이 옆 트랙의 센서까지 같이 읽어버릴 수 있어 경고 기준으로 씁니다. */
export const ROBOT_WIDTH_MM = 40

/** 맵 문서 스키마 버전. 파일의 "schema" 필드와 비교해 상위/하위 버전을 판단합니다(FR-1.10).
 *  스키마를 바꿀 때는 숫자를 올리고, serialize.ts의 마이그레이션 로직도 같이 추가하세요. */
export const SCHEMA_VERSION = 'hamsterS-map/1'

/** 새 맵을 만들 때 기본 열(가로 칸) 개수. PRD 확정 전제: "A4 가로 5×4". */
export const DEFAULT_COLS = 5
/** 새 맵을 만들 때 기본 행(세로 칸) 개수. */
export const DEFAULT_ROWS = 4

/** 사용자 업로드 이미지를 저장할 때 맞추는 최대 한 변 픽셀 수(FR-8.3).
 *  내장 타일(src/assets/tiles)이 50mm를 433px로 담고 있는 것과 같은 해상도라,
 *  업로드 이미지도 이 값으로 맞추면 내장 타일과 나란히 놓아도 화질이 어색하게 갈리지 않습니다.
 *  원본이 이보다 작으면 확대하지 않고 원본 크기(정사각형 크롭 후)를 그대로 씁니다. */
export const USER_ASSET_MAX_PX = 433

/** 용지 규격 한 항목. */
export interface PaperSize {
  /** 용지 id. print.sheet 필드에 그대로 씀(예: "A4") */
  id: string
  /** 화면에 보여줄 이름 */
  label: string
  /** 가로 방향 기준 폭(mm). §6.1: "피치 50mm, 가로 방향 기준" */
  widthMm: number
  /** 가로 방향 기준 높이(mm). 세로로 쓰려면 폭·높이를 서로 바꿔 쓰면 됨(portrait) */
  heightMm: number
}

/** 지원 용지 8종(FR-1.2 프리셋의 근거 표, PRD §6.1).
 *  A4·A3·A2 값은 공식 자료 실측 격자 수(5×4=20 / 8×5=40 / 11×8=88칸)와 정확히
 *  일치하는 값이니 임의로 반올림하거나 조정하지 마세요. B 계열은 JIS 규격(국내 복사기 표준). */
export const PAPER_SIZES: PaperSize[] = [
  { id: 'A4', label: 'A4', widthMm: 297, heightMm: 210 },
  { id: 'B4', label: 'B4', widthMm: 364, heightMm: 257 },
  { id: 'A3', label: 'A3', widthMm: 420, heightMm: 297 },
  { id: 'B3', label: 'B3', widthMm: 515, heightMm: 364 },
  { id: 'A2', label: 'A2', widthMm: 594, heightMm: 420 },
  { id: 'B2', label: 'B2', widthMm: 728, heightMm: 515 },
  { id: 'A1', label: 'A1', widthMm: 841, heightMm: 594 },
  { id: 'A0', label: 'A0', widthMm: 1189, heightMm: 841 },
]
