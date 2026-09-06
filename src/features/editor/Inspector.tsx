// 편집기 인스펙터 (PRD §9.13).
//
// 위에서 아래로 4개 섹션을 쌓습니다: ① 선택 항목(선택된 게 없으면 통째로 숨김)
// ② 맵 설정(격자 크기·피치·선폭) ③ 용지(용지·방향·분할 방식 + 결과 요약)
// ④ 검증(validateMap 결과 목록, 클릭하면 캔버스로 이동).
//
// 값을 바꾸는 모든 조작은 예외 없이 useEditorStore.getState().commitDoc()을 거칩니다
// (작업 지시 명시 — 인스펙터에서의 편집도 실행취소 한 단계로 묶여야 하므로, 도구
// 동작을 담당하는 toolInteractions.ts의 commitDocChange와 같은 자리를 차지합니다).
//
// PalettePanel.tsx와 마찬가지로 컴포넌트가 직접 useEditorStore를 구독합니다(props로
// doc을 한 단계씩 내려받지 않음) — 이 파일 안의 섹션들이 전부 "지금 열린 맵"이라는
// 같은 상태를 보므로, 그때그때 useEditorStore((s) => ...)로 필요한 조각만 꺼내 쓰는
// 편이 중간에 데이터를 계속 실어 나르는 것보다 단순합니다.
import { useEffect, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { CircleAlert, CircleCheck, Trash2, TriangleAlert } from 'lucide-react'
import { Button, Input, Segmented } from '@/components'
import type { SegmentedOption } from '@/components'
import { useEditorStore } from './editorStore'
import { useMapIssues } from './useMapIssues'
import type { Issue } from '@/lib/geometry/validate'
import { PAPER_SIZES, PITCH_MM, LINE_WIDTH_MM } from '@/lib/model/constants'
import { getTile } from '@/lib/tiles/catalog'
import { getIcon } from '@/lib/icons/catalog'
import { resizeMapDoc } from '@/lib/model/resize'
import { findPrintPlan } from '@/lib/print/plan'
import type { Cell, Label, MapDoc, NodeCoord, PrintConfig, Prop, Stroke } from '@/lib/model/types'
import styles from './Inspector.module.css'

export default function Inspector() {
  return (
    <div className={styles.panel}>
      <SelectionSection />
      <MapSettingsSection />
      <PaperSection />
      <ValidationSection />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// 공용 UI 조각
// ────────────────────────────────────────────────────────────────────────

const ROTATION_OPTIONS: SegmentedOption[] = [
  { value: '0', label: '0°' },
  { value: '90', label: '90°' },
  { value: '180', label: '180°' },
  { value: '270', label: '270°' },
]

/**
 * 켬/끔 스위치 하나.
 *
 * [왜 새로 만들었는가] components/ 목록(Button·Input·Segmented·TabPills·Tooltip·
 * StatusChip·Toast·Modal)에 토글/스위치 종류가 없습니다. 그런데 §9.13은 "좌우 반전",
 * "선 위 흰 글씨", "닫힌 경로" 세 곳에서 토글을 요구합니다. Button을 억지로 두 상태를
 * 흉내 내게 쓰기보다(예: variant를 껐다 켰다) 작은 스위치를 이 파일 전용으로 하나
 * 만들었습니다 — 다른 화면에서도 필요해지면 그때 components/로 승격하면 됩니다.
 */
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className={styles.field}>
      <span className="t-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.toggleThumb} />
      </button>
    </div>
  )
}

/** cell.art / prop.asset 값("dungeon/xxx", "icon/xxx", "asset:u1")에서 사람이 읽을 이름을
 *  찾습니다. 내장 타일·아이콘·사용자 이미지 세 카탈로그를 전부 뒤져야 해서 여기 모아둠. */
function resolveAssetName(doc: MapDoc, assetId: string): string {
  if (assetId.startsWith('asset:')) {
    const key = assetId.slice('asset:'.length)
    return doc.userAssets[key]?.name ?? assetId
  }
  return getTile(assetId)?.name ?? getIcon(assetId)?.name ?? assetId
}

// ────────────────────────────────────────────────────────────────────────
// ① 선택 항목
// ────────────────────────────────────────────────────────────────────────

function SelectionSection() {
  const doc = useEditorStore((s) => s.doc)
  const selection = useEditorStore((s) => s.selection)

  // PRD §9.13: "아무것도 선택되지 않았으면 이 섹션을 통째로 숨깁니다." 제목(h2)도
  // 같이 숨기므로 이 함수 자체가 아무것도 렌더하지 않습니다.
  if (!doc || !selection) return null

  if (selection.kind === 'cell') return <CellFields doc={doc} index={selection.index} />
  if (selection.kind === 'prop') return <PropFields doc={doc} index={selection.index} />
  if (selection.kind === 'label') return <LabelFields doc={doc} index={selection.index} />
  return <StrokeFields doc={doc} id={selection.id} />
}

function CellFields({ doc, index }: { doc: MapDoc; index: number }) {
  const cell = doc.cells[index]
  // 이론상 selection.kind==='cell'이면 그 칸에는 항상 타일이 있어야 합니다(hitTest.ts가
  // 빈 칸은 애초에 선택으로 치지 않으므로). 그래도 다른 조작이 그 사이 칸을 지워버렸을
  // 가능성에 대비해 방어적으로 처리합니다.
  if (!cell) return null

  const name = resolveAssetName(doc, cell.art)

  function updateCell(patch: Partial<Cell>) {
    if (!cell) return
    const nextCells = doc.cells.slice()
    nextCells[index] = { ...cell, ...patch }
    useEditorStore.getState().commitDoc({ ...doc, cells: nextCells })
  }

  function handleDelete() {
    const nextCells = doc.cells.slice()
    nextCells[index] = null
    useEditorStore.getState().commitDoc({ ...doc, cells: nextCells })
    // editorStore.ts의 Selection 타입 주석: 삭제 뒤엔 항상 selection을 null로 되돌립니다.
    useEditorStore.getState().setSelection(null)
  }

  return (
    <section className={styles.section}>
      <h2 className={`${styles.sectionTitle} t-h2`}>선택 항목</h2>
      <div className={styles.sectionBody}>
        <p className={`${styles.itemName} t-caption`}>{name}</p>
        <div className={styles.field}>
          <span className="t-label">회전</span>
          <Segmented
            options={ROTATION_OPTIONS}
            value={String(cell.rot)}
            onChange={(v) => updateCell({ rot: Number(v) as 0 | 90 | 180 | 270 })}
            aria-label="타일 회전"
          />
        </div>
        <ToggleRow label="좌우 반전" checked={cell.flip} onChange={(v) => updateCell({ flip: v })} />
        <Button variant="ghost" className={styles.deleteButton} icon={<Trash2 size={16} />} onClick={handleDelete}>
          삭제
        </Button>
      </div>
    </section>
  )
}

function PropFields({ doc, index }: { doc: MapDoc; index: number }) {
  const prop = doc.props[index]
  if (!prop) return null

  const name = resolveAssetName(doc, prop.asset)

  function updateProp(patch: Partial<Prop>) {
    if (!prop) return
    const nextProps = doc.props.slice()
    nextProps[index] = { ...prop, ...patch }
    useEditorStore.getState().commitDoc({ ...doc, props: nextProps })
  }

  function numberField(field: 'x' | 'y' | 'w' | 'h') {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value)
      if (Number.isNaN(value)) return // 입력창이 잠깐 비었을 때(전체 삭제 중) 반영을 건너뜀
      updateProp({ [field]: value })
    }
  }

  function handleDelete() {
    const nextProps = doc.props.slice()
    nextProps.splice(index, 1)
    useEditorStore.getState().commitDoc({ ...doc, props: nextProps })
    useEditorStore.getState().setSelection(null)
  }

  return (
    <section className={styles.section}>
      <h2 className={`${styles.sectionTitle} t-h2`}>선택 항목</h2>
      <div className={styles.sectionBody}>
        <p className={`${styles.itemName} t-caption`}>{name}</p>
        <div className={styles.grid2}>
          <Input label="X" unit="mm" type="number" value={prop.x} onChange={numberField('x')} />
          <Input label="Y" unit="mm" type="number" value={prop.y} onChange={numberField('y')} />
          <Input label="너비" unit="mm" type="number" value={prop.w} onChange={numberField('w')} />
          <Input label="높이" unit="mm" type="number" value={prop.h} onChange={numberField('h')} />
        </div>
        <Input
          label="회전"
          unit="°"
          type="number"
          value={prop.rot}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (!Number.isNaN(value)) updateProp({ rot: value })
          }}
        />
        <Button variant="ghost" className={styles.deleteButton} icon={<Trash2 size={16} />} onClick={handleDelete}>
          삭제
        </Button>
      </div>
    </section>
  )
}

/** PRD §9.13 라벨 색 스와치 6종. PRD가 정확한 색을 정하지 않아 이 파일에서 임의로
 *  골랐습니다 — 근거는 "인쇄를 전제로 한다"는 작업 지시입니다.
 *
 *  검정 계열 1종은 반드시 포함해야 하고, 나머지는 흑백 복사에서도 서로 구분되도록
 *  명도(밝기)가 벌어져야 합니다. 흑백 사본에서는 색상(hue)이 사라지고 밝기만 남으므로,
 *  ITU-R BT.601 휘도 공식(Y = 0.299R + 0.587G + 0.114B, 0~255)으로 각 색의 "흑백
 *  사본에서 보일 밝기"를 계산해 6종이 대략 균등한 간격(약 35~45)으로 벌어지도록 골랐습니다:
 *   검정 #000000(Y=0) → 남색 #0D2A66(Y≈40) → 빨강 #C1272D(Y≈86) →
 *   초록 #2E9E5B(Y≈117) → 주황 #E08E23(Y≈154) → 회색 #BEBEBE(Y≈190).
 *  마지막 회색은 흰 종이(Y=255)와도 충분히 구분되도록 190에서 멈췄습니다(255에 너무
 *  가까우면 흑백 인쇄에서 거의 안 보이는 흐린 글자가 됩니다). */
const LABEL_COLOR_SWATCHES: { value: string; name: string }[] = [
  { value: '#000000', name: '검정' },
  { value: '#0D2A66', name: '남색' },
  { value: '#C1272D', name: '빨강' },
  { value: '#2E9E5B', name: '초록' },
  { value: '#E08E23', name: '주황' },
  { value: '#BEBEBE', name: '회색' },
]

function LabelFields({ doc, index }: { doc: MapDoc; index: number }) {
  const label = doc.labels[index]
  if (!label) return null

  function updateLabel(patch: Partial<Label>) {
    if (!label) return
    const nextLabels = doc.labels.slice()
    nextLabels[index] = { ...label, ...patch }
    useEditorStore.getState().commitDoc({ ...doc, labels: nextLabels })
  }

  // [삭제 버튼이 없는 이유] PRD §9.13 원문이 라벨 섹션에 나열한 필드는 "텍스트 입력,
  // 크기(mm), 색(스와치 6종+사용자 지정), 선 위 흰 글씨 토글, 회전"뿐이고 삭제는 없습니다
  // (cell/prop/stroke 섹션에는 전부 "삭제"가 명시되어 있는 것과 대조됩니다 — PRD의 의도적인
  // 차이로 보고 그대로 따랐습니다). 라벨을 지우고 싶으면 기존처럼 V로 선택 후 Delete/
  // Backspace 키를 쓰면 됩니다(toolInteractions.ts의 deleteSelection이 이미 처리).

  return (
    <section className={styles.section}>
      <h2 className={`${styles.sectionTitle} t-h2`}>선택 항목</h2>
      <div className={styles.sectionBody}>
        <Input label="텍스트" value={label.text} onChange={(e) => updateLabel({ text: e.target.value })} />
        <Input
          label="크기"
          unit="mm"
          type="number"
          value={label.size}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (!Number.isNaN(value)) updateLabel({ size: value })
          }}
        />
        <div className={styles.field}>
          <span className="t-label">색</span>
          <div className={styles.swatchRow}>
            {LABEL_COLOR_SWATCHES.map((sw) => (
              <button
                key={sw.value}
                type="button"
                className={`${styles.swatch} ${label.color.toLowerCase() === sw.value.toLowerCase() ? styles.swatchSelected : ''}`}
                style={{ background: sw.value }}
                title={sw.name}
                aria-label={sw.name}
                onClick={() => updateLabel({ color: sw.value })}
              />
            ))}
            <input
              type="color"
              className={styles.customSwatch}
              value={/^#[0-9a-fA-F]{6}$/.test(label.color) ? label.color : '#000000'}
              onChange={(e) => updateLabel({ color: e.target.value })}
              title="사용자 지정 색"
              aria-label="사용자 지정 색"
            />
          </div>
        </div>
        <ToggleRow label="선 위 흰 글씨" checked={label.onLine} onChange={(v) => updateLabel({ onLine: v })} />
        <Input
          label="회전"
          unit="°"
          type="number"
          value={label.rot}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (!Number.isNaN(value)) updateLabel({ rot: value })
          }}
        />
      </div>
    </section>
  )
}

const STROKE_KIND_LABELS: Record<Stroke['kind'], string> = {
  spline: '자유 곡선',
  line: '직선',
  circle: '원',
  ellipse: '타원',
  roundedRect: '둥근 사각형',
}

/** stroke의 "총 길이(mm)"를 계산합니다(§9.13 명시).
 *  - spline/line: 정점 사이 거리의 합("경로를 실제로 따라간 길이"). closed면 마지막
 *    점 → 첫 점 구간도 더합니다.
 *  - circle: 원둘레 2πr (정확한 닫힌 식이 있어 근사가 필요 없음).
 *  - ellipse: 타원 둘레는 초등함수로 정확히 못 구해서(타원적분이 필요) 라마누잔의
 *    2차 근사식을 씁니다: C ≈ π[3(a+b) − √((3a+b)(a+3b))]. 오차가 극히 작아(장·단축비가
 *    아무리 극단적이어도 0.04% 미만) 실용적으로 정확한 값으로 취급합니다. */
function computeStrokeLengthMm(stroke: Stroke): number {
  if (stroke.kind === 'circle') return 2 * Math.PI * stroke.r
  if (stroke.kind === 'ellipse') {
    const a = stroke.rx
    const b = stroke.ry
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
  }
  if (stroke.kind === 'roundedRect') {
    const radius = Math.max(0, Math.min(stroke.radius, stroke.w / 2, stroke.h / 2))
    return 2 * (stroke.w + stroke.h - 4 * radius) + 2 * Math.PI * radius
  }
  let total = 0
  for (let i = 1; i < stroke.points.length; i++) {
    const [x0, y0] = stroke.points[i - 1]
    const [x1, y1] = stroke.points[i]
    total += Math.hypot(x1 - x0, y1 - y0)
  }
  if (stroke.kind === 'spline' && stroke.closed && stroke.points.length > 1) {
    const [x0, y0] = stroke.points[stroke.points.length - 1]
    const [x1, y1] = stroke.points[0]
    total += Math.hypot(x1 - x0, y1 - y0)
  }
  return total
}

/**
 * [죽은 코드 안내] 이 섹션은 stroke를 실제로 만드는 도구(펜 P·자유 그리기 D·도형 O,
 * ToolRail.tsx의 CURVE_TOOLS)가 아직 구현되지 않아 실행될 방법이 없습니다 —
 * strokes 배열이 항상 비어 있으므로 selection.kind==='stroke'가 나올 수 없습니다.
 * 그래도 PRD §9.13이 이 UI를 명시적으로 요구하므로, 곡선 도구가 생기는 다음 단계
 * (M1.5 이후)를 위해 미리 만들어 둡니다. 곡선 도구가 실제로 생기면 이 섹션이 그
 * 즉시 살아나 정상적으로 동작해야 합니다(그때 가서 다시 손댈 필요가 없도록
 * MapDoc.strokes/Stroke 타입을 그대로 따라 만들었습니다).
 */
function StrokeFields({ doc, id }: { doc: MapDoc; id: string }) {
  const index = doc.strokes.findIndex((s) => s.id === id)
  const stroke = index >= 0 ? doc.strokes[index] : undefined
  if (!stroke) return null

  function updateStroke(patch: Partial<Stroke>) {
    const nextStrokes = doc.strokes.slice()
    const nextStroke = { ...stroke, ...patch } as Stroke
    if (JSON.stringify(nextStroke) === JSON.stringify(stroke)) return
    nextStrokes[index] = nextStroke
    useEditorStore.getState().commitDoc({ ...doc, strokes: nextStrokes })
  }

  function handleDelete() {
    const nextStrokes = doc.strokes.slice()
    nextStrokes.splice(index, 1)
    useEditorStore.getState().commitDoc({ ...doc, strokes: nextStrokes })
    useEditorStore.getState().setSelection(null)
  }

  const vertexCount = stroke.kind === 'spline' || stroke.kind === 'line' ? stroke.points.length : null
  const lengthMm = computeStrokeLengthMm(stroke)

  return (
    <section className={styles.section}>
      <h2 className={`${styles.sectionTitle} t-h2`}>선택 항목</h2>
      <div className={styles.sectionBody}>
        <p className={`${styles.itemName} t-caption`}>{STROKE_KIND_LABELS[stroke.kind]}</p>
        <DraftNumberInput label="선폭" value={stroke.width} min={0.1} onCommit={(value) => updateStroke({ width: value })} />
        <StrokeParameterFields stroke={stroke} updateStroke={updateStroke} />
        <div className={styles.field}>
          <span className="t-label">정점 수</span>
          <span className="t-body t-nums">{vertexCount ?? '—'}</span>
        </div>
        <div className={styles.field}>
          <span className="t-label">총 길이</span>
          <span className="t-body t-nums">{Math.round(lengthMm)}mm</span>
        </div>
        {(stroke.kind === 'spline' || stroke.kind === 'line') && (
          <p className={`${styles.editHint} t-caption`}>
            정점 드래그 · 경로 더블클릭으로 추가 · 정점 Alt+클릭 또는 Delete로 제거
          </p>
        )}
        {stroke.kind === 'spline' && (
          <ToggleRow label="닫힌 경로" checked={stroke.closed} onChange={(v) => updateStroke({ closed: v })} />
        )}
        <Button variant="ghost" className={styles.deleteButton} icon={<Trash2 size={16} />} onClick={handleDelete}>
          삭제
        </Button>
      </div>
    </section>
  )
}

function DraftNumberInput({
  label,
  value,
  min,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  function commit() {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min)) {
      setDraft(String(value))
      return
    }
    setDraft(String(parsed))
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <Input
      label={label}
      unit="mm"
      type="number"
      min={min}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          setDraft(String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function StrokeParameterFields({
  stroke,
  updateStroke,
}: {
  stroke: Stroke
  updateStroke: (patch: Partial<Stroke>) => void
}) {
  if (stroke.kind === 'spline') return null

  if (stroke.kind === 'line') {
    const start = stroke.points[0] ?? [0, 0]
    const end = stroke.points[1] ?? start
    const updatePoint = (pointIndex: 0 | 1, axis: 0 | 1, value: number) => {
      const points: [number, number][] = [[...start], [...end]]
      points[pointIndex][axis] = value
      updateStroke({ points })
    }
    return (
      <div className={styles.grid2}>
        <DraftNumberInput label="시작 X" value={start[0]} onCommit={(value) => updatePoint(0, 0, value)} />
        <DraftNumberInput label="시작 Y" value={start[1]} onCommit={(value) => updatePoint(0, 1, value)} />
        <DraftNumberInput label="끝 X" value={end[0]} onCommit={(value) => updatePoint(1, 0, value)} />
        <DraftNumberInput label="끝 Y" value={end[1]} onCommit={(value) => updatePoint(1, 1, value)} />
      </div>
    )
  }

  const centerFields = (
    <div className={styles.grid2}>
      <DraftNumberInput label="중심 X" value={stroke.cx} onCommit={(value) => updateStroke({ cx: value })} />
      <DraftNumberInput label="중심 Y" value={stroke.cy} onCommit={(value) => updateStroke({ cy: value })} />
    </div>
  )

  if (stroke.kind === 'circle') {
    return (
      <>
        {centerFields}
        <DraftNumberInput label="직경" value={stroke.r * 2} min={2} onCommit={(value) => updateStroke({ r: value / 2 })} />
      </>
    )
  }

  if (stroke.kind === 'ellipse') {
    return (
      <>
        {centerFields}
        <div className={styles.grid2}>
          <DraftNumberInput label="가로" value={stroke.rx * 2} min={1} onCommit={(value) => updateStroke({ rx: value / 2 })} />
          <DraftNumberInput label="세로" value={stroke.ry * 2} min={1} onCommit={(value) => updateStroke({ ry: value / 2 })} />
        </div>
      </>
    )
  }

  return (
    <>
      {centerFields}
      <div className={styles.grid2}>
        <DraftNumberInput label="가로" value={stroke.w} min={1} onCommit={(value) => updateStroke({ w: value })} />
        <DraftNumberInput label="세로" value={stroke.h} min={1} onCommit={(value) => updateStroke({ h: value })} />
      </div>
      <DraftNumberInput
        label="모서리 반경"
        value={stroke.radius}
        min={0}
        onCommit={(value) => updateStroke({ radius: Math.min(value, stroke.w / 2, stroke.h / 2) })}
      />
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ② 맵 설정
// ────────────────────────────────────────────────────────────────────────

/**
 * 격자 열·행 개수를 바꿉니다(D3: cells 길이 = cols×rows, row-major).
 *
 * [왜 단순히 배열 길이만 맞추면 안 되는가 — 이 작업에서 가장 틀리기 쉬운 부분]
 * cells 배열은 row-major로 저장됩니다: 인덱스 = r*cols + c. 열 개수(cols)가 바뀌면
 * 같은 칸 좌표 (c, r)라도 배열 인덱스 공식 자체가 달라집니다. 예를 들어 5열 맵에서
 * (2, 1)번 칸의 인덱스는 5*1+2=7이지만, 4열로 줄이면 같은 좌표의 인덱스는 4*1+2=6이
 * 됩니다. 그냥 slice(0, 새길이)를 하거나 뒤에 null만 이어붙이면 인덱스 7에 있던 내용이
 * (전혀 다른 칸이 된) 인덱스 7 자리에 그대로 남아, 결과적으로 타일이 엉뚱한 칸으로
 * "밀려" 보입니다. 그래서 새 배열을 (c, r) 좌표 기준으로 처음부터 다시 채웁니다:
 * 각 좌표가 옛 격자 범위 안에 있으면 옛 배열에서 값을 가져오고, 범위 밖(새로 생긴
 * 칸이거나 줄어들며 잘려나간 칸)이면 null입니다. 줄어들 때 잘려나간 칸의 내용은 이
 * 과정에서 자연히 사라집니다(작업 지시서가 명시한 대로 — 새 맵에 그 칸 자체가 없으니
 * 보존할 방법이 없습니다).
 *
 * edges/stubs/markers도 범위를 벗어나는 노드를 참조하면 함께 정리합니다 — 잘려나간
 * 열·행에 붙어있던 선·진입로·출발/도착 지점은 더 이상 존재할 수 없는 자리를 가리키므로
 * 그대로 두면 이후 렌더링·검증 로직이 배열 밖 인덱스를 참조하게 됩니다.
 */
function MapSettingsSection() {
  const doc = useEditorStore((s) => s.doc)

  // 숫자 입력 4개는 전부 "타이핑 중에는 로컬 draft만 바꾸고, 포커스를 벗어나거나
  // Enter를 눌러야 실제로 commitDoc한다"는 방식입니다(TopBar.tsx의 파일명 편집과 같은
  // 패턴). 특히 열·행은 키 하나 누를 때마다 격자 크기를 다시 계산하면("1" 입력 순간
  // 먼저 1칸으로 줄었다가 "10"을 마저 치면 다시 10칸으로 늘어나는) 실행취소 스택에도
  // 매 키 입력이 한 단계씩 쌓여버려 Ctrl+Z가 쓸모없어집니다. 그래서 편집이 "끝났다"고
  // 볼 수 있는 시점(blur/Enter)에만 commitDoc 한 번으로 묶습니다.
  const [colsDraft, setColsDraft] = useState('')
  const [rowsDraft, setRowsDraft] = useState('')
  const [pitchDraft, setPitchDraft] = useState('')
  const [lineWidthDraft, setLineWidthDraft] = useState('')

  useEffect(() => {
    if (!doc) return
    setColsDraft(String(doc.board.cols))
    setRowsDraft(String(doc.board.rows))
    setPitchDraft(String(doc.board.pitch))
    setLineWidthDraft(String(doc.board.lineWidth))
  }, [doc?.board.cols, doc?.board.rows, doc?.board.pitch, doc?.board.lineWidth])

  if (!doc) return null

  // 아래 세 커밋 함수는 전부 useEditorStore.getState().doc으로 "지금 이 순간의 진짜
  // doc"을 다시 읽습니다(위 컴포넌트 스코프의 doc을 그대로 닫혀서 쓰지 않음) —
  // toolInteractions.ts의 여러 메서드와 같은 이유로, blur/Enter 시점에는 항상 최신
  // 문서를 기준으로 계산해야 그 사이 다른 조작(예: 실행취소)이 끼어들어도 어긋나지
  // 않습니다.
  function commitGridSize() {
    const currentDoc = useEditorStore.getState().doc
    if (!currentDoc) return
    const parsedCols = Math.round(Number(colsDraft))
    const parsedRows = Math.round(Number(rowsDraft))
    const nextCols = Number.isFinite(parsedCols) && parsedCols > 0 ? parsedCols : currentDoc.board.cols
    const nextRows = Number.isFinite(parsedRows) && parsedRows > 0 ? parsedRows : currentDoc.board.rows
    setColsDraft(String(nextCols))
    setRowsDraft(String(nextRows))
    if (nextCols === currentDoc.board.cols && nextRows === currentDoc.board.rows) return // 안 바뀌면 실행취소 낭비 없이 종료

    useEditorStore.getState().commitDoc(resizeMapDoc(currentDoc, nextCols, nextRows))

    // cell 선택은 배열 인덱스 기반인데 격자 크기가 바뀌면 인덱스 공식 자체가 달라져
    // 엉뚱한 칸을 가리키게 됩니다(editorStore.ts Selection 타입 주석과 같은 문제).
    // prop·label·stroke 선택은 mm 좌표/고유 id 기반이라 격자 크기와 무관하게 안전합니다.
    if (useEditorStore.getState().selection?.kind === 'cell') useEditorStore.getState().setSelection(null)
  }

  function commitPitch() {
    const currentDoc = useEditorStore.getState().doc
    if (!currentDoc) return
    const value = Number(pitchDraft)
    if (!Number.isFinite(value) || value <= 0) {
      setPitchDraft(String(currentDoc.board.pitch)) // 잘못된 값은 원래 값으로 되돌림
      return
    }
    if (value !== currentDoc.board.pitch) {
      useEditorStore.getState().commitDoc({ ...currentDoc, board: { ...currentDoc.board, pitch: value } })
    }
  }

  function commitLineWidth() {
    const currentDoc = useEditorStore.getState().doc
    if (!currentDoc) return
    const value = Number(lineWidthDraft)
    if (!Number.isFinite(value) || value <= 0) {
      setLineWidthDraft(String(currentDoc.board.lineWidth))
      return
    }
    if (value !== currentDoc.board.lineWidth) {
      useEditorStore.getState().commitDoc({ ...currentDoc, board: { ...currentDoc.board, lineWidth: value } })
    }
  }

  function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const pitchOffSpec = doc.board.pitch !== PITCH_MM
  const lineWidthOffSpec = doc.board.lineWidth !== LINE_WIDTH_MM

  return (
    <section className={styles.section}>
      <h2 className={`${styles.sectionTitle} t-h2`}>맵 설정</h2>
      <div className={styles.sectionBody}>
        <div className={styles.grid2}>
          <Input
            label="열"
            unit="칸"
            type="number"
            value={colsDraft}
            onChange={(e) => setColsDraft(e.target.value)}
            onBlur={commitGridSize}
            onKeyDown={blurOnEnter}
          />
          <Input
            label="행"
            unit="칸"
            type="number"
            value={rowsDraft}
            onChange={(e) => setRowsDraft(e.target.value)}
            onBlur={commitGridSize}
            onKeyDown={blurOnEnter}
          />
        </div>
        <div>
          <Input
            label="피치"
            unit="mm"
            type="number"
            value={pitchDraft}
            onChange={(e) => setPitchDraft(e.target.value)}
            onBlur={commitPitch}
            onKeyDown={blurOnEnter}
          />
          {/* D6: 기본값(50/8mm)에서 벗어나면 경고 한 줄(§9.13, 규칙 D6) */}
          {pitchOffSpec && (
            <p className={`${styles.warnCaption} t-caption`}>기본값 {PITCH_MM}mm과 달라 정품 말판과 어긋날 수 있어요</p>
          )}
        </div>
        <div>
          <Input
            label="선폭"
            unit="mm"
            type="number"
            value={lineWidthDraft}
            onChange={(e) => setLineWidthDraft(e.target.value)}
            onBlur={commitLineWidth}
            onKeyDown={blurOnEnter}
          />
          {lineWidthOffSpec && (
            <p className={`${styles.warnCaption} t-caption`}>기본값 {LINE_WIDTH_MM}mm과 달라 정품 말판과 어긋날 수 있어요</p>
          )}
        </div>
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ③ 용지
// ────────────────────────────────────────────────────────────────────────

/**
 * 용지 요약 한 줄을 계산합니다(§9.13 예시: "A4 가로 4장 · 이음매 4곳").
 *
 * [이 계산이 어림값인 이유] 실제 출력 계획기(§9.14, FR-5)는 여백·재단선·겹치기 폭까지
 * 따져 정교하게 나눕니다(§6.1 표의 "활동면적"이 용지 크기보다 항상 작은 이유이기도
 * 합니다). 여기서는 "대략 몇 장이 필요한지" 감을 주는 용도라, 맵 전체 크기를 용지
 * 크기로 단순히 나눠 올림(ceil)한 값만 씁니다. 출력 계획기가 실제로 만들어지면 이
 * 값과 결과가 달라질 수 있습니다.
 */
function summarizePrintPlan(doc: MapDoc): string {
  const paper = PAPER_SIZES.find((p) => p.id === doc.print.sheet)
  const orientationLabel = doc.print.orientation === 'landscape' ? '가로' : '세로'
  if (!paper) return doc.print.sheet // 목록에 없는 값(사용자 정의 등)은 그대로 보여줌

  if (doc.print.layout === 'single') {
    return `${paper.label} ${orientationLabel} 1장 · 이음매 없음`
  }

  const plan = findPrintPlan(doc)
  if (!plan || plan.sheets <= 1) return `${paper.label} ${orientationLabel} 1장 · 이음매 없음`
  return `${paper.label} ${orientationLabel} ${plan.sheets}장 · 이음매 ${plan.seams}곳`
}

function PaperSection() {
  const doc = useEditorStore((s) => s.doc)
  const setPrintPlannerOpen = useEditorStore((s) => s.setPrintPlannerOpen)

  if (!doc) return null

  function updatePrint(patch: Partial<PrintConfig>) {
    const currentDoc = useEditorStore.getState().doc
    if (!currentDoc) return
    useEditorStore.getState().commitDoc({ ...currentDoc, print: { ...currentDoc.print, ...patch } })
  }

  return (
    <section className={styles.section}>
      <h2 className={`${styles.sectionTitle} t-h2`}>용지</h2>
      <div className={styles.sectionBody}>
        <div className={styles.field}>
          <span className="t-label">용지</span>
          {/* [드롭다운] components/에 전용 Select가 없어 네이티브 <select>를 Input과
              비슷한 높이·테두리로 스타일링해 씁니다(임의 결정 — 커스텀 리스트박스를 새로
              만들 만큼 이 용도가 복잡하지 않다고 판단했습니다). */}
          <select
            className={styles.select}
            value={doc.print.sheet}
            onChange={(e) => updatePrint({ sheet: e.target.value })}
            aria-label="용지"
          >
            {PAPER_SIZES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <span className="t-label">방향</span>
          <Segmented
            options={[
              { value: 'landscape', label: '가로' },
              { value: 'portrait', label: '세로' },
            ]}
            value={doc.print.orientation}
            onChange={(v) => updatePrint({ orientation: v as PrintConfig['orientation'] })}
            aria-label="용지 방향"
          />
        </div>
        <div className={styles.field}>
          <span className="t-label">분할 방식</span>
          <Segmented
            options={[
              { value: 'single', label: '단일장' },
              { value: 'tiled', label: '나눠 인쇄' },
            ]}
            value={doc.print.layout}
            onChange={(v) => updatePrint({ layout: v as PrintConfig['layout'] })}
            aria-label="분할 방식"
          />
        </div>
        <p className={`${styles.summaryLine} t-caption`}>{summarizePrintPlan(doc)}</p>
        <Button variant="ghost" onClick={() => setPrintPlannerOpen(true)}>
          출력 계획기 열기
        </Button>
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ④ 검증
// ────────────────────────────────────────────────────────────────────────

function ValidationSection() {
  const doc = useEditorStore((s) => s.doc)
  const requestFocus = useEditorStore((s) => s.requestFocus)
  const issues = useMapIssues()

  if (!doc) return null

  const hasIssues = issues.length > 0

  return (
    <section className={styles.section}>
      <div className={styles.validationHeader}>
        <h2 className="t-h2">검증</h2>
        {!hasIssues && (
          <span className={`${styles.okBadge} t-caption`}>
            <CircleCheck size={16} />
            문제 없음
          </span>
        )}
      </div>
      {hasIssues && (
        <ul className={styles.issueList}>
          {issues.map((issue, i) => (
            // 같은 code가 여러 번 나올 수 있어(예: 도달 불가 칸이 여러 개) index를 key에
            // 함께 씁니다. 목록 순서 자체가 바뀔 일이 없어 index를 key로 써도 안전합니다.
            <IssueRow key={`${issue.code}-${i}`} issue={issue} onFocus={requestFocus} />
          ))}
        </ul>
      )}
    </section>
  )
}

function IssueRow({ issue, onFocus }: { issue: Issue; onFocus: (node: NodeCoord) => void }) {
  // §9.17 "색 의존 금지": 오류/경고를 색(막대)뿐 아니라 서로 다른 아이콘으로도 구분합니다.
  const Icon = issue.severity === 'error' ? CircleAlert : TriangleAlert
  const clickable = issue.at !== undefined

  return (
    <li
      className={[
        styles.issueRow,
        issue.severity === 'error' ? styles.issueError : styles.issueWarn,
        clickable ? styles.issueClickable : '',
      ]
        .filter(Boolean)
        .join(' ')}
      // Issue.at이 없는 항목(맵 전체 문제)은 클릭해도 아무 일이 없어야 하고 커서도
      // 포인터로 바뀌면 안 됩니다(작업 지시 명시) — onClick 자체를 안 붙이고, role·
      // tabIndex도 안 줘서 클릭도 키보드 포커스도 받지 않게 합니다. cursor:pointer는
      // .issueClickable에서만 CSS로 붙습니다.
      onClick={clickable ? () => onFocus(issue.at!) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onFocus(issue.at!)
              }
            }
          : undefined
      }
    >
      <Icon size={16} className={styles.issueIcon} aria-hidden="true" />
      <span className={`${styles.issueMessage} t-caption`}>{issue.message}</span>
    </li>
  )
}
