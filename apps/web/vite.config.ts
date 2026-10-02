import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// 루트 package.json `version`이 앱 버전의 원천이다(supervisor `app_version`과 같은 원천).
// 루트에 version이 아직 없으면(T-00-01 소유 파일) 0.0.0으로 두어 빌드를 막지 않는다 — 에스컬레이션 대상.
function readRootVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const version =
    typeof pkg === 'object' && pkg !== null && 'version' in pkg ? (pkg as { version: unknown }).version : undefined;
  return typeof version === 'string' ? version : '0.0.0';
}

// 브라우저는 gateway(4847/4747)를 통해 들어온다 — HMR WebSocket도 gateway가 프록시한다(ARC §14.3). Vite 쪽 proxy 설정은 없다.
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routing',
      generatedRouteTree: './src/routeTree.gen.ts',
      quoteStyle: 'single',
      semicolons: true,
      addExtensions: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: { conditions: ['source', ...defaultClientConditions] },
  define: { __FATHOM_APP_VERSION__: JSON.stringify(readRootVersion()) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023', sourcemap: false },
});
