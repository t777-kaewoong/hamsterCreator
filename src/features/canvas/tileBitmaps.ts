// 내장 아트 타일(35종) 이미지를 미리 디코드해서 캔버스가 바로 그릴 수 있게 준비해두는 캐시.
//
// [왜 필요한가]
// <img> 태그와 달리 <canvas>에 그림을 그리려면(drawImage) 이미지가 완전히 디코드되어 있어야
// 합니다. 타일을 캔버스에 놓는 순간 매번 이미지를 새로 불러오면 처음 한 번은 늦게(또는 안)
// 그려지는 깜빡임이 생깁니다. 그래서 앱이 켜지자마자 타일 35종을 전부 createImageBitmap으로
// 미리 디코드해 Map<타일id, ImageBitmap>에 담아둡니다. 팔레트(다음 단계)도 이 캐시를 그대로
// 재사용하면 됩니다.
//
// 디코드가 끝나기 전에는 해당 타일을 그리지 않습니다(그릴 그림이 없으니까). 디코드가 끝나면
// "이 타일이 준비됐다"는 걸 구독자에게 알려서, 그 타일이 실제로 쓰인 레이어만 다시 그리게
// 합니다(renderer.ts가 이 알림을 받아 art 레이어에 dirty 표시를 합니다).
import { TILES } from '@/lib/tiles/catalog'

type Listener = (tileId: string) => void

class TileBitmapCache {
  private bitmaps = new Map<string, ImageBitmap>()
  private listeners = new Set<Listener>()

  constructor() {
    // eager: TILES 배열의 url은 이미 다 준비돼 있으므로(카탈로그 로드 시점에 확정),
    // 여기서 바로 전부 디코드를 시작합니다. 35장이라 화면을 막을 정도로 무겁지 않습니다.
    for (const tile of TILES) {
      this.loadOne(tile.id, tile.url)
    }
  }

  private async loadOne(id: string, url: string): Promise<void> {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob)
      this.bitmaps.set(id, bitmap)
      for (const listener of this.listeners) listener(id)
    } catch (err) {
      // 타일 하나가 실패해도 나머지 34개는 계속 쓸 수 있어야 하므로 던지지 않고 로그만 남깁니다.
      console.error(`타일 이미지 디코드 실패: ${id}`, err)
    }
  }

  /** id로 디코드된 비트맵을 가져옵니다. 아직 로드 전이면 undefined(이때는 그리지 않으면 됩니다). */
  get(id: string): ImageBitmap | undefined {
    return this.bitmaps.get(id)
  }

  /** 타일 하나가 새로 준비될 때마다 호출됩니다. 반환값은 구독 취소 함수. */
  onLoad(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

/** 앱 전체에서 하나만 있으면 되는 싱글턴 캐시. import하는 즉시 35종 디코드가 시작됩니다. */
export const tileBitmapCache = new TileBitmapCache()
