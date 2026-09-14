// 캔버스에 놓을 수 있는 내장 타일·인쇄용 아이콘·사용자 이미지를 디코드해두는 캐시.
//
// [왜 필요한가]
// <img> 태그와 달리 <canvas>에 그림을 그리려면(drawImage) 이미지가 완전히 디코드되어 있어야
// 합니다. 타일을 캔버스에 놓는 순간 매번 이미지를 새로 불러오면 처음 한 번은 늦게(또는 안)
// 그려지는 깜빡임이 생깁니다. 그래서 앱이 켜지자마자 타일 35종을 전부 createImageBitmap으로
// 미리 디코드해 캐시에 담아둡니다. 내장 자산은 앱 시작 때 준비하고, 파일마다 내용이 다른
// 사용자 이미지는 문서에서 처음 발견했을 때 준비합니다.
//
// 디코드가 끝나기 전에는 해당 타일을 그리지 않습니다(그릴 그림이 없으니까). 디코드가 끝나면
// "이 타일이 준비됐다"는 걸 구독자에게 알려서, 그 타일이 실제로 쓰인 레이어만 다시 그리게
// 합니다(renderer.ts가 이 알림을 받아 art 레이어에 dirty 표시를 합니다).
import { ICONS } from '@/lib/icons/catalog'
import type { UserAssets } from '@/lib/model/types'
import { TILES } from '@/lib/tiles/catalog'

type Listener = (assetId: string) => void

interface CacheEntry {
  source: string
  state: 'loading' | 'ready' | 'error'
  bitmap?: ImageBitmap
}

class TileBitmapCache {
  private entries = new Map<string, CacheEntry>()
  private listeners = new Set<Listener>()
  private builtInSources = new Map<string, string>()

  constructor() {
    // 내장 자산은 URL이 고정돼 있고 수량도 작으므로 처음부터 준비합니다. 아이콘 SVG도
    // Blob → ImageBitmap 경로를 거치면 PNG 타일과 같은 drawImage 코드로 그릴 수 있습니다.
    for (const asset of [...TILES, ...ICONS]) {
      this.builtInSources.set(asset.id, asset.url)
      this.startLoad(asset.id, asset.url)
    }
  }

  private notify(id: string): void {
    for (const listener of this.listeners) listener(id)
  }

  private startLoad(id: string, source: string): void {
    const entry: CacheEntry = { source, state: 'loading' }
    this.entries.set(id, entry)

    void this.loadOne(id, entry)
  }

  private async decodeBlob(blob: Blob): Promise<ImageBitmap> {
    if (!blob.type.includes('svg')) return createImageBitmap(blob)

    // Chromium은 SVG Blob을 createImageBitmap(blob)으로 직접 넘기면 InvalidStateError를
    // 내는 경우가 있습니다. 브라우저 이미지 디코더를 먼저 거치면 SVG의 투명 배경과 색을
    // 그대로 보존하면서 최종 캐시 형식은 다른 자산과 같은 ImageBitmap으로 맞출 수 있습니다.
    const objectUrl = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.src = objectUrl
      await image.decode()
      // 자체 SVG는 viewBox만 있고 width/height 속성이 없어 ImageBitmap이 자연 크기를 정할 수
      // 없습니다. 중간 캔버스에 명시적 크기로 그린 뒤 비트맵으로 바꾸면 Chromium에서도
      // 투명 배경을 유지하며 안정적으로 디코드됩니다. PDF 변환도 같은 600px 기준입니다.
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 600
      const context = canvas.getContext('2d')
      if (!context) throw new Error('아이콘 변환용 캔버스를 만들지 못했습니다')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return createImageBitmap(canvas)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  private async loadOne(id: string, entry: CacheEntry): Promise<void> {
    try {
      const res = await fetch(entry.source)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const bitmap = await this.decodeBlob(blob)

      // 다른 파일을 열어 같은 asset:u1 id가 새 내용으로 바뀌었다면, 먼저 시작한 비동기
      // 결과가 뒤늦게 새 문서의 이미지를 덮지 않게 버립니다.
      if (this.entries.get(id) !== entry) {
        bitmap.close()
        return
      }
      entry.bitmap = bitmap
      entry.state = 'ready'
      this.notify(id)
    } catch (err) {
      if (this.entries.get(id) !== entry) return
      entry.state = 'error'
      // 자산 하나가 실패해도 편집기 전체는 계속 쓸 수 있어야 하므로 던지지 않습니다.
      // 실패 상태를 기억해 매 프레임 재요청하지 않고, 구독자에게 알려 레이어를 갱신합니다.
      console.error(`캔버스 이미지 디코드 실패: ${id}`, err)
      this.notify(id)
    }
  }

  private sourceFor(id: string, userAssets: UserAssets): string | undefined {
    const builtIn = this.builtInSources.get(id)
    if (builtIn) return builtIn
    if (!id.startsWith('asset:')) return undefined
    return userAssets[id.slice('asset:'.length)]?.dataUrl
  }

  /**
   * id로 디코드된 비트맵을 가져옵니다. 사용자 이미지는 현재 문서의 userAssets에서 URL을
   * 찾아 필요할 때 로드를 시작합니다. 아직 준비 중이거나 잘못된 id면 undefined입니다.
   */
  get(id: string, userAssets: UserAssets = {}): ImageBitmap | undefined {
    const source = this.sourceFor(id, userAssets)
    if (!source) return undefined

    const entry = this.entries.get(id)
    if (!entry || entry.source !== source) {
      entry?.bitmap?.close()
      this.startLoad(id, source)
      return undefined
    }
    return entry.bitmap
  }

  /** 타일 하나가 새로 준비될 때마다 호출됩니다. 반환값은 구독 취소 함수. */
  onLoad(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

/** 앱 전체에서 하나만 있으면 되는 싱글턴 캐시. import 시 내장 타일·아이콘 디코드가 시작됩니다. */
export const tileBitmapCache = new TileBitmapCache()
