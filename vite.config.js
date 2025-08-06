import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // 빌드 후 상대 경로로 로드되게 함
  build: {
    outDir: 'dist', // 빌드 결과물 폴더
  },
});
