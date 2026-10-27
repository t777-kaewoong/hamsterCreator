// 편집기 팔레트 패널 (PRD §9.11 ★핵심).
//
// "이 패널이 제품의 첫인상을 결정합니다. 글자가 아니라 그림이 채워야 합니다"(U2) —
// 그래서 이 컴포넌트는 설명 문구를 거의 안 쓰고, 대신 타일·아이콘·내 이미지를
// 실제 그림으로 꽉 채운 3열 그리드로 보여줍니다.
//
// 검색 입력 → 테마 탭 → 타일 그리드 → (내 이미지 탭일 때만) 이미지 추가 버튼, 순서로
// 위에서 아래로 쌓습니다. 타일/아이콘/내 이미지는 전부 같은 모양(id·name·url)으로 맞춰서
// 하나의 PaletteTile 컴포넌트로 그립니다 — 그리드 코드가 세 벌로 갈라지지 않게 하기 위함입니다.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Circle,
  Eraser,
  Flag,
  Grid3x3,
  MapPin,
  MousePointer2,
  PenTool,
  Pencil,
  Pipette,
  RectangleHorizontal,
  Search,
  Slash,
  Spline,
  SquareRoundCorner,
  Stamp,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { Button, Input, Segmented, Tooltip, useToast } from '@/components'
import type { SegmentedOption } from '@/components'
import { TILES, TILES_BY_THEME } from '@/lib/tiles/catalog'
import { ICONS } from '@/lib/icons/catalog'
import { USER_ASSET_MAX_PX } from '@/lib/model/constants'
import { goalDisplayNames, goalMarkerKey } from '@/lib/model/goalNames'
import type { Direction, GoalMarker, MapDoc, MarkerLook, UserAsset } from '@/lib/model/types'
import { OBSTACLE_PRESETS } from '@/lib/model/obstacles'
import { HAMSTER_IMAGE_URL } from '@/lib/markers/hamsterArt'
import { useEditorStore } from '@/features/editor/editorStore'
import type { PenMode, PlaceSnap, ShapeKind, ToolId } from '@/features/editor/editorStore'
import { sampleStroke, strokeBounds } from '@/features/canvas/strokeGeometry'
import { allBoundaryStubs } from '@/lib/model/stubs'
import { addSheetStubs, clearSheet, fillSheetEdges, sheetRegions } from '@/lib/model/sheetLines'
import type { SheetRegion } from '@/lib/model/sheetLines'
import { addLibraryImage, listLibraryImages, removeLibraryImage } from '@/lib/storage/imageLibrary'
import type { LibraryImage } from '@/lib/storage/imageLibrary'
import { TRACK_PRESETS } from './trackPresets'
import type { TrackPreset } from './trackPresets'
import styles from './PalettePanel.module.css'

/** 팔레트 그리드 한 칸에 필요한 최소 정보. 내장 타일·인쇄용 아이콘·내 이미지가
 *  전부 이 모양으로 변환되어 같은 PaletteTile로 그려집니다. */
interface PaletteItem {
  /** setStampTile()에 그대로 넘길 값. 내장 타일/아이콘은 원래 id, 내 이미지는 "asset:u1" */
  id: string
  name: string
  url: string
}

/** 가로 스크롤 대신 한 번에 고를 수 있는 자산 종류 목록. 트랙은 도형 도구 안에 표시합니다.
 *  맨 앞 '전체'가 기본값입니다(docs/06 §2.3) — 처음부터 종류를 고르게 하지 않고 다 보여 줍니다. */
const ASSET_CATEGORIES = [
  { value: 'all', label: '전체' },
  ...TILES_BY_THEME.map((group) => ({ value: group.theme, label: group.themeName })),
  { value: 'icon', label: '아이콘' },
  { value: 'myImages', label: '내 이미지' },
]

// 직선은 펜(P)의 "직선" 모드로 옮겼습니다(docs/06 §2.4). 예전 파일의 직선은 그대로 열립니다.
const SHAPES: { id: ShapeKind; label: string; icon: LucideIcon }[] = [
  { id: 'circle', label: '원', icon: Circle },
  { id: 'ellipse', label: '타원', icon: RectangleHorizontal },
  { id: 'roundedRect', label: '라운드 사각', icon: SquareRoundCorner },
]

const DIRECTIONS: { id: Direction; label: string; icon: LucideIcon }[] = [
  { id: 'N', label: '위', icon: ArrowUp },
  { id: 'E', label: '오른쪽', icon: ArrowRight },
  { id: 'S', label: '아래', icon: ArrowDown },
  { id: 'W', label: '왼쪽', icon: ArrowLeft },
]

/**
 * 도구별 머리글·도움말(docs/04 §3.6). 모든 도구가 이 표 하나로 같은 위치·같은 모양의 머리글을
 * 그립니다. 예전에는 도구마다 머리글 모양이 달라(큰 아이콘 카드가 세로 가운데에 뜨거나, 아이콘
 * 없는 제목만 있거나) 도구를 바꿀 때마다 글자 위치가 튀었습니다.
 * hint는 선택 사항이며, 있으면 패널 아래쪽 회색 상자에 들어갑니다.
 */
const TOOL_HELP: Record<ToolId, { title: string; description: string; hint?: string; icon: LucideIcon }> = {
  stamp: { title: '타일 배치', description: '타일을 고른 뒤 칸을 클릭하거나 드래그하세요.', icon: Stamp },
  marker: { title: '출발·도착·장애물', description: '종류를 고른 뒤 원하는 격자점을 클릭하세요.', icon: Flag },
  shape: { title: '도형', description: '도형을 고르고 캔버스에서 드래그해 크기를 정하세요.', hint: '다 그리면 선택 도구로 바뀌어 바로 옮기거나 크기를 바꿀 수 있어요.', icon: Circle },
  select: { title: '선택', description: '눌러서 고르고, 끌어서 옮기고, 핸들로 크기를 바꿉니다.', icon: MousePointer2 },
  lineDraw: { title: '격자선 긋기', description: '격자점 사이를 드래그해 로봇이 칸 단위로 다니는 길을 잇습니다.', hint: '정답 코드는 이 선을 따라 계산해요. 격자 바깥을 클릭하면 경계 진입로가 생깁니다. Alt는 지우기.', icon: Grid3x3 },
  eyedropper: { title: '타일 집기', description: '캔버스에 놓인 타일을 클릭해 같은 타일을 가져옵니다.', hint: '타일을 집으면 자동으로 타일 배치 도구로 바뀝니다.', icon: Pipette },
  eraser: { title: '지우개', description: '빨갛게 보이는 것을 누르거나 문질러 지웁니다.', hint: '격자선은 한 토막씩 지워져요. + 모양의 왼쪽 팔을 누르면 ㅏ 모양이 됩니다. 끌면 처음 누른 것과 같은 종류만 지워요.', icon: Eraser },
  text: { title: '글자', description: '글자를 넣을 위치를 클릭한 뒤 바로 입력합니다.', hint: '입력 후 오른쪽 선택 항목에서 크기·색·회전을 바꿀 수 있어요.', icon: Type },
  pen: { title: '펜', description: '클릭한 점을 직선이나 곡선으로 잇습니다. 아무 데나 긋는 트랙 선이에요.', icon: PenTool },
  // 자유 그리기는 펜의 "자유" 모드라 머리글도 펜과 같습니다(docs/08 §3.2).
  freeDraw: { title: '펜', description: '클릭한 점을 직선이나 곡선으로 잇거나, 끈 궤적대로 그립니다.', icon: PenTool },
}

/** 키 칩 + 짧은 설명 한 줄(docs/06 §3.3). keys가 여럿이면 "+"로 잇습니다. */
interface KeyHint {
  keys: string[]
  text: string
}

const STAMP_KEYS: KeyHint[] = [
  { keys: ['클릭·드래그'], text: '칸에 칠하기' },
  { keys: ['Shift', '드래그'], text: '사각 영역 채우기' },
  { keys: ['Alt'], text: '이번만 자유 자리에 놓기' },
  { keys: ['R'], text: '회전 · F 좌우 반전' },
  { keys: ['우클릭'], text: '같은 타일 다시 찍기' },
]
const PEN_KEYS: KeyHint[] = [
  { keys: ['Enter'], text: '완료 (더블클릭도 됨)' },
  { keys: ['Esc'], text: '취소 · Backspace 한 점 지우기' },
  { keys: ['Shift'], text: '45° 단위로 반듯하게' },
  { keys: ['Alt'], text: '격자점에 붙지 않기 (직선)' },
]
const SELECT_KEYS: KeyHint[] = [
  { keys: ['끌기'], text: '옮기기 (출발·도착도 자유롭게)' },
  { keys: ['핸들'], text: '크기 바꾸기 · Shift 비율 유지' },
  { keys: ['Ctrl', '끌기'], text: '복제해서 옮기기' },
  { keys: ['Ctrl', 'C'], text: '복사' },
  { keys: ['Ctrl', 'V'], text: '붙여넣기 (커서 자리)' },
  { keys: ['Ctrl', 'D'], text: '바로 옆에 복제' },
  { keys: ['Delete'], text: '지우기' },
]
const SHAPE_KEYS: KeyHint[] = [{ keys: ['Shift'], text: '정원 · 정사각' }]
const MARKER_KEYS: KeyHint[] = [
  { keys: ['Alt', '클릭'], text: '격자점 붙이기를 이번만 반대로' },
  { keys: ['V', '끌기'], text: '선택 도구로 놓은 것을 자유롭게 옮기기' },
]

/** 타일을 놓는 자리(docs/09 §2.1). 반 칸 = 25mm 격자점이라 선·칸 경계에 정확히 반 걸칩니다. */
const PLACE_OPTIONS: SegmentedOption[] = [
  { value: 'cell', label: '칸' },
  { value: 'half', label: '반 칸' },
  { value: 'free', label: '자유' },
]

const PEN_MODES: { id: PenMode; label: string; icon: LucideIcon }[] = [
  { id: 'line', label: '직선', icon: Slash },
  { id: 'curve', label: '곡선', icon: Spline },
  { id: 'free', label: '자유', icon: Pencil },
]
const FREE_KEYS: KeyHint[] = [{ keys: ['끌기'], text: '끈 궤적대로 선 하나' }]

/** 코치 마크는 앱을 다시 열어도 되풀이하지 않습니다(§9.15). 초안 저장 키와 분리해,
 *  초안을 지우거나 새 맵을 만들어도 이미 배운 안내가 다시 나타나지 않게 합니다. */
const COACH_MARK_STORAGE_KEY = 'hamsterS.coach.tilePlaced.v1'

/**
 * 한 글자마다 실행취소 기록을 쌓지 않고, 입력을 마쳤을 때 이름 변경 한 번만 저장합니다.
 * 위치를 키로 다시 찾으므로 다른 도착지가 추가·삭제되어 배열 순서가 바뀌어도 엉뚱한
 * 도착점을 수정하지 않습니다.
 */
function GoalNameField({ goal, displayName }: { goal: GoalMarker; displayName: string }) {
  const [draft, setDraft] = useState(goal.name)
  const cancelBlurRef = useRef(false)

  useEffect(() => setDraft(goal.name), [goal.name])

  function commit() {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false
      setDraft(goal.name)
      return
    }

    const nextName = draft.trim()
    const currentDoc = useEditorStore.getState().doc
    if (!currentDoc) return

    const key = goalMarkerKey(goal)
    const index = currentDoc.markers.goals.findIndex((item) => goalMarkerKey(item) === key)
    if (index < 0) {
      setDraft(goal.name)
      return
    }

    const currentGoal = currentDoc.markers.goals[index]
    if (currentGoal.name === nextName) {
      setDraft(nextName)
      return
    }

    const goals = currentDoc.markers.goals.slice()
    goals[index] = { ...currentGoal, name: nextName }
    useEditorStore.getState().commitDoc({
      ...currentDoc,
      markers: { ...currentDoc.markers, goals },
    })
    setDraft(nextName)
  }

  return (
    <Input
      label={`${displayName} · ${goal.cell[0] + 1}열 ${goal.cell[1] + 1}행`}
      value={draft}
      placeholder={displayName}
      aria-label={`${displayName} 이름`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          cancelBlurRef.current = true
          setDraft(goal.name)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function shouldShowCoachMark(): boolean {
  try {
    return window.localStorage.getItem(COACH_MARK_STORAGE_KEY) !== '1'
  } catch {
    // file:// 대피로처럼 localStorage가 막힌 환경에서는 현재 화면에서라도 한 번 안내합니다.
    return true
  }
}

function rememberCoachMarkCompleted(): void {
  try {
    window.localStorage.setItem(COACH_MARK_STORAGE_KEY, '1')
  } catch {
    // 저장할 수 없어도 배치 직후 React 상태로 현재 코치 마크는 즉시 숨깁니다.
  }
}

export default function PalettePanel() {
  const doc = useEditorStore((s) => s.doc)
  const activeTool = useEditorStore((s) => s.activeTool)
  const activeShape = useEditorStore((s) => s.activeShape)
  const markerMode = useEditorStore((s) => s.markerMode)
  const markerHeading = useEditorStore((s) => s.markerHeading)
  const activeTheme = useEditorStore((s) => s.activeTheme)
  const paletteQuery = useEditorStore((s) => s.paletteQuery)
  const stampTileId = useEditorStore((s) => s.stampTileId)
  const tilePlacementNonce = useEditorStore((s) => s.tilePlacementNonce)
  const setActiveTheme = useEditorStore((s) => s.setActiveTheme)
  const setPaletteQuery = useEditorStore((s) => s.setPaletteQuery)
  const setStampTile = useEditorStore((s) => s.setStampTile)
  const setShape = useEditorStore((s) => s.setShape)
  const setMarkerMode = useEditorStore((s) => s.setMarkerMode)
  const setMarkerHeading = useEditorStore((s) => s.setMarkerHeading)
  const markerLook = useEditorStore((s) => s.markerLook)
  const obstacleKind = useEditorStore((s) => s.obstacleKind)
  const setObstacleKind = useEditorStore((s) => s.setObstacleKind)
  const startName = useEditorStore((s) => s.startName)
  const goalName = useEditorStore((s) => s.goalName)
  const obstacleName = useEditorStore((s) => s.obstacleName)
  const setPlaceName = useEditorStore((s) => s.setPlaceName)
  const markerSnap = useEditorStore((s) => s.markerSnap)
  const setMarkerSnap = useEditorStore((s) => s.setMarkerSnap)
  const penMode = useEditorStore((s) => s.penMode)
  const setPenMode = useEditorStore((s) => s.setPenMode)
  const mixFill = useEditorStore((s) => s.mixFill)
  const placeSnap = useEditorStore((s) => s.placeSnap)
  const setPlaceSnap = useEditorStore((s) => s.setPlaceSnap)
  const stampUnder = useEditorStore((s) => s.stampUnder)
  const setStampUnder = useEditorStore((s) => s.setStampUnder)
  const shapeSnap = useEditorStore((s) => s.shapeSnap)
  const setShapeSnap = useEditorStore((s) => s.setShapeSnap)
  const setMixFill = useEditorStore((s) => s.setMixFill)
  const addUserAsset = useEditorStore((s) => s.addUserAsset)
  const { show: showToast } = useToast()

  const fileInputRef = useRef<HTMLInputElement>(null)
  // 드래그 시작 시 커서 옆에 붙일 48px 미리보기 이미지. 화면에는 보이지 않게 숨겨두고
  // dragstart 때마다 src만 바꿔 dataTransfer.setDragImage()에 넘깁니다(PRD §9.11).
  const dragPreviewRef = useRef<HTMLImageElement>(null)
  const [uploading, setUploading] = useState(false)
  const [userAssetDragActive, setUserAssetDragActive] = useState(false)
  const [coachMarkVisible, setCoachMarkVisible] = useState(shouldShowCoachMark)
  const goalNames = useMemo(() => goalDisplayNames(doc?.markers.goals ?? []), [doc?.markers.goals])

  useEffect(() => {
    if (!coachMarkVisible || tilePlacementNonce === 0) return
    setCoachMarkVisible(false)
    rememberCoachMarkCompleted()
  }, [coachMarkVisible, tilePlacementNonce])

  const query = paletteQuery.trim().toLowerCase()
  const isSearching = query.length > 0
  const showsAssets = activeTool === 'stamp'
  const activeCategory = ASSET_CATEGORIES.some((category) => category.value === activeTheme) ? activeTheme : 'all'

  // 검색어가 있으면 테마 탭을 무시하고 내장 타일 35종 전체를 이름으로 가로질러 찾습니다
  // (PRD §9.11: "검색어가 있으면 모든 테마를 가로질러 이름으로 필터링").
  const searchResults = useMemo<PaletteItem[]>(() => {
    if (!isSearching) return []
    return TILES.filter((t) => t.name.toLowerCase().includes(query)).map((t) => ({
      id: t.id,
      name: t.name,
      url: t.url,
    }))
  }, [isSearching, query])

  // ── 내 이미지(docs/07 §2.3) ─────────────────────────────────────────────
  // 이 브라우저의 보관함(IndexedDB)과 지금 맵 파일의 userAssets를 합쳐 보여 줍니다.
  const [library, setLibrary] = useState<LibraryImage[]>([])
  function refreshLibrary() {
    void listLibraryImages().then(setLibrary)
  }
  useEffect(refreshLibrary, [])

  /** 맵 파일 이미지(asset:키) + 보관함에만 있는 이미지(lib:id). 같은 그림은 한 번만. */
  const myImageItems = useMemo<PaletteItem[]>(() => {
    const docEntries = Object.entries(doc?.userAssets ?? {})
    const inDoc = new Set(docEntries.map(([, asset]) => asset.dataUrl))
    return [
      ...docEntries.map(([key, asset]) => ({ id: `asset:${key}`, name: asset.name, url: asset.dataUrl })),
      ...library.filter((image) => !inDoc.has(image.dataUrl)).map((image) => ({ id: `lib:${image.id}`, name: image.name, url: image.dataUrl })),
    ]
  }, [doc?.userAssets, library])

  /**
   * 팔레트 항목 id를 실제로 찍을 id로 바꿉니다. 보관함에만 있는 이미지(lib:)는 이 순간 맵 파일에
   * 넣고 그 키(asset:uN)를 돌려줍니다 — 맵 파일 하나만 있으면 다시 그릴 수 있어야 하기 때문입니다(D4).
   */
  function resolveStampId(item: PaletteItem): string {
    if (!item.id.startsWith('lib:')) return item.id
    const image = library.find((candidate) => `lib:${candidate.id}` === item.id)
    const current = useEditorStore.getState().doc
    if (!image || !current) return item.id
    const existing = Object.entries(current.userAssets).find(([, asset]) => asset.dataUrl === image.dataUrl)
    const key = existing ? existing[0] : addUserAsset({ name: image.name, w: image.w, h: image.h, dataUrl: image.dataUrl })
    return key ? `asset:${key}` : item.id
  }

  /** × 버튼: 보관함에서 빼고, 지금 맵에서 쓰지 않는 그림이면 맵 파일에서도 뺍니다(놓인 그림은 그대로). */
  async function handleRemoveMyImage(item: PaletteItem) {
    await removeLibraryImage(item.url)
    refreshLibrary()
    if (!item.id.startsWith('asset:')) return
    const current = useEditorStore.getState().doc
    if (!current) return
    const used = current.cells.some((cell) => cell?.art === item.id) || current.props.some((prop) => prop.asset === item.id)
    if (used) {
      showToast({ message: '맵에 놓인 그림이라 맵 파일에는 남겨 두었습니다. 다음 맵부터 목록에 안 보여요.' })
      return
    }
    const userAssets = { ...current.userAssets }
    delete userAssets[item.id.slice('asset:'.length)]
    useEditorStore.getState().commitDoc({ ...current, userAssets })
    if (useEditorStore.getState().stampTileId === item.id) useEditorStore.setState({ stampTileId: null })
  }

  function handleSelect(item: PaletteItem) {
    setStampTile(resolveStampId(item))
  }

  /**
   * 출발·도착 모양을 고릅니다. 지금 있는 출발(출발 모드) 또는 모든 도착(도착 모드)에도 바로
   * 적용해 "골랐는데 왜 그대로지?"가 없게 합니다. 이후 놓는 것도 이 모양입니다.
   */
  function handleLookSelect(look: MarkerLook) {
    useEditorStore.getState().setMarkerLook(look)
    const current = useEditorStore.getState().doc
    if (!current) return
    const { start, goals } = current.markers
    if (markerMode === 'start' && start && (start.look ?? 'basic') !== look) {
      useEditorStore.getState().commitDoc({ ...current, markers: { ...current.markers, start: { ...start, look } } })
    }
    if (markerMode === 'goal' && goals.some((goal) => (goal.look ?? 'basic') !== look)) {
      useEditorStore.getState().commitDoc({
        ...current,
        markers: { ...current.markers, goals: goals.map((goal) => ({ ...goal, look })) },
      })
    }
  }

  function handleTrackSelect(preset: TrackPreset) {
    const currentDoc = useEditorStore.getState().doc
    if (!currentDoc) return
    const centerX = (currentDoc.board.cols * currentDoc.board.pitch) / 2
    const centerY = (currentDoc.board.rows * currentDoc.board.pitch) / 2
    let sequence = currentDoc.strokes.length + 1
    let strokeId = `track_${preset.id}_${sequence}`
    while (currentDoc.strokes.some((stroke) => stroke.id === strokeId)) {
      sequence += 1
      strokeId = `track_${preset.id}_${sequence}`
    }
    const stroke = preset.create(centerX, centerY, strokeId)
    useEditorStore.getState().commitDoc({ ...currentDoc, strokes: [...currentDoc.strokes, stroke] })
    useEditorStore.getState().setSelection({ kind: 'stroke', id: stroke.id })
    useEditorStore.getState().setTool('select')

    const bounds = strokeBounds(stroke)
    const mapWidth = currentDoc.board.cols * currentDoc.board.pitch
    const mapHeight = currentDoc.board.rows * currentDoc.board.pitch
    const outside = Boolean(
      bounds && (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > mapWidth || bounds.maxY > mapHeight),
    )
    showToast({
      message: outside ? `${preset.name}을 중앙에 배치했지만 일부가 말판 밖에 있습니다` : `${preset.name}을 중앙에 배치했습니다`,
      action: { label: '실행취소', onClick: () => useEditorStore.getState().undo() },
    })
  }

  function handleDragStart(e: DragEvent<HTMLButtonElement>, item: PaletteItem) {
    // 드래그를 시작하는 순간 곧바로 스탬프로 선택해둡니다. 실제 배치는 캔버스 쪽
    // drop 핸들러(toolInteractions.ts의 ToolController.handleDrop)가 dataTransfer에서
    // id를 읽어 처리하지만, 그 사이(dragover) 동안 보여줄 배치 예정 고스트는 브라우저
    // 보안 정책상 dataTransfer.getData()를 못 읽어서(드롭 순간에만 값을 읽을 수 있음)
    // 여기서 미리 스토어에 올려둔 stampTileId를 그대로 씁니다.
    const id = resolveStampId(item)
    setStampTile(id)
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', id)
    const preview = dragPreviewRef.current
    if (preview) {
      preview.src = item.url
      e.dataTransfer.setDragImage(preview, 24, 24)
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function handleUserAssetDragOver(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setUserAssetDragActive(true)
  }

  function handleUserAssetDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setUserAssetDragActive(false)
    void handleFilesSelected(e.dataTransfer.files)
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    let lastKey: string | null = null
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith('image/')) {
        showToast({ message: `이미지 파일이 아닙니다: ${file.name}`, tone: 'danger' })
        continue
      }
      try {
        const asset = await squareCropAndResize(file)
        const key = addUserAsset(asset)
        if (key) lastKey = key
        // 다음 맵에서도 쓰도록 이 브라우저에 보관합니다(막힌 환경이면 조용히 건너뜀).
        await addLibraryImage(asset)
      } catch {
        showToast({ message: `이미지를 불러오지 못했습니다: ${file.name}`, tone: 'danger' })
      }
    }
    setUploading(false)
    refreshLibrary()
    // 여러 장을 한꺼번에 올렸으면 마지막 이미지를 바로 스탬프로 선택해, 업로드 직후
    // 바로 찍어볼 수 있게 합니다(FR-8.3 "즉시 팔레트 그리드에 나타나야 함"의 연장).
    if (lastKey) setStampTile(`asset:${lastKey}`)
  }

  // 격자선 도구에서 고른 종이(docs/09 §2.2). 종이 수가 줄면 마지막 종이로 맞춥니다.
  const [selectedSheet, setSelectedSheet] = useState(0)

  const header = TOOL_HELP[activeTool]
  // 출발·도착·장애물 "붙일 이름" 칸이 지금 모드에서 어느 값을 다루는지.
  const placeNameKey = markerMode === 'start' ? 'startName' : markerMode === 'goal' ? 'goalName' : 'obstacleName'
  const placeNameValue = markerMode === 'start' ? startName : markerMode === 'goal' ? goalName : obstacleName
  const placeNamePlaceholder =
    markerMode === 'start' ? '출발' : markerMode === 'goal' ? '자동 (도착1, 도착2 …)' : (OBSTACLE_PRESETS.find((p) => p.kind === obstacleKind)?.name ?? '')

  return (
    <div className={styles.panel}>
      <ToolHeader icon={header.icon} title={header.title} description={header.description} />
      {showsAssets ? (
        <>
          <div className={styles.searchRow}>
            <Input
              icon={<Search size={16} />}
              placeholder="타일 검색"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              aria-label="타일 검색"
            />
          </div>
          {!isSearching && (
            <div className={styles.categoryRow}>
              <label className="t-label" htmlFor="asset-category">종류</label>
              <select
                id="asset-category"
                className={styles.categorySelect}
                value={activeCategory}
                onChange={(event) => setActiveTheme(event.target.value)}
              >
                {ASSET_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className={styles.gridArea}>{renderGridContent()}</div>
          <div className={styles.stampFooter}>
            {/* 놓는 자리(docs/09 §2.1): 칸 / 반 칸(선에 걸치기) / 자유 */}
            <div className={styles.footerRow}>
              <span className="t-label">놓는 자리</span>
              <Segmented fullWidth options={PLACE_OPTIONS} value={placeSnap} onChange={(v) => setPlaceSnap(v as PlaceSnap)} aria-label="놓는 자리" />
            </div>
            <label className={styles.mixToggle}>
              <input type="checkbox" checked={stampUnder} onChange={(e) => setStampUnder(e.target.checked)} />
              <span className="t-label">선 아래에 깔기</span>
              <span className={`${styles.snapToggleHint} t-caption`}>{stampUnder ? '선이 그림 위로 보여요' : '그림이 선을 덮어요'}</span>
            </label>
            <label className={styles.mixToggle}>
              <input type="checkbox" checked={mixFill} onChange={(e) => setMixFill(e.target.checked)} />
              <span className="t-label">같은 테마 섞어 칠하기</span>
            </label>
            <KeyHints items={STAMP_KEYS} />
          </div>
        </>
      ) : (
        <div className={styles.contextArea}>{renderToolContext()}</div>
      )}

      {showsAssets && !isSearching && activeCategory === 'myImages' && (
        <div className={styles.footer}>
          <Button
            variant="secondary"
            icon={<Upload size={16} />}
            className={styles.footerButton}
            loading={uploading}
            onClick={openFilePicker}
          >
            이미지 추가
          </Button>
        </div>
      )}

      {/* 실제 파일 선택창. 화면에는 안 보이고 위 버튼이 클릭을 대신 전달합니다. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        multiple
        className={styles.hiddenFileInput}
        onChange={(e) => {
          void handleFilesSelected(e.target.files)
          e.target.value = '' // 같은 파일을 연달아 골라도 onChange가 다시 발생하도록 비워둠
        }}
      />
      {/* 드래그 미리보기 전용 숨김 이미지. 화면 밖으로 보내 실제로는 안 보입니다. */}
      <img ref={dragPreviewRef} alt="" className={styles.dragPreview} />
    </div>
  )

  function renderToolContext() {
    if (activeTool === 'marker') {
      return (
        <>
          <div className={`${styles.choiceGrid} ${styles.choiceGrid3}`} role="group" aria-label="놓을 것">
            <ContextChoice icon={Flag} label="출발지" selected={markerMode === 'start'} onClick={() => setMarkerMode('start')} />
            <ContextChoice icon={MapPin} label="도착지" selected={markerMode === 'goal'} onClick={() => setMarkerMode('goal')} />
            <ContextChoice
              art={<ObstacleArt diameter={70} />}
              label="장애물"
              selected={markerMode === 'obstacle'}
              onClick={() => setMarkerMode('obstacle')}
            />
          </div>
          {/* 붙일 이름(docs/08 §3.3): 놓기 전에 이름을 정해 두면 그 이름표로 붙습니다. */}
          <div className={styles.contextSection}>
            <Input
              label="붙일 이름"
              value={placeNameValue}
              placeholder={placeNamePlaceholder}
              aria-label="붙일 이름"
              onChange={(event) => setPlaceName(placeNameKey, event.target.value)}
            />
            <p className={`${styles.goalNameHint} t-caption`}>
              {markerMode === 'goal'
                ? '적은 이름으로 다음 도착지가 붙고, 칸은 다시 비워져요.'
                : markerMode === 'obstacle'
                  ? '같은 이름으로 여러 개를 연달아 붙일 수 있어요. 비우면 종류 이름.'
                  : '비우면 "출발". 놓은 뒤에는 오른쪽 선택 항목에서도 고칠 수 있어요.'}
            </p>
          </div>
          {/* 격자점에 붙일지(docs/07 §2.2). 끄면 칸 경계에 걸쳐 놓을 수 있습니다. Alt는 이번만 반대로. */}
          <label className={`${styles.mixToggle} ${styles.snapToggle}`}>
            <input type="checkbox" checked={markerSnap} onChange={(e) => setMarkerSnap(e.target.checked)} />
            <span className="t-label">격자점에 붙이기</span>
            <span className={`${styles.snapToggleHint} t-caption`}>{markerSnap ? '칸 가운데에 딱 맞춰요' : '누른 자리 그대로 놓여요'}</span>
          </label>
          {markerMode !== 'obstacle' && (
            <div className={styles.contextSection}>
              <h3 className="t-label">모양</h3>
              <div className={styles.directionGrid} role="group" aria-label="마커 모양">
                <ContextChoice
                  art={<MarkerLookArt look="basic" goal={markerMode === 'goal'} />}
                  label="기본"
                  selected={markerLook === 'basic'}
                  onClick={() => handleLookSelect('basic')}
                />
                <ContextChoice
                  art={<MarkerLookArt look="hamster" goal={markerMode === 'goal'} />}
                  label="햄스터"
                  selected={markerLook === 'hamster'}
                  onClick={() => handleLookSelect('hamster')}
                />
              </div>
            </div>
          )}
          {markerMode === 'obstacle' && (
            <div className={styles.contextSection}>
              <h3 className="t-label">장애물 종류</h3>
              <div className={`${styles.choiceGrid} ${styles.choiceGrid3}`} role="group" aria-label="장애물 종류">
                {OBSTACLE_PRESETS.map((preset) => (
                  <ContextChoice
                    key={preset.kind}
                    art={<ObstacleArt diameter={preset.d} />}
                    label={`${preset.name} Ø${preset.d}`}
                    selected={obstacleKind === preset.kind}
                    onClick={() => setObstacleKind(preset.kind)}
                  />
                ))}
              </div>
              <p className={`${styles.goalNameHint} t-caption`}>지름은 놓은 뒤 오른쪽에서 바꿀 수 있어요. 같은 장애물 가운데를 다시 누르면 지워집니다.</p>
            </div>
          )}
          {markerMode === 'start' && (
            <div className={styles.contextSection}>
              <h3 className="t-label">출발 방향</h3>
              <div className={styles.directionGrid} role="group" aria-label="출발 방향">
                {DIRECTIONS.map((direction) => (
                  <ContextChoice
                    key={direction.id}
                    icon={direction.icon}
                    label={direction.label}
                    selected={markerHeading === direction.id}
                    compact
                    onClick={() => setMarkerHeading(direction.id)}
                  />
                ))}
              </div>
            </div>
          )}
          {markerMode === 'goal' && (
            <div className={styles.contextSection}>
              <h3 className="t-label">도착지 이름</h3>
              {doc && doc.markers.goals.length > 0 ? (
                <>
                  <div className={styles.goalNameList}>
                    {doc.markers.goals.map((goal, index) => (
                      <GoalNameField key={goalMarkerKey(goal)} goal={goal} displayName={goalNames[index]} />
                    ))}
                  </div>
                  <p className={`${styles.goalNameHint} t-caption`}>이름을 비워 두면 자동 이름을 사용합니다.</p>
                </>
              ) : (
                <p className={`${styles.goalNameEmpty} t-caption`}>캔버스에 도착지를 놓으면 여기에서 이름을 바꿀 수 있습니다.</p>
              )}
            </div>
          )}
          {markerMode !== 'obstacle' && (
            <p className={`${styles.contextHint} t-caption`}>
              {markerMode === 'goal' ? '도착지는 여러 곳에 놓을 수 있고, 같은 곳을 다시 누르면 삭제됩니다.' : '새 출발지를 놓으면 기존 출발지가 이동합니다.'}
              {' '}칸 경계에 걸쳐 놓아도 정답 코드는 가장 가까운 격자점으로 계산해요.
            </p>
          )}
          <KeyHints items={MARKER_KEYS} />
        </>
      )
    }

    if (activeTool === 'pen' || activeTool === 'freeDraw') {
      return (
        <>
          <div className={`${styles.choiceGrid} ${styles.choiceGrid3}`} role="group" aria-label="펜 모드">
            {PEN_MODES.map((mode) => (
              <ContextChoice key={mode.id} icon={mode.icon} label={mode.label} selected={penMode === mode.id} onClick={() => setPenMode(mode.id)} />
            ))}
          </div>
          <p className={`${styles.contextHint} t-caption`}>
            {penMode === 'line'
              ? '클릭할 때마다 꺾인 직선이 이어집니다. 한 번 끌면 직선 하나. 끝점은 격자점 가까이에서 격자점에 붙어요.'
              : penMode === 'curve'
                ? '클릭한 점들을 부드러운 곡선으로 잇습니다. 완성된 곡선은 선택 도구에서 정점을 고칠 수 있어요.'
                : '캔버스를 끈 궤적대로 트랙을 그립니다. 손떨림은 자동으로 다듬어지고, 선택 도구에서 정점을 고칠 수 있어요.'}
          </p>
          <KeyHints items={penMode === 'free' ? FREE_KEYS : PEN_KEYS} />
        </>
      )
    }

    if (activeTool === 'select') {
      return (
        <>
          <KeyHints items={SELECT_KEYS} first />
          <p className={`${styles.contextHint} t-caption`}>선택한 항목은 오른쪽에서 숫자로도 고칠 수 있어요.</p>
        </>
      )
    }

    if (activeTool === 'shape') {
      return (
        <>
          <div className={styles.choiceGrid} role="group" aria-label="도형 종류">
            {SHAPES.map((shape) => (
              <ContextChoice key={shape.id} icon={shape.icon} label={shape.label} selected={activeShape === shape.id} onClick={() => setShape(shape.id)} />
            ))}
          </div>
          <label className={`${styles.mixToggle} ${styles.snapToggle}`}>
            <input type="checkbox" checked={shapeSnap} onChange={(e) => setShapeSnap(e.target.checked)} />
            <span className="t-label">반 칸 격자에 맞추기</span>
            <span className={`${styles.snapToggleHint} t-caption`}>25mm 단위</span>
          </label>
          <KeyHints items={SHAPE_KEYS} />
          <p className={`${styles.contextHint} t-caption`}>{TOOL_HELP.shape.hint}</p>
          <div className={styles.contextSection}>
            <h3 className="t-label">트랙 프리셋</h3>
            <div className={styles.trackGrid}>
              {TRACK_PRESETS.map((preset) => <TrackPresetTile key={preset.id} preset={preset} onSelect={handleTrackSelect} />)}
            </div>
          </div>
        </>
      )
    }

    if (activeTool === 'lineDraw') {
      // 공식 playbot 말판은 경계 노드마다 진입로가 달려 있습니다. 그걸 하나씩 클릭하면
      // A4 5×4만 해도 18번, A0 23×16이면 78번이라 일괄 버튼을 함께 둡니다(FR-2.4).
      const stubCount = doc ? doc.stubs.length : 0
      const fullCount = doc ? (doc.board.cols + doc.board.rows) * 2 : 0
      // 종이 한 장 단위 일괄 작업(docs/09 §2.2). 종이 번호는 화면의 종이 경계·출력 계획기와 같습니다.
      const sheets = doc ? sheetRegions(doc) : null
      const sheet = sheets ? sheets.regions[Math.min(selectedSheet, sheets.regions.length - 1)] : null
      const applySheet = (make: (current: MapDoc, region: SheetRegion) => Partial<MapDoc>) => {
        const current = useEditorStore.getState().doc
        if (!current || !sheet) return
        useEditorStore.getState().commitDoc({ ...current, ...make(current, sheet) })
      }
      return (
        <>
          <p className={`${styles.contextHint} ${styles.contextHintFirst} t-caption`}>{TOOL_HELP.lineDraw.hint}</p>
          {sheets && sheet && (
            <div className={styles.contextSection}>
              <h3 className="t-label">종이별로 한꺼번에</h3>
              <div
                className={styles.sheetPicker}
                style={{ gridTemplateColumns: `repeat(${sheets.tilesX}, minmax(0, 1fr))` }}
                role="group"
                aria-label="종이 고르기"
              >
                {sheets.regions.map((region, index) => (
                  <button
                    key={region.code}
                    type="button"
                    className={`${styles.sheetChip} ${region.code === sheet.code ? styles.sheetChipSelected : ''} t-micro`}
                    aria-pressed={region.code === sheet.code}
                    onClick={() => setSelectedSheet(index)}
                  >
                    {region.code}
                  </button>
                ))}
              </div>
              <div className={styles.stubActions}>
                <Button variant="secondary" size="sm" onClick={() => applySheet((current, region) => ({ edges: fillSheetEdges(current, region) }))}>
                  격자선 채우기
                </Button>
                <Button variant="secondary" size="sm" onClick={() => applySheet((current, region) => ({ stubs: addSheetStubs(current, region) }))}>
                  진입로 넣기
                </Button>
                <Button variant="ghost" size="sm" onClick={() => applySheet((current, region) => clearSheet(current, region))}>
                  비우기
                </Button>
              </div>
              <p className={`${styles.contextHint} t-caption`}>
                {sheet.code}번 종이({sheet.cols}×{sheet.rows}칸)에만 적용돼요. 진입로는 맵 바깥 테두리에 닿은 곳에만 생깁니다.
              </p>
            </div>
          )}
          <div className={styles.contextSection}>
            <h3 className="t-label">모든 종이 · 경계 진입로</h3>
            <div className={styles.stubActions}>
              <Button
                variant="secondary"
                size="sm"
                disabled={!doc || stubCount >= fullCount}
                onClick={() => {
                  const current = useEditorStore.getState().doc
                  if (!current) return
                  useEditorStore.getState().commitDoc({
                    ...current,
                    stubs: allBoundaryStubs(current.board.cols, current.board.rows),
                  })
                }}
              >
                경계 전체에 넣기
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!doc || stubCount === 0}
                onClick={() => {
                  const current = useEditorStore.getState().doc
                  if (!current) return
                  useEditorStore.getState().commitDoc({ ...current, stubs: [] })
                }}
              >
                모두 빼기
              </Button>
            </div>
            <p className={`${styles.contextHint} t-caption`}>지금 {stubCount}개 놓여 있습니다.</p>
          </div>
        </>
      )
    }

    const help = TOOL_HELP[activeTool]
    if (!help.hint) return null
    return <p className={`${styles.contextHint} ${styles.contextHintFirst} t-caption`}>{help.hint}</p>
  }

  /** 내 이미지 그리드: 올린 이미지들 + 끝의 ＋ 추가 칸(누르거나 파일을 끌어 놓기). */
  function renderMyImageGrid() {
    return (
      <div className={styles.grid}>
        {myImageItems.map((item) => (
          <PaletteTile
            key={item.id}
            item={item}
            selected={stampTileId === item.id}
            onSelect={handleSelect}
            onDragStart={handleDragStart}
            onRemove={(target) => void handleRemoveMyImage(target)}
          />
        ))}
        <div className={styles.tileSlot}>
          <button
            type="button"
            className={`${styles.addImageTile} ${userAssetDragActive ? styles.userImageDropzoneActive : ''}`}
            onClick={openFilePicker}
            onDragOver={handleUserAssetDragOver}
            onDragLeave={() => setUserAssetDragActive(false)}
            onDrop={handleUserAssetDrop}
            aria-label="내 이미지 추가 (파일 선택 또는 끌어 놓기)"
            title="내 이미지 추가 — 파일을 고르거나 여기에 끌어 놓으세요"
          >
            <Upload size={20} aria-hidden="true" />
            <span className="t-micro">{uploading ? '올리는 중' : '추가'}</span>
          </button>
        </div>
      </div>
    )
  }

  function renderGridContent() {
    if (isSearching) {
      if (searchResults.length === 0) {
        return (
          <div className={styles.emptyState}>
            <span className="t-caption">검색 결과가 없습니다</span>
            <Button variant="ghost" size="sm" onClick={() => setPaletteQuery('')}>
              검색 지우기
            </Button>
          </div>
        )
      }
      return (
        <div className={styles.grid}>
          {searchResults.map((item, index) => (
            <PaletteTile
              key={item.id}
              item={item}
              selected={stampTileId === item.id}
              onSelect={handleSelect}
              onDragStart={handleDragStart}
              showCoachMark={coachMarkVisible && index === 0}
            />
          ))}
        </div>
      )
    }

    if (activeCategory === 'all') {
      // '전체': 맨 위에 "내 이미지"(＋ 추가 칸 포함, 항상 보임 — docs/07 §2.3), 그 아래 테마별 소제목 + 그리드.
      // 예전에는 올린 이미지가 없으면 내 이미지 묶음 자체가 안 보여 어디서 올리는지 알 수 없었습니다.
      const sections: { key: string; title: string; items: PaletteItem[] }[] = [
        ...TILES_BY_THEME.map((group) => ({
          key: group.theme,
          title: group.themeName,
          items: group.tiles.map((tile) => ({ id: tile.id, name: tile.name, url: tile.url })),
        })),
        { key: 'icon', title: '아이콘', items: ICONS.map((icon) => ({ id: icon.id, name: icon.name, url: icon.url })) },
      ]
      return (
        <>
          <h3 className={`${styles.gridSectionTitle} t-micro`}>내 이미지</h3>
          {renderMyImageGrid()}
          {sections.map((section, sectionIndex) => (
            <Fragment key={section.key}>
              <h3 className={`${styles.gridSectionTitle} t-micro`}>{section.title}</h3>
              <div className={styles.grid}>
                {section.items.map((item, index) => (
                  <PaletteTile
                    key={item.id}
                    item={item}
                    selected={stampTileId === item.id}
                    onSelect={handleSelect}
                    onDragStart={handleDragStart}
                    showCoachMark={coachMarkVisible && sectionIndex === 0 && index === 0}
                  />
                ))}
              </div>
            </Fragment>
          ))}
        </>
      )
    }

    if (activeCategory === 'icon') {
      return (
        <div className={styles.grid}>
          {ICONS.map((icon, index) => (
            <PaletteTile
              key={icon.id}
              item={{ id: icon.id, name: icon.name, url: icon.url }}
              selected={stampTileId === icon.id}
              onSelect={handleSelect}
              onDragStart={handleDragStart}
              showCoachMark={coachMarkVisible && index === 0}
            />
          ))}
        </div>
      )
    }

    if (activeCategory === 'myImages') {
      return (
        <>
          {renderMyImageGrid()}
          <p className={`${styles.goalNameHint} t-caption`}>
            올린 이미지는 이 브라우저에 보관돼 다른 맵에서도 보여요. 정사각형으로 잘려 타일 한 칸(50mm)에 맞춰집니다.
          </p>
        </>
      )
    }

    // 나머지는 내장 6테마(던전·숲·얼음·모험·사탕·공룡) 중 하나입니다.
    const group = TILES_BY_THEME.find((g) => g.theme === activeCategory)
    const tiles = group?.tiles ?? []
    return (
      <div className={styles.grid}>
        {tiles.map((tile, index) => (
          <PaletteTile
            key={tile.id}
            item={{ id: tile.id, name: tile.name, url: tile.url }}
            selected={stampTileId === tile.id}
            onSelect={handleSelect}
            onDragStart={handleDragStart}
            showCoachMark={coachMarkVisible && index === 0}
          />
        ))}
      </div>
    )
  }
}

/** 모든 도구 공통 머리글: 아이콘 칩 36px + 제목 + 설명 한 줄(docs/04 §3.6). 항상 패널 맨 위. */
function ToolHeader({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className={styles.toolHeader}>
      <span className={styles.toolHeaderIcon} aria-hidden="true">
        <Icon size={20} />
      </span>
      <div className={styles.toolHeaderText}>
        <h2 className="t-h2">{title}</h2>
        <p className="t-caption">{description}</p>
      </div>
    </div>
  )
}

/** 조작법 키 칩 목록(docs/06 §3.3). 긴 문장 대신 "어떤 키 → 무슨 일"을 한 줄씩 보여 줍니다. */
function KeyHints({ items, first = false }: { items: KeyHint[]; first?: boolean }) {
  return (
    <ul className={`${styles.keyHints} ${first ? styles.keyHintsFirst : ''}`}>
      {items.map((item) => (
        <li key={item.keys.join('+') + item.text} className={styles.keyHintRow}>
          <span className={styles.keyHintKeys}>
            {item.keys.map((key, index) => (
              <Fragment key={key}>
                {index > 0 && <span className={`${styles.keyHintPlus} t-micro`}>+</span>}
                <kbd className={`${styles.keyCap} t-micro`}>{key}</kbd>
              </Fragment>
            ))}
          </span>
          <span className={`${styles.keyHintText} t-caption`}>{item.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** 장애물 선택 그림: 지름에 비례한 점선 원(가장 큰 종이컵 Ø70이 꽉 차게). */
function ObstacleArt({ diameter }: { diameter: number }) {
  const r = (diameter / 70) * 11
  return (
    <svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true">
      <circle r={r} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2" />
    </svg>
  )
}

/** 마커 모양 선택 그림. 실제로 말판에 찍히는 모양을 줄여서 보여 줍니다. */
function MarkerLookArt({ look, goal }: { look: MarkerLook; goal: boolean }) {
  if (look === 'hamster') {
    return <img src={HAMSTER_IMAGE_URL} width={28} height={29} alt="" aria-hidden="true" className={styles.lookPhoto} />
  }
  return (
    <svg width="28" height="28" viewBox="-20 -20 40 40" aria-hidden="true">
      <circle r="17" fill="#fff" stroke="currentColor" strokeWidth="3" />
      {goal ? <circle r="11" fill="none" stroke="currentColor" strokeWidth="3" /> : <path d="M 0 -11.6 L 4.8 3.7 L -4.8 3.7 Z" fill="currentColor" />}
    </svg>
  )
}

function ContextChoice({
  icon: Icon,
  art,
  label,
  selected,
  onClick,
  compact = false,
}: {
  icon?: LucideIcon
  /** 아이콘 대신 보여 줄 그림(SVG). 실제 모양을 그대로 보여 줘야 하는 선택지에 씁니다. */
  art?: ReactNode
  label: string
  selected: boolean
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      className={`${styles.contextChoice} ${selected ? styles.contextChoiceSelected : ''} ${compact ? styles.contextChoiceCompact : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {art ?? (Icon && <Icon size={compact ? 18 : 24} />)}
      <span className="t-label">{label}</span>
      {selected && <Check size={14} className={styles.choiceCheck} aria-hidden="true" />}
    </button>
  )
}

function TrackPresetTile({ preset, onSelect }: { preset: TrackPreset; onSelect: (preset: TrackPreset) => void }) {
  const stroke = preset.create(0, 0, '__preview__')
  const points = sampleStroke(stroke)
  const minX = Math.min(...points.map(([x]) => x))
  const minY = Math.min(...points.map(([, y]) => y))
  const maxX = Math.max(...points.map(([x]) => x))
  const maxY = Math.max(...points.map(([, y]) => y))
  const padding = 10
  const viewWidth = Math.max(1, maxX - minX)
  const viewHeight = Math.max(1, maxY - minY)
  const viewBox = `${minX - padding} ${minY - padding} ${viewWidth + padding * 2} ${viewHeight + padding * 2}`
  const polyline = points.map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <Tooltip content={preset.name}>
      <button type="button" className={styles.trackTile} aria-label={`${preset.name} 중앙에 배치`} onClick={() => onSelect(preset)}>
        <svg className={styles.trackPreview} viewBox={viewBox} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
          <polyline points={polyline} pathLength="100" />
        </svg>
      </button>
    </Tooltip>
  )
}

/** 타일 하나. 타일 그리드·아이콘 그리드·내 이미지 그리드가 전부 이 컴포넌트를 재사용합니다.
 *  이름은 화면에 글자로 쓰지 않고 Tooltip으로만 보여줍니다(PRD §9.11 "타일 아래에 이름을
 *  쓰지 않습니다"). */
function PaletteTile({
  item,
  selected,
  onSelect,
  onDragStart,
  onRemove,
  showCoachMark = false,
}: {
  item: PaletteItem
  selected: boolean
  onSelect: (item: PaletteItem) => void
  onDragStart: (e: DragEvent<HTMLButtonElement>, item: PaletteItem) => void
  /** 내 이미지에만: 마우스를 올리면 오른쪽 위에 × 버튼(목록에서 빼기). */
  onRemove?: (item: PaletteItem) => void
  showCoachMark?: boolean
}) {
  // 타일 집기(I)로 고른 타일이 그리드 아래쪽에 있으면 선택 표시가 안 보입니다.
  // 선택되는 순간 그 칸이 보이도록 스크롤합니다(이미 보이면 움직이지 않음).
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) buttonRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div className={styles.tileSlot}>
      <Tooltip content={item.name}>
        <button
          ref={buttonRef}
          type="button"
          className={`${styles.tile} ${selected ? styles.tileSelected : ''}`}
          draggable
          onDragStart={(e) => onDragStart(e, item)}
          onClick={() => onSelect(item)}
          aria-label={item.name}
          aria-pressed={selected}
        >
          <img src={item.url} alt="" className={styles.tileImg} draggable={false} />
          {selected && (
            <span className={styles.badge} aria-hidden="true">
              <Check size={8} strokeWidth={3} />
            </span>
          )}
        </button>
      </Tooltip>
      {onRemove && (
        <button
          type="button"
          className={styles.removeImage}
          aria-label={`${item.name} 목록에서 빼기`}
          title="내 이미지 목록에서 빼기"
          onClick={() => onRemove(item)}
        >
          <X size={12} strokeWidth={3} aria-hidden="true" />
        </button>
      )}
      {showCoachMark && (
        <span className={`${styles.coachMark} t-caption`} role="status">
          타일을 고르고 칸을 클릭하세요
        </span>
      )}
    </div>
  )
}

/**
 * 업로드한 이미지를 정사각형으로 크롭하고 USER_ASSET_MAX_PX 이하로 줄여 base64 데이터
 * URL로 만듭니다(FR-8.3). 맵 파일 하나만 있으면 다시 그릴 수 있어야 한다는 원칙(D4,
 * 자기 완결성) 때문에 서버나 별도 파일 참조 없이 파일 안에 그림 자체를 통째로 넣습니다.
 *
 * 크롭 방식: 원본의 짧은 변을 한 변으로 삼아 가운데를 정사각형으로 잘라냅니다.
 * 그 정사각형이 USER_ASSET_MAX_PX보다 크면 그 크기로 줄이고, 이미 더 작으면(확대하면
 * 화질만 나빠지므로) 원본 크기 그대로 둡니다.
 */
async function squareCropAndResize(file: File): Promise<UserAsset> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    const targetSide = Math.min(side, USER_ASSET_MAX_PX)

    const canvas = document.createElement('canvas')
    canvas.width = targetSide
    canvas.height = targetSide
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('캔버스 2D 컨텍스트를 만들 수 없습니다')
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, targetSide, targetSide)

    return {
      name: file.name,
      w: targetSide,
      h: targetSide,
      dataUrl: canvas.toDataURL('image/png'),
    }
  } finally {
    bitmap.close()
  }
}
