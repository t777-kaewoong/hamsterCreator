// 편집기 화면의 레이아웃 골격 (PRD §9.2).
//
// 상단바 / 도구 레일 / 팔레트 패널 / 캔버스 뷰포트 / 인스펙터, 이렇게 5개 영역을
// CSS Grid 하나로 배치합니다. 실제 크기 숫자는 전부 EditorLayout.module.css의
// --ed-* 변수에 몰아뒀으니, 치수를 바꾸고 싶으면 이 컴포넌트가 아니라 그 CSS 파일만
// 고치면 됩니다.
//
// 팔레트(PalettePanel, §9.11)·캔버스(CanvasViewport, §9.12)·인스펙터(Inspector, §9.13)는
// 전부 이 파일이 아니라 각자의 컴포넌트가 실제 내용을 채웁니다. 이 파일은 그 5개 영역을
// CSS Grid 칸에 배치하고, 팔레트·인스펙터 접기 버튼처럼 "레이아웃 자체"에 속하는 것만
// 직접 다룹니다.
//
// [onBack(M1-5c)] 시작 화면 ↔ 편집기 전환은 App.tsx의 로컬 useState가 관리합니다
// (editorStore에는 손대지 않기로 했습니다 — 다른 작업자가 그 파일을 동시에 고치는 중).
// 이 컴포넌트는 그 상태를 모르고, App.tsx가 내려준 onBack을 그대로 TopBar까지
// 한 단계 전달만 합니다. 실제로 "저장 안 된 변경이 있으면 확인 모달부터" 로직은
// TopBar.tsx가 담당합니다(뒤로가기 버튼이 있는 자리라 그쪽이 자연스럽습니다).
import { useEffect, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, TriangleAlert } from 'lucide-react'
import { Button, Tooltip } from '@/components'
import TopBar from './TopBar'
import ToolRail from './ToolRail'
import Inspector from './Inspector'
import { useMapIssues } from './useMapIssues'
import CanvasViewport from '@/features/canvas/CanvasViewport'
import PalettePanel from '@/features/palette/PalettePanel'
import styles from './EditorLayout.module.css'

/** 이 폭 미만이면 인스펙터를 자동으로 접습니다(PRD §9.2). */
const AUTO_COLLAPSE_INSPECTOR_WIDTH = 1180
/** 이 폭 미만이면 "화면이 좁습니다" 안내 배너를 띄웁니다. 기능은 막지 않습니다(PRD §9.2). */
const MIN_SUPPORTED_WIDTH = 1024

export interface EditorLayoutProps {
  /** 상단바 뒤로가기(ChevronLeft)가 최종 승인됐을 때 호출됩니다. App.tsx가 내려줍니다. */
  onBack: () => void
}

export default function EditorLayout({ onBack }: EditorLayoutProps) {
  const [paletteCollapsed, setPaletteCollapsed] = useState(false)
  // 처음 그릴 때부터 좁은 창이면 바로 접힌 채로 시작합니다(뒤늦게 접히며 깜빡이지 않도록).
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => window.innerWidth < AUTO_COLLAPSE_INSPECTOR_WIDTH,
  )
  const [viewportTooNarrow, setViewportTooNarrow] = useState(() => window.innerWidth < MIN_SUPPORTED_WIDTH)

  // 인스펙터 접기 버튼의 경고 배지(PRD §9.13: "접힌 상태에서 경고가 새로 생기면 접기
  // 버튼에 --c-warn 색 6px 점 배지를 띄우세요")에 쓸 경고 건수입니다. Inspector.tsx의
  // 검증 섹션과 똑같은 validateMap 결과를 봐야 하는데, 여기서 또 validateMap(doc)을
  // 직접 부르면 같은 계산이 두 곳(이 컴포넌트 + Inspector)에서 완전히 따로 돌게 됩니다.
  // useMapIssues 훅으로 계산 자체를 공용화해서, 적어도 "언제 다시 계산할지"(doc이
  // 바뀔 때만) 로직만큼은 한 군데(useMapIssues.ts)에서 관리합니다 — 그 훅의 주석에
  // "그래도 두 컴포넌트가 각자 부르면 계산 자체는 두 번 일어난다"는 트레이드오프를
  // 적어뒀습니다.
  const issues = useMapIssues()
  const warnCount = issues.filter((issue) => issue.severity === 'warn').length

  useEffect(() => {
    function handleResize() {
      const width = window.innerWidth
      // 좁아질 때만 자동으로 접습니다. 사용자가 다시 넓혀도 강제로 펼치지는 않습니다
      // (사용자가 수동으로 접어둔 것과 자동으로 접힌 것을 구분하지 않는 단순한 규칙입니다).
      if (width < AUTO_COLLAPSE_INSPECTOR_WIDTH) setInspectorCollapsed(true)
      setViewportTooNarrow(width < MIN_SUPPORTED_WIDTH)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className={styles.root}>
      {viewportTooNarrow && (
        <div className={styles.narrowBanner} role="status">
          <TriangleAlert size={16} />
          <span className="t-caption">
            화면 폭이 {MIN_SUPPORTED_WIDTH}px보다 좁습니다. 기능은 그대로 쓸 수 있지만 일부 요소가
            좁게 보일 수 있어요.
          </span>
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.topbarArea}>
          <TopBar onBack={onBack} />
        </div>

        <div className={styles.railArea}>
          <ToolRail />
        </div>

        <div className={`${styles.paletteArea} ${paletteCollapsed ? styles.collapsed : ''}`}>
          <PalettePanel />
        </div>

        <div className={styles.canvasArea}>
          <CanvasViewport />

          {/* 팔레트/인스펙터 접기 버튼은 패널 안이 아니라 캔버스 위에 띄웁니다.
              패널을 접으면 폭이 0이 되어 버튼도 같이 사라져 다시 펼 수 없기 때문입니다
              (인스펙터는 PRD §9.13에 명시된 방식이고, 팔레트도 같은 이유로 동일하게 처리했습니다).
              절대 위치(floatLeft/floatRight)는 바깥 div에 주고 Tooltip은 그 안에 둡니다 —
              Tooltip 내부 span도 position:relative라서, Button에 직접 주면 캔버스가 아니라
              그 작은 span 기준으로 위치가 잡혀버립니다. */}
          <div className={styles.floatLeft}>
            <Tooltip content={paletteCollapsed ? '팔레트 펼치기' : '팔레트 접기'} placement="right">
              <Button
                variant="secondary"
                size="sm"
                icon={paletteCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                aria-label={paletteCollapsed ? '팔레트 펼치기' : '팔레트 접기'}
                onClick={() => setPaletteCollapsed((v) => !v)}
              />
            </Tooltip>
          </div>

          <div className={styles.floatRight}>
            <Tooltip content={inspectorCollapsed ? '인스펙터 펼치기' : '인스펙터 접기'} placement="left">
              <Button
                variant="secondary"
                size="sm"
                icon={inspectorCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
                aria-label={inspectorCollapsed ? '인스펙터 펼치기' : '인스펙터 접기'}
                onClick={() => setInspectorCollapsed((v) => !v)}
              />
              {/* 접힌 상태에서만 의미가 있는 배지입니다 — 펼쳐져 있으면 검증 섹션이 이미
                  화면에 보이므로 굳이 버튼에 또 표시할 필요가 없습니다(PRD §9.13). Tooltip이
                  이미 position:relative인 감싸는 span을 만들어주므로(EditorLayout.tsx 파일
                  맨 위 주석 참고), 그 span 안에 Button과 나란히 두면 이 배지의 절대 위치
                  기준점이 자동으로 맞춰집니다. */}
              {inspectorCollapsed && warnCount > 0 && <span className={styles.inspectorWarnBadge} aria-hidden="true" />}
            </Tooltip>
          </div>

          {/* 개발용: 토큰·컴포넌트 카탈로그 화면으로 이동. 눈에 띄지 않도록 캔버스 구석에 작게 둡니다. */}
          <a className={`${styles.devLink} t-caption`} href="?catalog">
            컴포넌트 카탈로그 (개발용)
          </a>
        </div>

        <div className={`${styles.inspectorArea} ${inspectorCollapsed ? styles.collapsed : ''}`}>
          <Inspector />
        </div>
      </div>
    </div>
  )
}
