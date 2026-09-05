# Progress: 햄스터S 말판 제작 웹앱 (hamsterCreator)
Last updated: 2026-09-05 05:20

## Goal
- 햄스터S 말판·라인트레이서 트랙을 화면에서 배치하고, 원하는 용지로 나눠 인쇄할 수 있는 정확한 축척의 PDF와 정답 코드를 뽑아주는 교사용 웹 도구
- v1 완료 기준: PRD §1.2의 S1~S4, S6, S7 전부 통과

## Current Status
- Status: In progress
- Current focus: **M0 완료. 다음은 M1 격자 편집기 코어(§9.18 3~7단계)**
- Repo: `https://github.com/t777-kaewoong/hamsterCreator` (Public, 원격 연결·푸시 완료)
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

## Completed
- [x] **M0-1 프로젝트 스캐폴딩 + 배포 파이프라인** (2026-09-05)
  - Vite 8.2.2 + React 18.3.1 + TypeScript 7.0.2, `npm run build` 성공 (140.9kB, gzip 45.9kB)
  - `base: '/hamsterCreator/'` 적용 확인. 대피로 빌드 `npm run build:single`도 성공 (단일 HTML 141.3kB)
  - GitHub Actions Pages 워크플로 작성 (`main` push + 수동 실행)
  - git 초기화, 브랜치 `main`, 첫 커밋 `09b8bd0`
  - 우회 사항: npm이 React 19를 기본 설치 → 18로 고정 / TS 7이 `baseUrl` 제거 → `paths`를 상대경로로 / 윈도우 셸 호환 위해 `cross-env` 추가

- [x] **M0-2 디자인 토큰 + 전역 스타일** (2026-09-05)
  - `tokens.css` — PRD §9.3~9.5의 토큰 49개 전수 반영 (중립/강조/의미색/캔버스/반경/그림자/모션/간격)
  - `reset.css` — box-sizing, `:focus-visible` 링(포커스 링 제거 안 함), `prefers-reduced-motion` 대응
  - `typography.css` — 타이포 스케일 7종 클래스 + `.t-nums`
  - `App.tsx`를 토큰 확인용 임시 화면으로 교체. 하드코딩 hex 0건, 전부 토큰 참조
  - 커밋 `bc9ca79`
- [x] **M0-2a 폰트 전략 수정** (2026-09-05) — Opus 판단으로 교체
  - 문제: `pretendard-dynamic-subset`이 폰트 1,647개 / 22.3MB, CSS 548KB 생성 → 대피로 단일 HTML 빌드가 31MB로 사용 불가
  - 해결: PRD §9.4가 쓰는 400/500/600 굵기만 고정 서브셋 woff2 3개로 직접 `@font-face`. `pretendard` 패키지 제거, 파일을 `src/assets/fonts/`로 이관
  - 결과: 폰트 **804KB/3개**, CSS **5.32KB**, 대피로 빌드 **1.23MB**, dist 전체 949KB/7파일
  - OFL-1.1 라이선스 고지 추가 (`src/assets/fonts/LICENSE.txt`) — 저장소가 Public이라 필요
  - 커밋 `650d42b`
  - 브라우저 실측 검증: 토큰 49개 전부 정상 렌더, `font-family`가 Pretendard로 해석됨

- [x] **M0-3 기본 컴포넌트** (2026-09-05)
  - `src/components/`에 8종 추가: `Button` `Input` `Segmented` `TabPills` `Tooltip` `StatusChip` `Toast`(+`useToast`) `Modal`, `index.ts`로 재export
  - PRD §9.7 수치 그대로 구현. `App.tsx`를 컴포넌트 카탈로그로 확장(기존 토큰 확인 섹션은 유지)
  - 인터랙션 전부 브라우저에서 실측 검증: 숫자 입력 화살표(1/Shift+10), Segmented 좌우 화살표 이동,
    Modal 포커스 트랩(Tab 순환)·Esc·body 스크롤 잠금·포커스 복귀, Toast 교체(1개만)·3초/6초 자동 소멸,
    Tooltip 400ms 지연 표시·즉시 사라짐·단축키 칩, StatusChip saving 점 깜빡임, TabPills 스크롤 페이드 좌우 전환
  - 하드코딩 hex 리터럴 0건(`grep -rE "#[0-9A-Fa-f]{6}" src/components/` 확인)
  - 토큰 공백 발견: 역상(흰) 글자용 토큰이 tokens.css에 없음 — PRD가 "#FFF"로 직접 리터럴 지정한 자리
    (primary/danger 버튼 글자, Tooltip/Toast 글자)에 한해 CSS 키워드 `white`를 그대로 씀. `--c-text-inverse`
    같은 토큰 추가를 다음 토큰 개정 때 권장
  - 번들: JS 147.14kB→164.78kB(gzip 47.62kB→53.15kB), CSS 5.33kB→13.97kB(gzip 1.82kB→3.79kB, 아이콘 6개 트리셰이킹 포함)
  - 커밋 `a1eb896`
- [x] **M0-3a 역상 색 토큰 보강** (2026-09-05) — Opus 판단
  - M0-3에서 발견된 토큰 공백(진한 배경 위 글자색이 토큰에 없음)을 메움
  - `--c-text-inverse` `--c-surface-inverse` `--c-overlay` 3종 추가, Button/Toast/Tooltip/Modal의 리터럴 6곳 치환
  - `docs/03_prd.md` §9.3에도 동일 토큰 반영해 명세와 코드를 일치시킴
  - 커밋 `35c30e7`

- [x] **M0-4 맵 문서 타입 + 파일 저장소 어댑터** (2026-09-05) — **M0 완료**
  - `src/lib/model/` — `types.ts`(PRD §5 스키마, Stroke는 kind 판별 유니온) `constants.ts`(50mm·8mm·용지 8종) `factory.ts`(기본 A4 5×4) `serialize.ts`(예외 대신 결과 객체 반환)
  - `src/lib/storage/` — `FsaStore`(파일 핸들 유지 → 진짜 덮어쓰기) `DownloadStore`(폴백) `draft.ts`(초안 5개·디바운스 500ms·userAssets 제외) `index.ts`(`createMapStore()` 자동 선택)
  - `App.tsx`에 저장소 확인 섹션 추가 (기존 토큰·컴포넌트 섹션 유지)
  - 번들: JS 174.84kB(gzip 56.41kB), CSS 14.24kB(gzip 3.85kB), 대피로 1.26MB
  - 커밋 `22315b1`
  - **Opus 추가 검증**(에이전트가 파일 대화상자 때문에 못 한 부분을 모의 핸들로 대체해 실측):
    `saveAs` → 대화상자 1회 호출·2040바이트 기록·writable close 확인 /
    `save` → **대화상자 재호출 없이 같은 핸들에 덮어쓰기 확인**(핸들 유지가 실제로 동작) /
    `open` 왕복 결과가 원본과 완전 동일 /
    취소(DOMException AbortError) → `UserCancelledError` 변환 확인, 진짜 오류(TypeError)는 취소로 오인하지 않음 /
    초안 왕복 + `userAssets`가 실제로 제외됨 확인
  - **남은 미검증**: OS 네이티브 파일 대화상자를 실제로 열어 디스크에 쓰는 경로(자동화 불가, 사람이 한 번 눌러봐야 함)

## In Progress
- [ ] M1 격자 편집기 코어 — 레이아웃 골격 + 도구 레일 (§9.18 3단계)

## Next Steps
1. §9.18 3단계 레이아웃 골격 + 도구 레일 (§9.2, §9.10)
2. §9.18 4단계 캔버스 뷰포트 — 좌표 변환·렌더 레이어·눈금자 (§9.12)
3. §9.18 5단계 팔레트 패널 (§9.11) — **아트 타일 36종 추출이 선행 필요**
4. §9.18 6단계 인스펙터 (§9.13), 7단계 시작 화면 (§9.8)

## Changed Files
- `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`: 빌드 설정
- `src/main.tsx`: `ToastProvider`로 앱 전체를 감쌈 (M0-3)
- `src/App.tsx`, `src/App.module.css`: 토큰 확인 화면 + 컴포넌트 카탈로그
- `src/components/`: 기본 컴포넌트 8종 (`Button` `Input` `Segmented` `TabPills` `Tooltip` `StatusChip` `Toast` `Modal`) + `index.ts`
- `.github/workflows/deploy.yml`: Pages 자동 배포
- `.gitignore`

## Commands Run
```text
npm install            → 성공
npm run build          → 성공, dist/ 생성 (140.86kB / gzip 45.90kB)
npm run build:single   → 성공, dist-single/index.html 141.25kB
git init && git commit → 09b8bd0
```

## Risks / Open Questions
- 초안 id를 "브라우저 세션 1회 = 초안 1슬롯"으로 발급함. 맵 문서에 안정적인 id 필드가 없어서 내린 절충인데, 한 세션에서 맵 A→B로 갈아타면 A의 초안이 덮어써짐. M1에서 맵 전환이 실제로 생기면 `meta.createdAt` 기반 키로 바꿀지 재검토
- 아트 타일 36종을 `말판/custom_objects.pdf`에서 아직 추출하지 않음 — 팔레트(§9.18 5단계) 전에 필요
- GitHub Pages는 저장소 Settings → Pages → Source를 "GitHub Actions"로 지정해야 배포가 시작됨 (수동 1회)
- SP-6: 자유곡선을 곡선과 겹치지 않게 시트 분할하는 알고리즘의 실용성 — M1.5에서 확인. 실패 시 사용자가 이음매 위치를 직접 지정
- SP-7: Pretendard 서브셋 + `pdf-lib` 폰트 임베드에서 한글이 정상 출력되는지 — M2 착수 시 최소 예제로 확인
- 햄스터S 바닥 센서 2개의 좌우 간격(mm) 미확인 — FR-10.9의 40mm 기준을 정밀화할 때 필요 (M6)
- GitHub 저장소가 Public이어야 Pages 무료. 내장 아트가 저작권 프리라 공개에 문제 없음
