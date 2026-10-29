// 글자(라벨)의 여러 줄 배치 규칙(docs/12 §2.1). 화면(drawBoard)·클릭 판정(hitTest)·PDF가 같은 값을 씁니다.

/** 줄 간격(글자 크기의 배수). 화면·PDF가 같은 값을 씁니다. */
export const LABEL_LINE_HEIGHT = 1.25

/** 글자를 줄로 나눕니다(Enter로 넣은 줄바꿈, docs/12 §2.1). */
export function labelLines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** i번째 줄의 세로 위치(글자 크기 단위). 여러 줄 전체의 가운데가 라벨 좌표에 오게 합니다. */
export function labelLineOffset(i: number, count: number): number {
  return (i - (count - 1) / 2) * LABEL_LINE_HEIGHT
}
