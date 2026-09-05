// 편집기 화면의 레이아웃 골격 (PRD §9.2).
//
// 상단바 / 도구 레일 / 팔레트 패널 / 캔버스 뷰포트 / 인스펙터, 이렇게 5개 영역을
// CSS Grid 하나로 배치합니다. 실제 크기 숫자는 전부 EditorLayout.module.css의
// --ed-* 변수에 몰아뒀으니, 치수를 바꾸고 싶으면 이 컴포넌트가 아니라 그 CSS 파일만
// 고치면 됩니다.
//
// 팔레트·인스펙터는 이번 단계에서도 아직 내용이 없는 빈 자리라 안내만 표시합니다.
// 캔버스 자리는 이번 단계(M1-2, §9.12)부터 CanvasViewport가 실제로 채웁니다.
import { useEffect, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, TriangleAlert } from 'lucide-react'
import { Button, Tooltip } from '@/components'
import TopBar from './TopBar'
import ToolRail from './ToolRail'
import CanvasViewport from '@/features/canvas/CanvasViewport'
import styles from './EditorLayout.module.css'

/** 이 폭 미만이면 인스펙터를 자동으로 접습니다(PRD §9.2). */
const AUTO_COLLAPSE_INSPECTOR_WIDTH = 1180
/** 이 폭 미만이면 "화면이 좁습니다" 안내 배너를 띄웁니다. 기능은 막지 않습니다(PRD §9.2). */
const MIN_SUPPORTED_WIDTH = 1024

export default function EditorLayout() {
  const [paletteCollapsed, setPaletteCollapsed] = useState(false)
  // 처음 그릴 때부터 좁은 창이면 바로 접힌 채로 시작합니다(뒤늦게 접히며 깜빡이지 않도록).
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => window.innerWidth < AUTO_COLLAPSE_INSPECTOR_WIDTH,
  )
  const [viewportTooNarrow, setViewportTooNarrow] = useState(() => window.innerWidth < MIN_SUPPORTED_WIDTH)

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
          <TopBar />
        </div>

        <div className={styles.railArea}>
          <ToolRail />
        </div>

        <div className={`${styles.paletteArea} ${paletteCollapsed ? styles.collapsed : ''}`}>
          <Placeholder label="여기는 팔레트입니다 (다음 단계에서 채워집니다)" />
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
            </Tooltip>
          </div>

          {/* 개발용: 토큰·컴포넌트 카탈로그 화면으로 이동. 눈에 띄지 않도록 캔버스 구석에 작게 둡니다. */}
          <a className={`${styles.devLink} t-caption`} href="?catalog">
            컴포넌트 카탈로그 (개발용)
          </a>
        </div>

        <div className={`${styles.inspectorArea} ${inspectorCollapsed ? styles.collapsed : ''}`}>
          <Placeholder label="여기는 인스펙터입니다 (다음 단계에서 채워집니다)" />
        </div>
      </div>
    </div>
  )
}

/** 아직 내용이 없는 영역에 표시하는 안내 문구. 팔레트·캔버스·인스펙터 자리에서 공통으로 씁니다. */
function Placeholder({ label }: { label: string }) {
  return (
    <div className={styles.placeholder}>
      <span className="t-body">{label}</span>
    </div>
  )
}
