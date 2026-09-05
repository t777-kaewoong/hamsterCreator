import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath, URL } from 'node:url'

// 대피로(단일 HTML) 빌드 여부. package.json 의 "build:single" 스크립트가
// SINGLE_FILE=1 을 넣어서 vite build 를 실행합니다. (cross-env 로 윈도우에서도 동작)
const isSingleFile = process.env.SINGLE_FILE === '1'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 배포 경로. 저장소가 t777-kaewoong/hamsterCreator 이므로
  // 평소 빌드는 '/hamsterCreator/' 하위 경로에서 서빙됩니다.
  // 단, 단일 HTML 대피로 빌드는 file:// 로 직접 열어야 하므로 상대 경로 './' 를 씁니다.
  // ※ 저장소 이름을 바꾸면 이 값도 반드시 같이 바꿔야 합니다.
  base: isSingleFile ? './' : '/hamsterCreator/',

  plugins: [
    react(),
    // 대피로 빌드일 때만 모든 JS·CSS를 하나의 index.html 안에 인라인으로 합칩니다.
    ...(isSingleFile ? [viteSingleFile()] : []),
  ],

  resolve: {
    alias: {
      // 코드에서 "@/lib/model/..." 처럼 src/ 이하를 짧게 import 하기 위한 별칭.
      // tsconfig.app.json 의 paths 설정과 항상 짝을 맞춰야 합니다.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    // 개발 서버 포트를 5173으로 못 박습니다.
    // strictPort: true 를 주지 않으면, 5173이 이미 쓰이고 있을 때 vite가 말없이
    // 5174, 5175... 로 옮겨 갑니다. 그러면 터미널에 찍힌 주소와 평소 쓰던 주소가
    // 달라져서 "흰 화면"만 보이는 일이 생깁니다.
    // strictPort: true 면 포트가 막혀 있을 때 그냥 실패하므로 원인이 바로 보입니다.
    port: 5173,
    strictPort: true,
    // 실행하면 브라우저를 자동으로 열어 줍니다. base('/hamsterCreator/')까지
    // 포함된 정확한 주소로 열리므로 주소를 직접 칠 필요가 없습니다.
    open: true,
  },

  build: {
    // 대피로 빌드 결과물은 일반 빌드(dist)와 섞이지 않도록 dist-single 에 따로 둡니다.
    // (실제 출력 폴더는 build:single 스크립트의 --outDir 옵션이 최종 결정합니다)
    outDir: isSingleFile ? 'dist-single' : 'dist',
  },
})
