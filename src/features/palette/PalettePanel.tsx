// 편집기 팔레트 패널 (PRD §9.11 ★핵심).
//
// "이 패널이 제품의 첫인상을 결정합니다. 글자가 아니라 그림이 채워야 합니다"(U2) —
// 그래서 이 컴포넌트는 설명 문구를 거의 안 쓰고, 대신 타일·아이콘·내 이미지를
// 실제 그림으로 꽉 채운 3열 그리드로 보여줍니다.
//
// 검색 입력 → 테마 탭 → 타일 그리드 → (내 이미지 탭일 때만) 이미지 추가 버튼, 순서로
// 위에서 아래로 쌓습니다. 타일/아이콘/내 이미지는 전부 같은 모양(id·name·url)으로 맞춰서
// 하나의 PaletteTile 컴포넌트로 그립니다 — 그리드 코드가 세 벌로 갈라지지 않게 하기 위함입니다.
import { useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Search, Upload, Check } from 'lucide-react'
import { Button, Input, TabPills, Tooltip, useToast } from '@/components'
import type { TabPillOption } from '@/components'
import { TILES, TILES_BY_THEME } from '@/lib/tiles/catalog'
import { ICONS } from '@/lib/icons/catalog'
import { USER_ASSET_MAX_PX } from '@/lib/model/constants'
import type { UserAsset } from '@/lib/model/types'
import { useEditorStore } from '@/features/editor/editorStore'
import styles from './PalettePanel.module.css'

/** 팔레트 그리드 한 칸에 필요한 최소 정보. 내장 타일·인쇄용 아이콘·내 이미지가
 *  전부 이 모양으로 변환되어 같은 PaletteTile로 그려집니다. */
interface PaletteItem {
  /** setStampTile()에 그대로 넘길 값. 내장 타일/아이콘은 원래 id, 내 이미지는 "asset:u1" */
  id: string
  name: string
  url: string
}

/** 테마 탭 목록. 내장 6테마(TILES_BY_THEME 순서 그대로) 뒤에 아이콘·트랙·내 이미지를 붙입니다
 *  (PRD §9.11: "던전·숲·얼음·모험·사탕·공룡·아이콘·트랙·내 이미지"). */
const THEME_TABS: TabPillOption[] = [
  ...TILES_BY_THEME.map((group) => ({ value: group.theme, label: group.themeName })),
  { value: 'icon', label: '아이콘' },
  { value: 'track', label: '트랙' },
  { value: 'myImages', label: '내 이미지' },
]

export default function PalettePanel() {
  const doc = useEditorStore((s) => s.doc)
  const activeTheme = useEditorStore((s) => s.activeTheme)
  const paletteQuery = useEditorStore((s) => s.paletteQuery)
  const stampTileId = useEditorStore((s) => s.stampTileId)
  const setActiveTheme = useEditorStore((s) => s.setActiveTheme)
  const setPaletteQuery = useEditorStore((s) => s.setPaletteQuery)
  const setStampTile = useEditorStore((s) => s.setStampTile)
  const addUserAsset = useEditorStore((s) => s.addUserAsset)
  const { show: showToast } = useToast()

  const fileInputRef = useRef<HTMLInputElement>(null)
  // 드래그 시작 시 커서 옆에 붙일 48px 미리보기 이미지. 화면에는 보이지 않게 숨겨두고
  // dragstart 때마다 src만 바꿔 dataTransfer.setDragImage()에 넘깁니다(PRD §9.11).
  const dragPreviewRef = useRef<HTMLImageElement>(null)
  const [uploading, setUploading] = useState(false)

  const query = paletteQuery.trim().toLowerCase()
  const isSearching = query.length > 0

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

  function handleSelect(item: PaletteItem) {
    setStampTile(item.id)
  }

  function handleDragStart(e: DragEvent<HTMLButtonElement>, item: PaletteItem) {
    // 드롭 처리(캔버스에 실제로 배치하는 것)는 다음 단계 몫이라, 지금은 드래그를
    // 시작하는 순간 곧바로 스탬프를 선택해둡니다 — 사용자 입장에서는 "이 타일을 쓰겠다"는
    // 의사표시가 이미 끝난 상태이니, 나중에 드롭 로직이 생기기 전까지는 이걸로 대신합니다.
    setStampTile(item.id)
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', item.id)
    const preview = dragPreviewRef.current
    if (preview) {
      preview.src = item.url
      e.dataTransfer.setDragImage(preview, 24, 24)
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click()
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
      } catch {
        showToast({ message: `이미지를 불러오지 못했습니다: ${file.name}`, tone: 'danger' })
      }
    }
    setUploading(false)
    // 여러 장을 한꺼번에 올렸으면 마지막 이미지를 바로 스탬프로 선택해, 업로드 직후
    // 바로 찍어볼 수 있게 합니다(FR-8.3 "즉시 팔레트 그리드에 나타나야 함"의 연장).
    if (lastKey) setStampTile(`asset:${lastKey}`)
  }

  const gridContent = renderGridContent()

  return (
    <div className={styles.panel}>
      <div className={styles.searchRow}>
        <Input
          icon={<Search size={16} />}
          placeholder="타일 검색"
          value={paletteQuery}
          onChange={(e) => setPaletteQuery(e.target.value)}
          aria-label="타일 검색"
        />
      </div>

      <div className={styles.tabsRow}>
        <TabPills options={THEME_TABS} value={activeTheme} onChange={setActiveTheme} aria-label="팔레트 테마" />
      </div>

      <div className={styles.gridArea}>{gridContent}</div>

      {!isSearching && activeTheme === 'myImages' && (
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
          {searchResults.map((item) => (
            <PaletteTile
              key={item.id}
              item={item}
              selected={stampTileId === item.id}
              onSelect={handleSelect}
              onDragStart={handleDragStart}
            />
          ))}
        </div>
      )
    }

    if (activeTheme === 'icon') {
      return (
        <div className={styles.grid}>
          {ICONS.map((icon) => (
            <PaletteTile
              key={icon.id}
              item={{ id: icon.id, name: icon.name, url: icon.url }}
              selected={stampTileId === icon.id}
              onSelect={handleSelect}
              onDragStart={handleDragStart}
            />
          ))}
        </div>
      )
    }

    if (activeTheme === 'track') {
      // 라인트레이서 트랙 프리셋(FR-10.7)은 아직 없습니다. 다음 단계에서 채워질 자리입니다.
      return (
        <div className={styles.emptyState}>
          <span className={`${styles.trackNotice} t-caption`}>라인트레이서 트랙은 다음 단계에서 추가됩니다</span>
        </div>
      )
    }

    if (activeTheme === 'myImages') {
      const entries = Object.entries(doc?.userAssets ?? {})
      if (entries.length === 0) {
        return (
          <div className={styles.emptyState}>
            <span className="t-caption">아직 추가한 이미지가 없습니다</span>
          </div>
        )
      }
      return (
        <div className={styles.grid}>
          {entries.map(([key, asset]) => {
            const id = `asset:${key}`
            return (
              <PaletteTile
                key={key}
                item={{ id, name: asset.name, url: asset.dataUrl }}
                selected={stampTileId === id}
                onSelect={handleSelect}
                onDragStart={handleDragStart}
              />
            )
          })}
        </div>
      )
    }

    // 나머지는 내장 6테마(던전·숲·얼음·모험·사탕·공룡) 중 하나입니다.
    const group = TILES_BY_THEME.find((g) => g.theme === activeTheme)
    const tiles = group?.tiles ?? []
    return (
      <div className={styles.grid}>
        {tiles.map((tile) => (
          <PaletteTile
            key={tile.id}
            item={{ id: tile.id, name: tile.name, url: tile.url }}
            selected={stampTileId === tile.id}
            onSelect={handleSelect}
            onDragStart={handleDragStart}
          />
        ))}
      </div>
    )
  }
}

/** 타일 하나. 타일 그리드·아이콘 그리드·내 이미지 그리드가 전부 이 컴포넌트를 재사용합니다.
 *  이름은 화면에 글자로 쓰지 않고 Tooltip으로만 보여줍니다(PRD §9.11 "타일 아래에 이름을
 *  쓰지 않습니다"). */
function PaletteTile({
  item,
  selected,
  onSelect,
  onDragStart,
}: {
  item: PaletteItem
  selected: boolean
  onSelect: (item: PaletteItem) => void
  onDragStart: (e: DragEvent<HTMLButtonElement>, item: PaletteItem) => void
}) {
  return (
    <Tooltip content={item.name}>
      <button
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
