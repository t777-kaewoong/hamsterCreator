import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Clipboard, Download, MapPin, Route } from 'lucide-react'
import { Button, Modal, Segmented, useToast } from '@/components'
import { createGridAnswer, createLineTracerAnswer } from '@/lib/answer/generateAnswer'
import type { GridAnswer } from '@/lib/answer/generateAnswer'
import { downloadAnswerPdf } from '@/lib/pdf/generateAnswerPdf'
import type { Direction, GoalMarker, MapDoc, NodeCoord } from '@/lib/model/types'
import { useEditorStore } from '@/features/editor/editorStore'
import styles from './AnswerModal.module.css'

type AnswerMode = 'grid' | 'line'

function goalKey(goal: GoalMarker): string {
  return `${goal.cell[0]},${goal.cell[1]}`
}

function PathDiagram({ doc, answer }: { doc: MapDoc; answer: GridAnswer }) {
  const point = ([column, row]: NodeCoord) => `${column + 0.5},${row + 0.5}`
  const headingVector: Record<Direction, NodeCoord> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
  const start = answer.path[0]
  const vector = headingVector[doc.markers.start?.heading ?? 'N']
  return (
    <svg className={styles.pathDiagram} viewBox={`0 0 ${doc.board.cols} ${doc.board.rows}`} role="img" aria-label="최단 경로 도해">
      <rect width={doc.board.cols} height={doc.board.rows} className={styles.paper} />
      {Array.from({ length: doc.board.cols - 1 }, (_, index) => <line key={`c${index}`} x1={index + 1} y1="0" x2={index + 1} y2={doc.board.rows} className={styles.guide} />)}
      {Array.from({ length: doc.board.rows - 1 }, (_, index) => <line key={`r${index}`} x1="0" y1={index + 1} x2={doc.board.cols} y2={index + 1} className={styles.guide} />)}
      {doc.edges.h.map(([column, row]) => <line key={`h${column},${row}`} x1={column + 0.5} y1={row + 0.5} x2={column + 1.5} y2={row + 0.5} className={styles.edge} />)}
      {doc.edges.v.map(([column, row]) => <line key={`v${column},${row}`} x1={column + 0.5} y1={row + 0.5} x2={column + 0.5} y2={row + 1.5} className={styles.edge} />)}
      <polyline points={answer.path.map(point).join(' ')} className={styles.route} />
      <circle cx={start[0] + 0.5} cy={start[1] + 0.5} r="0.17" className={styles.start} />
      <line x1={start[0] + 0.5} y1={start[1] + 0.5} x2={start[0] + 0.5 + vector[0] * 0.3} y2={start[1] + 0.5 + vector[1] * 0.3} className={styles.heading} />
      {answer.goalStops.map((stop, index) => (
        <g key={goalKey(stop.goal)}>
          <circle cx={stop.goal.cell[0] + 0.5} cy={stop.goal.cell[1] + 0.5} r="0.2" className={styles.goal} />
          <text x={stop.goal.cell[0] + 0.5} y={stop.goal.cell[1] + 0.57} textAnchor="middle" className={styles.goalText}>{index + 1}</text>
        </g>
      ))}
    </svg>
  )
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('클립보드에 복사하지 못했습니다')
}

export default function AnswerModal() {
  const open = useEditorStore((state) => state.answerOpen)
  const setOpen = useEditorStore((state) => state.setAnswerOpen)
  const doc = useEditorStore((state) => state.doc)
  const requestFocus = useEditorStore((state) => state.requestFocus)
  const { show } = useToast()
  const [mode, setMode] = useState<AnswerMode>('grid')
  const [goalOrder, setGoalOrder] = useState<string[]>([])
  const [creatingPdf, setCreatingPdf] = useState(false)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open && !wasOpenRef.current && doc) {
      setGoalOrder(doc.markers.goals.map(goalKey))
      setMode('grid')
    }
    wasOpenRef.current = open
  }, [open, doc])

  const orderedGoals = useMemo(() => {
    if (!doc) return []
    const byKey = new Map(doc.markers.goals.map((goal) => [goalKey(goal), goal]))
    return goalOrder.map((key) => byKey.get(key)).filter((goal): goal is GoalMarker => Boolean(goal))
  }, [doc, goalOrder])
  const gridResult = useMemo(() => doc ? createGridAnswer(doc, orderedGoals) : null, [doc, orderedGoals])
  const lineAnswer = useMemo(() => doc ? createLineTracerAnswer(doc) : null, [doc])

  if (!doc || !gridResult) return null
  const currentDoc = doc
  const gridAnswer = gridResult.ok ? gridResult.answer : null
  const gridError = gridResult.ok ? null : gridResult.error
  const modes = [{ value: 'grid', label: `격자 정답${gridResult.ok ? '' : ' · 확인 필요'}` }]
  if (lineAnswer) modes.push({ value: 'line', label: '라인트레이싱' })
  const activeMode = mode === 'line' && lineAnswer ? 'line' : 'grid'
  const activeCode = activeMode === 'line' ? lineAnswer?.pythonCode ?? '' : gridAnswer?.pythonCode ?? ''
  const canExport = Boolean(gridAnswer || lineAnswer)
  const footerSummary = activeMode === 'line' && lineAnswer
    ? `트랙 ${(lineAnswer.lengthMm / 10).toFixed(1)}cm`
    : gridAnswer
      ? `${gridAnswer.moveCount}칸 · 회전 ${gridAnswer.rotationCount}회`
      : '정답 생성 조건을 확인하세요'

  function moveGoal(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= goalOrder.length) return
    const next = [...goalOrder]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    setGoalOrder(next)
  }

  async function handleCopy() {
    if (!activeCode) return
    try {
      await copyText(activeCode)
      show({ message: '코드를 복사했습니다' })
    } catch (error) {
      show({ message: error instanceof Error ? error.message : '코드를 복사하지 못했습니다', tone: 'danger' })
    }
  }

  async function handlePdf() {
    if (!canExport || creatingPdf) return
    setCreatingPdf(true)
    try {
      await downloadAnswerPdf(currentDoc, { grid: gridAnswer, lineTracer: lineAnswer })
      show({ message: '정답지 PDF를 내려받았습니다' })
    } catch (error) {
      show({ message: error instanceof Error ? error.message : '정답지 PDF를 만들지 못했습니다', tone: 'danger' })
    } finally {
      setCreatingPdf(false)
    }
  }

  function focusError() {
    if (!gridError?.at) return
    requestFocus(gridError.at)
    setOpen(false)
  }

  const footer = (
    <div className={styles.footer}>
      <span className="t-caption">{footerSummary}</span>
      <div className={styles.footerActions}>
        <Button variant="ghost" onClick={() => setOpen(false)}>닫기</Button>
        <Button variant="secondary" icon={<Clipboard size={16} />} onClick={handleCopy} disabled={!activeCode}>코드 복사</Button>
        <Button variant="primary" icon={<Download size={16} />} loading={creatingPdf} onClick={handlePdf} disabled={!canExport}>정답지 PDF</Button>
      </div>
    </div>
  )

  return (
    <Modal open={open} onClose={() => !creatingPdf && setOpen(false)} title="정답 생성" width="min(900px, 94vw)" footer={footer}>
      <div className={styles.modalBody}>
        <Segmented options={modes} value={activeMode} onChange={(value) => setMode(value as AnswerMode)} aria-label="정답 종류" />

        {activeMode === 'grid' && (
          <div className={styles.gridLayout}>
            <section className={styles.previewPane}>
              <div className={styles.sectionTitle}><Route size={17} /><h3 className="t-h2">최단 경로</h3></div>
              {gridAnswer ? (
                <>
                  <div className={styles.diagramFrame}><PathDiagram doc={doc} answer={gridAnswer} /></div>
                  <div className={styles.metrics}>
                    <span><strong>{gridAnswer.moveCount}</strong> 이동 칸</span>
                    <span><strong>{gridAnswer.rotationCount}</strong> 회전</span>
                    <span><strong>{gridAnswer.goalStops.length}</strong> 도착점</span>
                  </div>
                </>
              ) : (
                <div className={styles.errorCard} role="alert">
                  <strong>정답을 만들 수 없습니다</strong>
                  <p className="t-body">{gridError?.message}</p>
                  {gridError?.at && <Button variant="secondary" icon={<MapPin size={16} />} onClick={focusError}>캔버스에서 보기</Button>}
                </div>
              )}

              {doc.markers.goals.length > 1 && (
                <div className={styles.goalOrder}>
                  <span className="t-label">도착 경유 순서</span>
                  <ol>
                    {orderedGoals.map((goal, index) => (
                      <li key={goalKey(goal)}>
                        <span className="t-caption"><b>{index + 1}</b> {goal.name || `도착 ${index + 1}`} · {goal.cell[0] + 1}열 {goal.cell[1] + 1}행</span>
                        <span className={styles.orderButtons}>
                          <button type="button" onClick={() => moveGoal(index, -1)} disabled={index === 0} aria-label={`${goal.name} 순서 올리기`}><ArrowUp size={14} /></button>
                          <button type="button" onClick={() => moveGoal(index, 1)} disabled={index === orderedGoals.length - 1} aria-label={`${goal.name} 순서 내리기`}><ArrowDown size={14} /></button>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
            <section className={styles.codePane}>
              <h3 className="t-h2">파이썬 코드</h3>
              {gridAnswer ? <pre>{gridAnswer.pythonCode}</pre> : <p className="t-body">출발점과 도착점을 선으로 연결하면 코드가 여기에 표시됩니다.</p>}
            </section>
          </div>
        )}

        {activeMode === 'line' && lineAnswer && (
          <div className={styles.lineLayout}>
            <section className={styles.lineInfo}>
              <div className={styles.sectionTitle}><Route size={17} /><h3 className="t-h2">라인트레이싱 안내</h3></div>
              <div className={styles.metrics}>
                <span><strong>{lineAnswer.strokeCount}</strong> 트랙</span>
                <span><strong>{(lineAnswer.lengthMm / 10).toFixed(1)}</strong> cm</span>
              </div>
              <p className="t-body">트랙 길이는 화면의 곡선을 따라 계산한 근삿값입니다. 속도와 감도는 인쇄 상태에 맞춰 조정하세요.</p>
            </section>
            <section className={styles.codePane}>
              <h3 className="t-h2">파이썬 템플릿</h3>
              <pre>{lineAnswer.pythonCode}</pre>
            </section>
          </div>
        )}
      </div>
    </Modal>
  )
}
