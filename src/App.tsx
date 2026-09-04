// 최상위 화면 컴포넌트. 지금은 스캐폴딩이 잘 됐는지 확인하는 용도의 임시 화면입니다.
// 다음 단계(디자인 토큰 작업)부터 이 파일이 실제 편집기 레이아웃으로 채워집니다.
export default function App() {
  return (
    // 인라인 스타일은 임시입니다. src/styles 에 CSS 토큰이 생기면 그쪽으로 옮깁니다.
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '8px',
        fontFamily: 'sans-serif',
      }}
    >
      <h1>햄스터S 말판 제작</h1>
      <p>M0-1 스캐폴딩 완료</p>
    </div>
  )
}
