# 내장 자산 출처

이 앱이 화면과 인쇄물에 쓰는 그림·서체가 어디서 왔는지 적어 둡니다.
저장소가 Public이라 배포 시 함께 공개되므로, 자산을 더하거나 뺄 때 이 파일도 같이 고치세요.

---

## 1. 아트 타일 35종 — `src/assets/tiles/*.png`

| 항목 | 내용 |
|---|---|
| 출처 | (주)로보메이션이 무료 배포한 햄스터S 말판 자료 `board_game_pdf_ko/custom_objects.pdf` |
| 가공 | 위 PDF에서 50×50mm 타일 영역을 433×433px(약 220dpi)로 추출 |
| 목록·분류 | `manifest.json`, 코드에서 쓰는 방법은 `src/lib/tiles/catalog.ts` |

**번들 근거:** `docs/02_design-direction.md` §0 "확정된 전제" 2번 —
"로보메이션 배포 자료 = 저작권 프리, 번들 가능"으로 사용자가 결정했고,
`docs/01_problem-analysis.md` §5 O7(번들 회피 제안)은 그때 철회됐습니다.

**남은 확인 사항:** 로보메이션의 배포 조건 문서(이용약관·라이선스 고지)를 이 저장소에
함께 두지는 못했습니다. 위 전제는 사용자 판단으로 확정된 것이고, 원 배포처의 문서로
교차 확인된 상태는 아닙니다. 조건 문서를 찾으면 이 항목에 링크를 추가하세요.
반대로 재배포가 허용되지 않는다는 것이 확인되면, `docs/01` O7이 제시한 대로
"사용자가 자기 PC의 `custom_objects.pdf`를 불러오는 경로"로 되돌리면 됩니다.

원본 PDF 23종은 `말판/` 폴더에 있지만 **저장소에 추적하지 않습니다**(`.gitignore`).
앱 실행에 필요하지 않고, 원본을 그대로 올리는 것은 위 전제가 다루는 범위가 아니기 때문입니다.

## 2. 인쇄용 아이콘 8종 — `src/assets/icons/*.svg`

이 프로젝트에서 직접 그린 SVG입니다. 외부 출처 없음.
(화면 UI 아이콘은 별개로 `lucide-react` 패키지를 씁니다 — ISC 라이선스, `node_modules`에 고지 포함)

## 3. 서체 — `src/assets/fonts/`

Pretendard (길형진 / orioncactus), SIL Open Font License 1.1.
전문과 고지는 `src/assets/fonts/LICENSE.txt` 참고.

- `*.subset.woff2` 3종 (굵기 400/500/600) — 화면 표시용
- `Pretendard-SemiBold.pdf.ttf` — PDF에 한글 라벨을 벡터로 임베드하기 위한 전체 TTF
