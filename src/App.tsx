// 최상위 화면 컴포넌트.
// M0-2 단계: 디자인 토큰(tokens.css)이 제대로 정의됐는지 눈으로 확인하기 위한 임시 화면입니다.
// 실제 편집기 레이아웃이 아니라 색·타이포·반경·그림자·간격 토큰을 한 페이지에 늘어놓은 것뿐입니다.
// M0-4 단계에서 이 화면이 실제 컴포넌트 카탈로그로 바뀝니다.
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

export default function App() {
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
    </div>
  )
}
