# Progress: 햄스터S 말판 제작 웹앱 (hamsterCreator)
Last updated: 2026-09-05 03:01

## Goal
- 햄스터S 말판·라인트레이서 트랙을 화면에서 배치하고, 원하는 용지로 나눠 인쇄할 수 있는 정확한 축척의 PDF와 정답 코드를 뽑아주는 교사용 웹 도구
- v1 완료 기준: PRD §1.2의 S1~S4, S6, S7 전부 통과

## Current Status
- Status: In progress
- Current focus: **M0 — 스캐폴딩 + GitHub Actions 배포 + 디자인 토큰 + 기본 컴포넌트**
- Repo: `https://github.com/t777-kaewoong/hamsterCreator` (아직 로컬 git 미초기화)
- 배포 URL(예정): `https://t777-kaewoong.github.io/hamsterCreator/`

## Decisions
- 2026-09-05 분석·설계·PRD를 먼저 작성하고 구현 착수 (`docs/01`~`03`). 코드부터 쓰지 않음
- 2026-09-05 DB 없이 `.hsmap.json` 파일 저장/불러오기로 운영. 사용자 업로드 이미지는 파일에 base64로 내장해 자기 완결적으로 만듦
- 2026-09-05 주 배포는 GitHub Pages 정적 호스팅. Apps Script는 선택지로만 보류 (샌드박스 iframe이 덮어쓰기 저장을 막음)
- 2026-09-05 기본 맵 크기 = A4 가로 1장 (5×4 = 20칸, 250×200mm)
- 2026-09-05 자유곡선 트랙을 v1에 포함. PDF 렌더러를 두 번 손대지 않도록 M1.5(격자 다음, PDF 앞)에 배치
- 2026-09-05 라이트 모드만 구현. 캔버스가 실제 흰 종이를 표현하므로 다크 모드는 종이 색 인지를 방해함
- 2026-09-05 스타일은 CSS 커스텀 프로퍼티 + CSS Modules. 유틸리티 프레임워크 미사용 (토큰을 단일 진실 공급원으로)
- 2026-09-05 **작업 방식**: 코딩은 Sonnet, 모호하거나 추상적인 판단은 Opus로 올려서 처리. 단계 종료마다 이 문서에 기록 + 한 줄 보고. 코드 주석은 사용자가 직접 수정할 수 있도록 한글로 구체적으로 작성

## In Progress
- [ ] M0-1 프로젝트 스캐폴딩 (Vite + React + TS) + GitHub Actions Pages 배포 파이프라인

## Next Steps
1. M0-1 스캐폴딩 + 배포 파이프라인
2. M0-2 디자인 토큰 (PRD §9.3~9.5: 색·타이포·간격·모서리·그림자·모션 CSS 변수)
3. M0-3 기본 컴포넌트 (PRD §9.7: 버튼·입력·세그먼트·탭 필·툴팁·상태 칩·토스트·모달)
4. M0-4 저장소 어댑터(`FsaStore`/`DownloadStore`) + 컴포넌트 카탈로그 페이지
5. M1 격자 편집기 코어 (PRD §9.18의 3~7단계)

## Risks / Open Questions
- SP-6: 자유곡선을 곡선과 겹치지 않게 시트 분할하는 알고리즘의 실용성 — M1.5에서 확인. 실패 시 사용자가 이음매 위치를 직접 지정
- SP-7: Pretendard 서브셋 + `pdf-lib` 폰트 임베드에서 한글이 정상 출력되는지 — M2 착수 시 최소 예제로 확인
- 햄스터S 바닥 센서 2개의 좌우 간격(mm) 미확인 — FR-10.9의 40mm 기준을 정밀화할 때 필요 (M6)
- GitHub 저장소가 Public이어야 Pages 무료. 내장 아트가 저작권 프리라 공개에 문제 없음
