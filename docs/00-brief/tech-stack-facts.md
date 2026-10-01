# 기술 스택 실측 정보 (2026-09-30, npm registry 기준)

아키텍처 단계의 스택 선정 입력 자료. 버전은 `npm view <pkg> version` 실측값.

| 영역 | 패키지 | 최신 버전 | 비고 |
|------|--------|----------|------|
| UI | react / react-dom | 19.3.0 | |
| 빌드 | vite | 8.3.1 | Rolldown 기반 |
| 빌드 | @vitejs/plugin-react | 6.1.1 | |
| 언어 | typescript | 7.0.2 (latest) | 네이티브(Go) 컴파일러 세대. 5.x/6.x와 도구 호환성 확인 필요 |
| 스타일 | tailwindcss / @tailwindcss/vite | 4.3.3 | CSS-first `@theme`, OKLCH |
| 라우팅 | @tanstack/react-router | 1.170.x | router-plugin 1.168.x |
| 서버상태 | @tanstack/react-query | 5.104.0 | |
| 클라상태 | zustand | 5.0.15 | |
| 모션 | motion | 13.4.6 | framer-motion 후속 |
| 커맨드팔레트 | cmdk | 1.1.1 | |
| 프리미티브 | radix-ui | 1.6.7 | 통합 패키지 |
| 아이콘 | lucide-react | 1.49.0 | |
| 토스트 | sonner | 2.0.8 | |
| 유틸 | class-variance-authority 0.7.1 / tailwind-merge 3.7.0 / clsx 2.1.1 | | shadcn/ui 패턴 |
| 코드하이라이트 | shiki | 4.4.3 | |
| 마크다운 | react-markdown | 10.1.0 | |
| 코드에디터 | @uiw/react-codemirror 4.25 / @monaco-editor/react 4.7 | | |
| 그래프 시각화 | @xyflow/react 12.12 / d3-force 3.0 | | 개념 선수관계 그래프 |
| 차트 | recharts | 3.10.1 | |
| 폰트 | pretendard 1.3.9 / @fontsource-variable/geist 5.3.0 | | |
| 서버 | fastify | 5.12.5 | @fastify/cors 11.3, @fastify/rate-limit 11.2, @fastify/http-proxy 11.6 |
| 서버(대안) | hono 4.13 + @hono/node-server 2.1 | | |
| 스키마 | zod | 4.6.5 | 계약(contract) 공유 |
| 로깅 | pino | 10.3.1 | |
| SRS | ts-fsrs | 5.4.2 | FSRS 구현체 |
| AI | @anthropic-ai/sdk 0.129.0 / openai 7.25.0 / @typesafe-ai/sdk 0.6.0 | | Jev = @typesafe-ai/sdk |
| 테스트 | vitest | 5.0.2 | vite ^6~^8 peer |
| E2E | @playwright/test | ~~1.63.0~~ → **1.56.1**(CR-47, 2026-10-01 정정) | 컨테이너 사전설치 `/opt/pw-browsers/chromium-1194`(Chromium 141)는 1.56.x 짝. 1.63.0은 revision 1243을 요구해 오프라인 실행 불가 |
| 모노레포 | turbo 2.11.5 / pnpm 10.33 | | |
| 실행 | tsx | 4.23.15 | TS 직접 실행 |
| 린트/포맷 | @biomejs/biome 2.5.14 | | ESLint 10.11 / Prettier 3.9 대안 |

## CLI 사실
- `claude -p "<prompt>" --output-format json --json-schema '<schema>' --model <m>` — 구조화 출력 지원(실측 help).
- `graphify` 0.9.72 설치 확인(`uv tool install graphifyy`). 주요 명령: `extract <path> --code-only`, `update <path>`, `query`, `path`, `explain`, `affected`, `god-nodes`, `export callflow-html`, `claude install`, `hook install`.
- `node:sqlite` — SQLite 3.51.2, FTS5 + trigram 토크나이저 동작.

## 호환성 실측 결과 (scratch 프로젝트)
- TypeScript 7.0.2 `tsc --noEmit` + Vite 8.3.1 build + Vitest 5.0.2 + Fastify 5.12.5 `inject()` + zod 4.6.5 + ts-fsrs 5.4.2 + `node:sqlite` + tsx 4.23 — **모두 정상 동작**.
- TS 7 주의: CSS side-effect import는 `vite/client` 타입 참조 필요(`"types": ["vite/client"]` 또는 `/// <reference types="vite/client" />`). 
