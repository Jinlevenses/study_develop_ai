# ADR-006. 프런트엔드 스택 — React 19.3 SPA, TanStack, Tailwind 4 토큰, CodeMirror 6, 자체 Depth Map, PWA 셸, attempt 큐

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-04·14·17, FR-UX-001~016, FR-QST-019·022, FR-AI-020, FR-STD-018, FR-SET-023, NFR-UX-001~014, NFR-PERF-009, NFR-PORT-006·008, NFR-SEC-009·011, PLN-REV-01 AQ-12·AQ-16, PR-012·016, tech-stack-facts, SP-7 감사(STD-01: `design-tokens`·`routing/`·`pre-submit/`·`blank-note/`), SP-6 감사(θ 비노출)
- **관련**: ARC-01 §5.1·§8.7·§12.2·§16·§18, ADR-003·009

## 맥락 (Context)

- 17개 화면 + `/_design` = 18 라우트, 키보드 우선·한국어 IME·초성 팔레트, 다크 우선 D3 Bathymetry 토큰, Depth Map 469 노드 첫 렌더 ≤ 1s·팬·줌 ≥ 50fps, LCP ≤ 2.5s·INP ≤ 200ms, WCAG 2.2 AA, 런타임 외부 리소스 0.
- 서버는 127.0.0.1 로컬이고 SSR 이득이 없다. 세션은 쿠키 + CSRF(ADR-009), 실시간 갱신은 SSE 하나(ADR-003).
- content·learning 재시작(≤ 5s) 중에도 응답이 유실되면 안 된다(D-9, 심사 graft B → A).
- TS 7에서 CSS side-effect import는 `vite/client` 타입 참조가 필요하다(tech-stack-facts).

## 결정 (Decision)

1. **스택**(정확한 버전은 ARC-01 §18): React 19.3 SPA(SSR 없음) · Vite 8.3 + `@vitejs/plugin-react` 6.1 · TanStack Router 1.170(file routes, `autoCodeSplitting`, **`routesDirectory: './src/routing'`**·`generatedRouteTree: './src/routeTree.gen.ts'` — 라우팅 코드는 `routing/`에 두는 STD-01 규약, NG-G4 정적 검사 범위) · TanStack Query 5.104(서버 상태 단독) · zustand 5(플레이어 타이머·팔레트·키맵 등 휘발 상태만) · Tailwind 4.3(`@theme` OKLCH) · radix-ui 1.6 + shadcn 패턴(cva·tailwind-merge·clsx) · motion 13.4(`prefers-reduced-motion` 준수) · cmdk 1.1 + es-hangul 2.4(초성) · sonner · lucide-react · react-markdown 10(`skipHtml`) + rehype-sanitize 6 · shiki 4(JS 정규식 엔진, 언어 지연 로드) · mermaid 12(지연 청크, `securityLevel: 'strict'`, 텍스트 대체 필수) · recharts 3 · 폰트 self-host(Pretendard·Geist·JetBrains Mono).
2. **코드 에디터 = CodeMirror 6**(`@uiw/react-codemirror` 4.25 + lang-javascript·lang-sql·lang-yaml). Monaco 기각(워커·수 MB 번들, 한국어 IME 조합 이슈, IntelliSense는 NG-03 대필 금지와 충돌).
3. **Depth Map = 자체 SVG 격자 렌더 + packc 사전 계산 좌표**(`.fpack`의 `layout.json`), 표 뷰 토글(NFR-UX-003), 레이어 4종(블루프린트 커버리지 포함, AQ-12). `@xyflow/react`는 개념 이웃 그래프(≤ 50 노드)에만 지연 로드. 런타임 d3-force 계산 0.
4. **라우트(17 + `/_design` = 18)**: `/`(Cockpit Home) · `/session/$sessionId` · `/concepts/$conceptId` · `/map` · `/evidence/$conceptId` · `/notes/$blockId` · `/dig/$dialogId` · `/cases/$runId` · `/artifacts/$runId` · `/review/weekly` · `/season` · `/inbox` · `/imports/$jobId` · `/curation` · `/ai` · `/ops` · `/settings` · `/_design`. 모두 명령 팔레트로 진입(FR-UX-005).
5. **폴더(BC 정렬)**: `apps/web/src/routing/`(파일 라우트), `apps/web/src/features/{practice,curriculum,assessment-ui,insight,acquisition,ai-control,ops-console,settings}/{components,hooks,api}/`, 공용 `lib/`·`stores/`·`styles/`, 컴포넌트 원천 `packages/ui`, 토큰 원천 `packages/design-tokens`. 백지노트는 `features/practice/blank-note/`(제출 전 — AI 클라이언트·생성 호출 import 금지)와 `features/practice/blank-note/post-submit/`(제출 후 비교·피드백)로 나눈다(NG-G7, STD-01).
6. **데이터 계층**(`apps/web/src/lib/`):
   - `api-client.ts`: `@fathom/contracts/http/gateway/v1/*` 라우트 정의로 타입 안전 호출. 멱등 라우트는 `Idempotency-Key`(ULID) 자동 부여, 상태 변경은 `X-Fathom-CSRF`, `application/problem+json` 파싱(코드·error_id 표시).
   - `bootstrap.ts`: 부팅 시 `location.hash`의 `bt`를 읽고 즉시 `history.replaceState`로 제거 → `POST /api/v1/session/exchange` → `GET /api/v1/session/csrf`(메모리 보관).
   - `sse.ts` + `invalidation-map.ts`: `EventSource('/api/v1/stream')`, `Last-Event-ID` 재연결, 이벤트 타입 → query key 무효화 표, `resync` → 전체 무효화. 판정 밴드가 바뀐 `grading.verdict.revised`만 작은 diff 애니메이션(FR-QST-019).
   - `attempt-queue.ts`(`idb` 8.0): IndexedDB `fathom-attempts` v1, store `attempts`(keyPath `idempotency_key`; 필드 `session_id, block_id, item_id, payload, answered_at, created_at, tries, state: pending|sending|failed_permanent, last_error_code`). 제출은 **큐에 먼저 쓰고** 전송, 2xx면 삭제, 503·네트워크 오류는 같은 키로 1s → 2s → 4s … ≤ 30s 재시도, `ops.health.changed`(content·learning ready)·`online` 이벤트 시 즉시 플러시, 4xx(409·429 제외)는 `failed_permanent`로 세션 리포트에 표시, 7일 보관(서버 멱등 보관 기간과 일치).
7. **정답 비공개**(FR-QST-022, NG-G3): 제출 전 응답 스키마는 `packages/contracts/src/http/<svc>/v1/pre-submit/*.ts`(또는 이름 `*PreSubmit*`)에 두고 `answer_key`·`explanation`·`correct_*`·`is_correct`·`model_answer`·`exemplar_note`·`solution` 필드가 없다. 제출 후 공개 스키마는 `post-submit/*.ts`의 **별개 `z.object`**이며 서로 스프레드·`.extend`·`.merge`로 파생하지 않는다(`check:ng-g` G3 + 계약 테스트 403). 정답·해설은 제출 응답에서만 받고 별도 query key로 캐시한다.
8. **입력·접근성**: 단축키는 `event.code` 기반, 단일 문자 단축키는 입력 포커스 중 비활성·재매핑 가능(WCAG 2.1.4), `?` 도움말. IME: `isComposing` 또는 keyCode 229에서 Enter 제출 무시(FR-UX-004). 타이머 끄기·연장(WCAG 2.2.1). 채점 결과 `aria-live=polite`. 360px에서 OX·MCQ 완주(NFR-UX-010).
9. **디자인 토큰**: **`packages/design-tokens/src/tokens.css`**(`@fathom/design-tokens`)의 Tailwind `@theme`(OKLCH, 다크 우선 + 라이트)와 `tokens.ts`(차트·Mermaid `themeVariables`용 상수 export)가 **원색 리터럴이 허용되는 유일한 위치**다(`design/raw-color`, STD-01). `packages/ui`·`apps/web`은 `var(--…)`·토큰 상수만 쓴다. 색은 깊이(L1~L5)와 상태만 인코딩한다(연체·스트릭에 빨강 금지 — NG-G5). 한국어 타이포(NFR-UX-009): `word-break: keep-all` + `overflow-wrap: anywhere`, 본문 측정폭 토큰, 제목 `text-wrap: balance`·본문 `pretty`, 행간 1.6~1.7, 한글 이탤릭 금지, `tabular-nums`. `/_design` 살아있는 스타일가이드 + 토큰 → UI 표준 표 자동 생성(FR-UX-002).
10. **PWA(AQ-16)**: `public/manifest.webmanifest` + **수작업 `public/sw.js`**: 빌드 플러그인(`apps/web/vite/sw-precache-plugin.ts`)이 해시 자산 목록을 주입, 앱 셸만 cache-first, `/api/**`·SSE는 network-only, `skipWaiting` 없음(다음 기동에 반영). 앱이 꺼져 있으면 "`fathom open`으로 켜기" 오프라인 페이지. 폴백 포트(다른 origin)면 재설치 배너 1회.
11. **AQ-12(18화면 유지)**: 트랙 범위 진입 → 지도 패널·팔레트 다이얼로그, 오버레이 편집 → 개념 페이지 드로어 + 큐레이션 탭, 블루프린트 커버리지 → Depth Map 레이어, 병합 마법사 → 운영 콘솔 다이얼로그, 대량 작업 승인 → SSE `ai.work_order.approval_requested`가 어느 화면에서든 띄우는 전역 다이얼로그(이력은 AI 화면).
12. **품질 게이트**: NG-G1~G7·원색 리터럴 금지(`check:ng-g`, ADR-010), 한국어 타이포·토큰 외 px 금지(`check:typo-ko`), 개념 θ는 채점 이벤트 30건 미만이면 숫자 대신 "증거 부족" 표시(SP-6 감사, CR-22), `dangerouslySetInnerHTML` 0, axe(Playwright) serious 0, Playwright trace LCP ≤ 2.5s·INP ≤ 200ms, Depth Map ≤ 1s·50fps, 스크린샷 루브릭(NFR-UX-012), 사용성 과업 5종(NFR-UX-013). 단위·컴포넌트 테스트는 vitest + happy-dom + @testing-library/react + fake-indexeddb.
13. **TS 설정**: `apps/web/tsconfig.json`의 `types: ["vite/client"]`(TS 7 CSS import), `jsx: react-jsx`, contracts는 `source` 조건으로 해석.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| Next.js·React Router framework(SSR) | 생태계 | 서버 렌더 프로세스 추가, 로컬 SPA 이득 없음 | 기각 |
| Monaco | IntelliSense | 번들·워커·IME, NG-03 충돌 | 기각 |
| Depth Map을 xyflow + 런타임 d3-force | 구현 쉬움 | 469 노드 첫 렌더·50fps 위험, 레이아웃 비결정성 | 기각(이웃 그래프만 xyflow) |
| Redux·전역 상태 일원화 | 표준 | 서버 상태 중복, 보일러플레이트 | 기각(Query + 휘발 zustand) |
| vite-plugin-pwa·Workbox | 자동화 | 의존·설정 표면, `/api` 캐시 실수 위험 | 기각(수작업 SW) |
| Electron·Tauri 셸 | 데스크톱 통합 | 두 번째 런타임·네이티브 빌드 | 기각(PWA 설치형 창) |
| 응답 큐 없음(A 원안) | 단순 | content·learning 재시작 중 응답 유실 | 기각(IndexedDB 큐 graft) |

## 결과 (Consequences)

- **긍정**: 한 origin·쿠키·SSE로 dev와 운영이 같다. Depth Map이 결정적 좌표로 빠르고 테스트 가능하다. 응답 유실이 클라이언트에서 막혀 서버 장애 반경이 줄어든다.
- **부정**: 수작업 SW·SSE 무효화 표·attempt 큐는 직접 테스트해야 한다(E2E: 재기동 후 북마크 진입, content kill 중 제출). Depth Map 상호작용(줌·팬·레이어)을 자체 구현한다.
- **후속**: SCR-01이 18화면·컴포넌트·토큰 값·참조 세트(PR-016)를 확정. `/_design` 기준선 스냅샷을 INT-1a에서 생성.

## 동결 영향

라우트 목록(17 + `/_design` = 18), BC 정렬 feature 폴더, 데이터 계층 계약(api-client·SSE·attempt 큐 스키마), PWA 범위는 상세 동결이다. 컴포넌트·토큰 값은 SCR-01에서 확정한다.
