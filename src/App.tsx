// 최상위 화면 컴포넌트.
// 위쪽 절반(M0-2)은 디자인 토큰(tokens.css)이 제대로 정의됐는지 눈으로 확인하는 화면이고,
// 아래쪽 절반(M0-3)은 기본 UI 컴포넌트 8종을 한 페이지에 모아 보여주는 카탈로그입니다.
// 실제 편집기 화면이 아니라 "부품이 PRD §9.7 수치대로 만들어졌는지" 확인하는 용도입니다.
import { useEffect, useMemo, useState } from 'react'
import { Save, Plus, Search, Undo2, Redo2 } from 'lucide-react'
import {
  Button,
  Input,
  Segmented,
  TabPills,
  Tooltip,
  StatusChip,
  Modal,
  useToast,
} from './components'
import type { ButtonVariant, ButtonSize, StatusChipStatus } from './components'
import { DEFAULT_COLS, DEFAULT_ROWS } from './lib/model/constants'
import { createFullGridMap } from './lib/model/factory'
import { serializeMap } from './lib/model/serialize'
import type { MapDoc } from './lib/model/types'
import { createMapStore, UserCancelledError } from './lib/storage'
import type { MapStore } from './lib/storage'
import { isDraftAvailable, saveDraft } from './lib/storage/draft'
import styles from './App.module.css'

// 색 토큰 그룹. value 는 화면에 참고용으로 보여줄 텍스트일 뿐, 실제 스와치 색은
// 항상 인라인 style 의 var(--token) 으로 그립니다(하드코딩 색이 아니라 토큰을 그대로 반영).
type ColorToken = { token: string; value: string }

const neutralColors: ColorToken[] = [
  { token: 'c-bg', value: '#F4F5F7' },
  { token: 'c-surface', value: '#FFFFFF' },
  { token: 'c-surface-2', value: '#FAFAFB' },
  { token: 'c-surface-3', value: '#F0F1F4' },
  { token: 'c-border', value: '#E3E5E9' },
  { token: 'c-border-strong', value: '#C9CDD4' },
  { token: 'c-text', value: '#1A1D21' },
  { token: 'c-text-2', value: '#5B616E' },
  { token: 'c-text-3', value: '#8A909C' },
]

const accentColors: ColorToken[] = [
  { token: 'c-primary', value: '#4F46E5' },
  { token: 'c-primary-hover', value: '#4338CA' },
  { token: 'c-primary-active', value: '#3730A3' },
  { token: 'c-primary-soft', value: '#EEF0FE' },
  { token: 'c-primary-ring', value: 'rgba(79,70,229,.35)' },
]

const semanticColors: ColorToken[] = [
  { token: 'c-danger', value: '#DC2626' },
  { token: 'c-danger-soft', value: '#FEF2F2' },
  { token: 'c-warn', value: '#D97706' },
  { token: 'c-warn-soft', value: '#FEF6E7' },
  { token: 'c-ok', value: '#059669' },
]

const canvasColors: ColorToken[] = [
  { token: 'c-canvas-bg', value: '#E8EAED' },
  { token: 'c-paper', value: '#FFFFFF' },
  { token: 'c-guide', value: '#E5E8EC' },
  { token: 'c-node', value: '#C9CDD4' },
  { token: 'c-hover-cell', value: 'rgba(79,70,229,.08)' },
  { token: 'c-seam', value: '#4F46E5' },
  { token: 'c-warn-zone', value: 'rgba(217,119,6,.15)' },
  { token: 'c-print-black', value: '#000000 (고정)' },
]

const typoRows: { className: string; name: string }[] = [
  { className: 't-display', name: 'display' },
  { className: 't-h1', name: 'h1' },
  { className: 't-h2', name: 'h2' },
  { className: 't-body', name: 'body' },
  { className: 't-label', name: 'label' },
  { className: 't-caption', name: 'caption' },
  { className: 't-micro', name: 'micro' },
]

const radiusTokens = [
  { token: 'r-sm', label: '6px' },
  { token: 'r-md', label: '8px' },
  { token: 'r-lg', label: '12px' },
  { token: 'r-xl', label: '16px' },
  { token: 'r-pill', label: '999px' },
]

const shadowTokens = ['e1', 'e2', 'e3']

const spacingTokens = [
  { token: 'sp-1', label: '4px' },
  { token: 'sp-2', label: '8px' },
  { token: 'sp-3', label: '12px' },
  { token: 'sp-4', label: '16px' },
  { token: 'sp-5', label: '20px' },
  { token: 'sp-6', label: '24px' },
  { token: 'sp-8', label: '32px' },
  { token: 'sp-10', label: '40px' },
  { token: 'sp-12', label: '48px' },
]

// 색 스와치 하나를 그리는 작은 조각. 그룹마다 반복되는 마크업을 줄이기 위한 헬퍼입니다.
function Swatch({ token, value }: ColorToken) {
  return (
    <div className={styles.swatchItem}>
      <div className={styles.swatchBox} style={{ background: `var(--${token})` }} />
      <span className={`${styles.swatchLabel} t-micro`}>
        --{token}
        <br />
        {value}
      </span>
    </div>
  )
}

// ── 여기부터 M0-3 컴포넌트 카탈로그용 데이터 ──────────────────────────

// 버튼 variant 그리드에 쓸 목록. icon은 글자가 없어 별도 줄로 따로 그립니다.
const catalogButtonVariants: { variant: ButtonVariant; label: string }[] = [
  { variant: 'primary', label: '주요' },
  { variant: 'secondary', label: '보조' },
  { variant: 'ghost', label: '고스트' },
  { variant: 'danger', label: '위험' },
]
const catalogButtonSizes: ButtonSize[] = ['sm', 'md', 'lg']

// 세그먼트 예시 2종 (PRD §9.14에 실제로 나오는 선택지를 그대로 씀)
const directionOptions = [
  { value: 'h', label: '가로' },
  { value: 'v', label: '세로' },
]
const sortOptions = [
  { value: 'sheets', label: '장수 최소' },
  { value: 'seams', label: '이음매 최소' },
  { value: 'waste', label: '낭비 최소' },
]

// 탭 필 예시 — PRD §9.11의 팔레트 테마 목록 그대로
const themeTabOptions = [
  { value: 'dungeon', label: '던전' },
  { value: 'forest', label: '숲' },
  { value: 'ice', label: '얼음' },
  { value: 'adventure', label: '모험' },
  { value: 'candy', label: '사탕' },
  { value: 'dino', label: '공룡' },
  { value: 'icon', label: '아이콘' },
  { value: 'track', label: '트랙' },
  { value: 'myImage', label: '내 이미지' },
]

// 상태 칩 예시 3종
const statusChipExamples: StatusChipStatus[] = ['saved', 'saving', 'unsaved']

export default function App() {
  // 카탈로그 데모에 쓸 상태값들. 실제 편집기 로직과는 무관하고, 각 컴포넌트가
  // "값을 받아 화면에 반영하는지"를 눈으로 확인하기 위한 것들입니다.
  const { show } = useToast()
  const [direction, setDirection] = useState('h')
  const [sortKey, setSortKey] = useState('sheets')
  const [theme, setTheme] = useState('dungeon')
  const [cellSize, setCellSize] = useState(25)
  const [columnCount, setColumnCount] = useState(5)
  const [modalOpen, setModalOpen] = useState(false)

  // ── M0-4 저장소 확인용 상태 ──────────────────────────────────────────
  // store는 useState(() => ...)로 딱 한 번만 만듭니다. FsaStore는 파일 핸들을 인스턴스
  // 안에 들고 있어야 덮어쓰기가 되므로, 렌더될 때마다 새로 만들면 안 됩니다.
  const [store] = useState<MapStore>(() => createMapStore())
  const [mapDoc, setMapDoc] = useState<MapDoc | null>(null)
  // localStorage 사용 가능 여부는 페이지 로드 시점에 한 번만 확인하면 충분합니다
  // (실행 중 갑자기 file://로 바뀌지는 않으므로).
  const [draftAvailable] = useState(() => isDraftAvailable())

  // 맵이 바뀔 때마다 초안 자동 저장을 예약합니다(500ms 디바운스는 draft.ts 안에서 처리).
  useEffect(() => {
    if (mapDoc) saveDraft(mapDoc)
  }, [mapDoc])

  const mapStats = useMemo(() => {
    if (!mapDoc) return null
    const json = serializeMap(mapDoc)
    // 한글은 UTF-8로 3바이트라 문자열 길이(length)와 실제 파일 바이트 수가 다릅니다.
    // Blob으로 감싸면 인코딩된 실제 바이트 수를 정확히 잴 수 있습니다.
    const byteSize = new Blob([json]).size
    return {
      title: mapDoc.meta.title || '(제목 없음)',
      cols: mapDoc.board.cols,
      rows: mapDoc.board.rows,
      cellCount: mapDoc.cells.length,
      edgeCount: mapDoc.edges.h.length + mapDoc.edges.v.length,
      byteSize,
    }
  }, [mapDoc])

  function handleNewMap() {
    setMapDoc(createFullGridMap(DEFAULT_COLS, DEFAULT_ROWS, { title: '새 말판' }))
    show({ message: `새 맵을 만들었습니다 (${DEFAULT_COLS}×${DEFAULT_ROWS})` })
  }

  async function handleOpen() {
    try {
      const doc = await store.open()
      setMapDoc(doc)
      show({ message: `"${doc.meta.title || '(제목 없음)'}" 파일을 열었습니다` })
    } catch (err) {
      // 취소는 실패가 아니므로 토스트를 띄우지 않습니다.
      if (err instanceof UserCancelledError) return
      show({ message: `파일을 여는 데 실패했습니다: ${(err as Error).message}`, tone: 'danger' })
    }
  }

  async function handleSave() {
    if (!mapDoc) return
    try {
      await store.save(mapDoc)
      show({ message: store.canOverwrite ? '저장했습니다' : '내려받았습니다' })
    } catch (err) {
      if (err instanceof UserCancelledError) return
      show({ message: `저장에 실패했습니다: ${(err as Error).message}`, tone: 'danger' })
    }
  }

  async function handleSaveAs() {
    if (!mapDoc) return
    try {
      await store.saveAs(mapDoc)
      show({ message: '다른 이름으로 저장했습니다' })
    } catch (err) {
      if (err instanceof UserCancelledError) return
      show({ message: `저장에 실패했습니다: ${(err as Error).message}`, tone: 'danger' })
    }
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={`${styles.title} t-display`}>햄스터S 말판 제작 — 디자인 토큰 확인</h1>
        <p className={`${styles.subtitle} t-body`}>
          M0-2: tokens.css 에 정의한 색·타이포·간격·모서리·그림자 토큰을 눈으로 확인하는 임시 화면입니다.
        </p>
      </header>

      {/* 색 토큰 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>색 — 중립</h2>
        <div className={styles.swatchGrid}>
          {neutralColors.map((c) => (
            <Swatch key={c.token} {...c} />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>색 — 강조 (단일 강조색)</h2>
        <div className={styles.swatchGrid}>
          {accentColors.map((c) => (
            <Swatch key={c.token} {...c} />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>색 — 의미색</h2>
        <div className={styles.swatchGrid}>
          {semanticColors.map((c) => (
            <Swatch key={c.token} {...c} />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>색 — 캔버스 전용</h2>
        <p className={`t-caption`} style={{ color: 'var(--c-text-3)' }}>
          반투명 토큰이 많아 실제 종이(--c-paper) 배경 위에 올려서 보여줍니다.
        </p>
        <div className={`${styles.swatchGrid} ${styles.canvasBacking}`}>
          {canvasColors.map((c) => (
            <Swatch key={c.token} {...c} />
          ))}
          {/* --c-ghost 는 색이 아니라 불투명도(0.55) 값이라 따로 보여줍니다 */}
          <div className={styles.swatchItem}>
            <div className={styles.ghostDemo}>
              <div className={styles.ghostShape} style={{ opacity: 'var(--c-ghost)' }} />
            </div>
            <span className={`${styles.swatchLabel} t-micro`}>
              --c-ghost
              <br />
              opacity 0.55
            </span>
          </div>
        </div>
      </section>

      {/* 타이포그래피 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>타이포그래피 스케일</h2>
        <div className={styles.typoList}>
          {typoRows.map((row) => (
            <div key={row.className} className={styles.typoRow}>
              <span className={`${styles.typoName} t-micro`}>.{row.className}</span>
              <span className={`${styles.typoSample} ${row.className}`}>햄스터S 말판 제작 12345</span>
            </div>
          ))}
        </div>
      </section>

      {/* 모서리 반경 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>모서리 반경</h2>
        <div className={styles.radiusGrid}>
          {radiusTokens.map((r) => (
            <div key={r.token} className={styles.radiusItem}>
              <div className={styles.radiusBox} style={{ borderRadius: `var(--${r.token})` }} />
              <span className={`${styles.radiusLabel} t-micro`}>
                --{r.token} ({r.label})
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 그림자 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>그림자</h2>
        <div className={styles.shadowGrid}>
          {shadowTokens.map((token) => (
            <div key={token} className={styles.shadowItem}>
              <div className={styles.shadowCard} style={{ boxShadow: `var(--${token})` }} />
              <span className={`${styles.shadowLabel} t-micro`}>--{token}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 간격 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>간격 스케일</h2>
        <div className={styles.spacingList}>
          {spacingTokens.map((s) => (
            <div key={s.token} className={styles.spacingRow}>
              <span className={`${styles.spacingName} t-micro`}>--{s.token}</span>
              <div className={styles.spacingBar} style={{ width: `var(--${s.token})` }} />
              <span className={`${styles.spacingValue} t-caption`}>{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          여기서부터 M0-3: 기본 UI 컴포넌트 카탈로그.
          위 토큰들이 실제 컴포넌트(버튼·입력·세그먼트 등)에 어떻게 쓰이는지 모아 보여줍니다.
          ══════════════════════════════════════════════════════════════ */}
      <header className={styles.catalogHeader}>
        <h1 className={`${styles.title} t-display`}>컴포넌트 카탈로그</h1>
        <p className={`${styles.subtitle} t-body`}>
          M0-3: PRD §9.7 명세대로 만든 기본 컴포넌트 8종입니다.
        </p>
      </header>

      {/* 버튼 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>버튼</h2>

        <div className={styles.buttonGrid}>
          {catalogButtonVariants.map(({ variant, label }) => (
            <div key={variant} className={styles.buttonRow}>
              <span className={`${styles.buttonRowLabel} t-caption`}>{label}</span>
              {catalogButtonSizes.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  버튼
                </Button>
              ))}
            </div>
          ))}
          <div className={styles.buttonRow}>
            <span className={`${styles.buttonRowLabel} t-caption`}>아이콘</span>
            {catalogButtonSizes.map((size) => (
              <Button key={size} variant="icon" size={size} icon={<Save size={18} />} aria-label="저장" />
            ))}
          </div>
        </div>

        <h3 className={`${styles.subTitle} t-h2`}>아이콘 + 글자</h3>
        <div className={styles.buttonInline}>
          <Button variant="primary" icon={<Save size={18} />}>
            저장
          </Button>
          <Button variant="secondary" icon={<Plus size={18} />} iconPosition="right">
            추가
          </Button>
        </div>

        <h3 className={`${styles.subTitle} t-h2`}>비활성</h3>
        <div className={styles.buttonInline}>
          {catalogButtonVariants.map(({ variant, label }) => (
            <Button key={variant} variant={variant} disabled>
              {label}
            </Button>
          ))}
          <Button variant="icon" icon={<Save size={18} />} aria-label="저장" disabled />
        </div>

        <h3 className={`${styles.subTitle} t-h2`}>로딩</h3>
        <div className={styles.buttonInline}>
          <Button variant="primary" loading>
            만드는 중…
          </Button>
          <Button variant="danger" loading>
            지우는 중…
          </Button>
        </div>
      </section>

      {/* 입력 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>입력</h2>
        <div className={styles.inputGrid}>
          <Input label="말판 이름" placeholder="예: 우리 반 미로 탐험" />
          <Input
            label="칸 크기"
            unit="mm"
            type="number"
            value={cellSize}
            onChange={(e) => setCellSize(Number(e.target.value))}
            hint="위·아래 화살표로 1씩, Shift+화살표로 10씩"
          />
          <Input label="파일 이름" defaultValue="" error="파일 이름을 입력하세요" />
          <Input
            label="열 개수"
            type="number"
            value={columnCount}
            onChange={(e) => setColumnCount(Number(e.target.value))}
          />
        </div>
      </section>

      {/* 세그먼트 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>세그먼트 컨트롤</h2>
        <div className={styles.inlineControls}>
          <Segmented options={directionOptions} value={direction} onChange={setDirection} aria-label="방향" />
          <Segmented options={sortOptions} value={sortKey} onChange={setSortKey} aria-label="정렬 기준" />
        </div>
      </section>

      {/* 탭 필 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>탭 필</h2>
        <p className="t-caption" style={{ color: 'var(--c-text-3)' }}>
          폭을 좁게 고정해 가로 스크롤과 좌우 페이드를 확인할 수 있게 했습니다.
        </p>
        <div className={styles.tabPillsDemo}>
          <TabPills options={themeTabOptions} value={theme} onChange={setTheme} aria-label="팔레트 테마" />
        </div>
      </section>

      {/* 툴팁 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>툴팁</h2>
        <p className="t-caption" style={{ color: 'var(--c-text-3)' }}>
          마우스를 400ms 이상 올리고 있으면 나타납니다. 상하좌우 배치와 단축키 칩 예시입니다.
        </p>
        <div className={styles.tooltipDemo}>
          <Tooltip content="저장" shortcut="Ctrl+S" placement="top">
            <Button variant="icon" icon={<Save size={18} />} aria-label="저장" />
          </Tooltip>
          <Tooltip content="검색" shortcut="Ctrl+F" placement="right">
            <Button variant="icon" icon={<Search size={18} />} aria-label="검색" />
          </Tooltip>
          <Tooltip content="실행취소" placement="bottom">
            <Button variant="icon" icon={<Undo2 size={18} />} aria-label="실행취소" />
          </Tooltip>
          <Tooltip content="다시 실행" placement="left">
            <Button variant="icon" icon={<Redo2 size={18} />} aria-label="다시 실행" />
          </Tooltip>
        </div>
      </section>

      {/* 상태 칩 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>상태 칩</h2>
        <div className={styles.inlineControls}>
          {statusChipExamples.map((status) => (
            <StatusChip key={status} status={status} />
          ))}
        </div>
      </section>

      {/* 토스트 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>토스트</h2>
        <div className={styles.inlineControls}>
          <Button
            variant="secondary"
            onClick={() =>
              show({
                message: '저장했습니다',
                action: { label: '실행취소', onClick: () => show({ message: '실행취소했습니다' }) },
              })
            }
          >
            기본 토스트 (실행취소 포함)
          </Button>
          <Button variant="danger" onClick={() => show({ message: '저장에 실패했습니다', tone: 'danger' })}>
            오류 토스트
          </Button>
        </div>
      </section>

      {/* 모달 */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>모달</h2>
        <div className={styles.inlineControls}>
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            출력 계획 모달 열기
          </Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="출력 계획"
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                취소
              </Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>
                확인
              </Button>
            </>
          }
        >
          <p className="t-body">
            이 모달은 Esc로 닫히고, 열려 있는 동안 Tab 키가 모달 밖으로 나가지 않습니다. 실제 출력
            계획기(PRD §9.14)는 M2 단계에서 이 Modal 컴포넌트 위에 만들어질 예정입니다.
          </p>
        </Modal>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          여기서부터 M0-4: 저장소 확인.
          맵 파일을 실제로 저장→불러오기 왕복할 수 있는지 눈으로 확인하는 화면입니다
          (FsaStore 덮어쓰기 / DownloadStore 다운로드 폴백이 이 브라우저에서 자동으로 골라짐).
          ══════════════════════════════════════════════════════════════ */}
      <header className={styles.catalogHeader}>
        <h1 className={`${styles.title} t-display`}>저장소 확인</h1>
        <p className={`${styles.subtitle} t-body`}>
          M0-4: 맵 문서(.hsmap.json) 저장·불러오기와 초안 자동 저장이 실제로 동작하는지 확인합니다.
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} t-h2`}>저장소 상태</h2>
        <div className={styles.inlineControls}>
          <StatusChip
            status={store.canOverwrite ? 'saved' : 'unsaved'}
            label={
              store.kind === 'file-overwrite'
                ? '파일 덮어쓰기 가능 (FsaStore)'
                : '다운로드 폴백 (DownloadStore)'
            }
          />
          <StatusChip
            status={draftAvailable ? 'saved' : 'unsaved'}
            label={draftAvailable ? '초안 자동 저장 사용 가능' : '초안 자동 저장 불가 (file:// 등)'}
          />
        </div>

        <div className={styles.buttonInline}>
          <Button variant="secondary" onClick={handleNewMap}>
            새 맵 만들기(5×4)
          </Button>
          <Button variant="secondary" onClick={handleOpen}>
            파일 열기
          </Button>
          <Button variant="secondary" onClick={handleSave} disabled={!mapDoc}>
            저장
          </Button>
          <Button variant="secondary" onClick={handleSaveAs} disabled={!mapDoc}>
            다른 이름으로 저장
          </Button>
        </div>

        {mapStats ? (
          <dl className={styles.mapInfoGrid}>
            <div className={styles.mapInfoRow}>
              <dt className="t-caption">제목</dt>
              <dd className="t-body">{mapStats.title}</dd>
            </div>
            <div className={styles.mapInfoRow}>
              <dt className="t-caption">격자</dt>
              <dd className="t-body t-nums">
                {mapStats.cols} × {mapStats.rows}
              </dd>
            </div>
            <div className={styles.mapInfoRow}>
              <dt className="t-caption">셀 개수</dt>
              <dd className="t-body t-nums">{mapStats.cellCount}</dd>
            </div>
            <div className={styles.mapInfoRow}>
              <dt className="t-caption">켜진 엣지 수</dt>
              <dd className="t-body t-nums">{mapStats.edgeCount}</dd>
            </div>
            <div className={styles.mapInfoRow}>
              <dt className="t-caption">JSON 크기</dt>
              <dd className="t-body t-nums">{mapStats.byteSize.toLocaleString()} bytes</dd>
            </div>
          </dl>
        ) : (
          <p className="t-caption" style={{ color: 'var(--c-text-3)' }}>
            아직 맵이 없습니다. "새 맵 만들기"를 눌러보세요.
          </p>
        )}
      </section>
    </div>
  )
}
