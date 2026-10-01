# ADR-014. 배포 뷰 — 로컬 프로세스만 지원, docker compose·Kubernetes는 학습 산출물, V-ci·V-live 범위

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-01(docker·k8s 학습)·08·15·17, CON-001·005·014·015, NFR-SEC-001·003, NFR-PORT-001·002·003·005·007·008, FR-SET-012·013·024·026, FR-LAB-001·011, DEC-CNV-23·31, PLN-REV-01 AQ-15, SP-2·SP-4 감사(Windows·macOS 미확립 → 플랫폼 활성화 게이트), SP-7 감사(`check:gates`)
- **관련**: ARC-01 §14, ADR-012·013

## 맥락 (Context)

- 제품은 1인 로컬 전용(CON-001)이며 브로커·컨테이너 없이 3분 안에 설치·첫 세션이 끝나야 한다(D-2). 동시에 사용자는 docker·k8s 트랙을 공부하므로, 이 시스템 자체의 컨테이너·클러스터 매니페스트가 **실물 교재**가 될 수 있다(UR-01).
- 빌드 검증 환경은 Linux 컨테이너 + Chromium, 키 없음, `claude` CLI만 존재한다(CON-015). 3 OS·3 엔진·실제 AI 행동은 V-ci·V-live로 분리해야 한다(DEC-CNV-31).
- 컨테이너 안에는 OS 키체인·사용자 구독 CLI가 없다. 컨테이너 네트워크 네임스페이스 안에서는 `127.0.0.1` 바인딩만으로 서비스 간 통신이 불가능하다.

## 결정 (Decision)

1. **지원 런타임 = 로컬 프로세스 하나**(ADR-012): `fathom up`(prod), `pnpm dev`(dev), `spawn-stack`(test). 설치는 포터블 번들(`pnpm bundle [--with-node]` → `fathom-<ver>-<platform>-<arch>.tar` + `bundle.manifest.json` + 반입 승인 체크리스트, FR-SET-013·026), `install.sh`·`install.ps1`이 `FATHOM_HOME/app/<ver>/`에 전개하고 런처(`fathom`·`fathom.cmd`)를 만든다. 자동 기동은 옵트인(LaunchAgent·schtasks·systemd --user).
2. **뷰 B — docker compose(선택·학습용, 비지원)**: `deploy/docker/Dockerfile`(`node:22.22.2-bookworm-slim` 멀티스테이지, `pnpm deploy --prod`, uid 10001, `read_only: true`, `tmpfs: /tmp`) 단일 이미지 `fathom:<ver>`, 서비스마다 `command: ["node","--disable-warning=ExperimentalWarning","services/<svc>/dist/main.js"]`. `deploy/compose/compose.yaml`: `FATHOM_SUPERVISOR=external`(supervisor 없음, `restart: unless-stopped` + `healthcheck`), 내부 네트워크 `fathom-internal`(`internal: true`) + ai-gateway만 `fathom-egress`, **gateway만 `ports: ["127.0.0.1:4747:4747"]`**, 서비스별 named volume. 한계: 키체인·구독 CLI 불가 → API 제공자 + `ai-keys.enc`(passphrase는 docker secret), 러너는 content 컨테이너 안 같은 가드 + 컨테이너 격리.
3. **뷰 C — Kubernetes(학습 산출물, 비지원)**: `deploy/k8s/base`(Kustomize) — Namespace `fathom`, writer 서비스 = StatefulSet `replicas: 1` + PVC(RWO)(SQLite 단일 writer를 객체로 표현), gateway = Deployment, ClusterIP + headless Service, NetworkPolicy default-deny + **컨텍스트 맵 그대로의 허용**(ARC-01 §5.2 동기 호출 + §8.5 이벤트 push 방향, ai-gateway egress 443만), ConfigMap(정책), Secret 예시(`*.example.yaml`), probe `/healthz`·`/readyz`, `preStop` → `/internal/v1/admin/shutdown`, CronJob(ops-api epoch 트리거), `PodSecurity: restricted`. 접근은 `kubectl port-forward --address 127.0.0.1 svc/gateway 4747:4747`만. `overlays/kind/`. Case·조건 반전 쌍 교재로 재사용(예: learning `replicas: 2`면 무엇이 깨지는가).
4. **컨테이너 예외(이 ADR로만 허용)**: `FATHOM_DEPLOY=container`일 때만 ① 컨테이너 네임스페이스 내부 `0.0.0.0` 바인딩(호스트 게시는 gateway `127.0.0.1:4747`만) ② 내부 토큰을 compose `secrets:`·k8s Secret 파일(`/run/secrets/<svc>.tokens.json`)로 받기(NFR-SEC-003의 "디스크 0" 예외, 학습 산출물 한정) ③ CLI 제공자 비활성. 로컬 프로세스 모드에서는 세 가지 모두 부팅 실패(exit 78)다.
5. **CI 워크플로(AQ-15)**:
   - `ci-build.yml`(V-build, 병합 게이트): ubuntu, Node 22.22.2, 네트워크 차단 단계 포함 — `pnpm i --frozen-lockfile --ignore-scripts` → `pnpm check:gates`(1차 정적 게이트, 종료 코드 0/1/2 — INT-1a는 `--warn-only`) → typecheck·lint → 단위·계약·통합(spawn-stack)·러너 차단 스위트·속성/골든 → Playwright Chromium E2E(Zero-AI·SCN·사용성·설치 3분·북마크 재진입) → 카오스 → 성능 → `ai:eval:gates` → 팩 빌드 리포트(D-11).
   - `ci-matrix.yml`(V-ci, **병합 비차단 · 릴리스 게이트**): {ubuntu, windows, macos} × Node {22.22.x, 24.x} — 단위·계약·러너 차단 스위트(호스트 관측 대조군 포함)·통합·Chromium E2E, ubuntu에서 Firefox·WebKit 스모크, Windows spawn·`taskkill`/Job Object·npm shim·`%LOCALAPPDATA%\Fathom`·한글·공백 경로·MAX_PATH·`-shm`·필수/AV 잠금·CRLF, macOS `ps` 50ms 감시, 쿠키 3 엔진, 정적 게이트(경로 구분자·pnpm 심볼릭 링크의 tsgo 해석), `kubeconform` 오프라인 스키마 검사, 선택 kind 스모크. 산출물: **`runner_verified_platforms`**(러너 스위트 + 감시 주기 ≤ 50ms를 통과한 `{os, arch, node}` 목록 — 릴리스 매니페스트에 들어가고 `RunnerPort`가 기동 시 대조, 목록 밖 OS는 러너 과업 형식 비활성 + Docker 권고, ADR-007 §7)와 **OS 지원 표**(`node:sqlite`·종료·경로 항목별 PASS/FAIL — "두 OS PASS" 표기의 근거, ADR-002 §12).
   - `live-smoke.yml`(V-live, 수동): `fathom doctor --live` — 제공자 probe, Jev 3질문 타입 1건씩, CLI canary hook(SP-8), 구조화 출력 5건, SP-1 캘리브레이션 작업 생성, 키체인 3 OS.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| Docker 우선 런타임 | 환경 일관성 | Windows·macOS Docker Desktop 의존, 3분 설치 위반, 키체인·CLI 불가 | 기각(학습 뷰로만) |
| Kubernetes 지원 런타임 | 확장성 | SQLite 단일 writer와 상충, 1인 로컬에 과잉 | 기각(교재로만) |
| Electron·Tauri 패키징 | 데스크톱 경험 | 두 번째 런타임·네이티브 빌드 | 기각(PWA) |
| Node SEA 단일 실행 파일 | 설치 단순 | experimental, `node:sqlite`·자식 프로세스 경로 검증 부족 | v1.x 후보(포터블 tar로 대체) |

## 결과 (Consequences)

- **긍정**: 지원 표면이 하나라 검증이 단순하다. compose·k8s 매니페스트가 같은 이미지·같은 `createService()`를 써서 학습 교재로 정확하다.
- **부정**: compose·k8s 뷰가 로컬 뷰와 드리프트할 수 있다 → V-ci 스키마 검사·선택 스모크, "비지원" 명시. 컨테이너 예외는 코드 경로가 갈라진다(`FATHOM_DEPLOY` 분기는 `shared-kernel/config` 한 곳으로 제한).
- **후속**: TST-01이 워크플로별 스위트를 확정. 반입 승인 체크리스트 템플릿(FR-SET-026).

## 동결 영향

지원 런타임 결정, 컨테이너 예외 3항, CI 등급 분리는 상세 동결이다. 매니페스트 세부는 학습 산출물로 자유롭게 개선(CR 불필요)하되 NetworkPolicy는 ARC-01 §5.2와 일치해야 한다.
