# 프로젝트 브리프 (Project Brief) — 원천 요구 (Source of Truth)

> 이 문서는 사용자의 원 요청을 보존하는 **최상위 기준 문서**이다. 모든 기획·설계·개발·회고는 이 문서의 요구(UR-01 ~ UR-18)로 추적(trace)되어야 한다.

## 1. 사용자 원문 요구 (User Requirements, verbatim 요지)

| ID | 원 요구 |
|----|---------|
| UR-01 | 알고리즘/프론트/백엔드/서버/보안/인프라(도커, 쿠버네티스)/CI·CD/AI/LLM 등 **전 분야 개발 공부**. 각 섹션을 나눠 공부할 수 있어야 한다. |
| UR-02 | 개발 전에 기획을 아주 탄탄하게. **여러 아이디어 기획 방법론**으로 전문가 수준 아이디어. 사용자 상황에 맞는 **가상 액터**를 설정하고, 요구사항 분석 기반으로 착수. 이후 **아키텍처 / 데이터 수집 계획** 마련 후 개발. |
| UR-03 | 모든 개발은 **개발 → 검증/보완 → 통합** 단계. 통합이 일정 횟수 이상 진행되면 **회고**(평가, 초기 계획과의 방향성·구현성 확인). |
| UR-04 | 디자인 관련 스킬과 웹서비스를 참고. **최신이고 세련된 디자인**. |
| UR-05 | 기획 후 **아키텍처 구조를 확정**하고 개발. 개발 순서를 뒤집지 않는다. |
| UR-06 | 코드 단위 작업은 **하위 모델**, 기획·논의·브레인스토밍은 **상위 모델**. |
| UR-07 | **개발표준정의서 등 SI 산출물** 활용. |
| UR-08 | 모놀리식보다 **서비스별 단위 분리**. |
| UR-09 | **graphify** 등으로 내부 구조를 그래프화하고, 개별 작업 시 작업 흐름 탐색에 활용. |
| UR-10 | **이론 → 코드 → 핵심 개념**으로 나눠 진행. |
| UR-11 | 깊이에 따라 **초급 ~ 전문가** 수준까지. |
| UR-12 | 초급 개발자가 **15년차 이상 전문가**가 될 때까지 사용한다는 가정. |
| UR-13 | **양질의 문제 생성 로직**, 개념을 가져올 수 있어야 함(개념 기반 출제 + 외부 개념 가져오기). |
| UR-14 | 공부 방식: **개념이해 / 실습 / 문제 / 개념 디깅 / OX / 백지노트** 등 다양한 방법론 분석·적용. 질리지 않게. |
| UR-15 | **로컬 사용**. AI 기능은 **API 또는 codex/claude/기타 LLM CLI** 연결. |
| UR-16 | 코드가 아닌 **분석·판단**이 필요한 AI 활용에는 **Jev** 기능/코드 활용 권장. |
| UR-17 | **기능성 / 운영성 / UI·UX** 모두 고려. |
| UR-18 | 계획 수립·검증 후 **바로 코드 작업**, 한 번에 모든 작업이 끝나도록. |

## 2. 사용자 상황 (추정 컨텍스트 — 가상 액터 설계 입력)

GitHub 저장소 목록(이름만 확인)으로부터 추정한 사용자 상황:

- **SK 계열 AI/클라우드 인재 양성 과정(SKALA) 수강/수료** 이력 — `skala-intro`, `skala-survey-manager`, 팀 프로젝트 `axis-frontend / axis-backend / axis-ai / axis-infra`.
- 학습 흔적: `first_docker`, `k8s_ingress_practice`, `langchain-practice`, `langgraph-rag-service`, `servingFastAPI_please`, `myfirst_api_server`, `front_practice`, `LLMs`, `DataAnalysis`, `controlnet`, `Deep_SLDA`.
- 즉, **AI/데이터 전공 배경 + 부트캠프형 풀스택/클라우드 학습 중인 주니어 개발자**. 한국 SI/엔터프라이즈 환경(SK 계열)을 지향하며 **SI 산출물 문화**에 익숙해져야 함.
- 사용 환경: **개인 로컬 PC**(Windows/macOS 가능성 모두 고려), Claude Code / Codex CLI 등 **AI 코딩 CLI를 이미 사용**.
- 언어: **한국어** 사용자. 기술 용어는 영문 병기.

## 3. 확인된 기술 사실 (Tech facts, 2026-09-30 기준 실측)

- 개발 환경: Node.js 22.22 / pnpm 10.33 / Python 3.11 / uv / Go 1.24 / Docker 29 사용 가능.
- `node:sqlite`(Node ≥ 22.13, 플래그 없이 사용 가능, ExperimentalWarning 출력) — **SQLite 3.51.2, FTS5 + `trigram` 토크나이저 동작 확인**(한글 부분 검색 가능). → 네이티브 빌드 없는 로컬 DB 후보.
- **graphify**: PyPI 패키지 `graphifyy`(CLI `graphify`). `uv tool install graphifyy` → `graphify extract ./src --code-only`(LLM 불필요, tree-sitter AST) → `graphify-out/{graph.json, GRAPH_REPORT.md, graph.html}`. 질의: `graphify query "..."`, `graphify path A B`, `graphify explain X`. 증분: `graphify update ./src`. Claude 연동: `graphify claude install`(CLAUDE.md + PreToolUse hook).
- **Jev (TypeSafe AI)**: 텍스트를 생성하지 않는 "System One" **판단 모델**. 공식 SDK `@typesafe-ai/sdk@0.6.0`(npm, 의존성 0, Node ≥ 20). 환경변수 `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`(기본 `https://api.typesafe.ai`), 모델 `jev-latest`.
  - `client.systemOne({ state, questions })` — `POST /v1/systemone`.
  - 질문 타입: `noul`(예/아니오 → `P(yes)`), `choice`(라벨 선택 → `choice`, `confidence`, `probabilities`), `score`(서열 루브릭 ≥ 2단계 → 기대 점수 `score`, `confidence`, `probabilities`, `legend`).
  - 헬퍼: `noul(instructions, {true, false})`, `choice(instructions, {label: desc|null})`, `score(instructions, [desc0, desc1, ...])`.
  - 약 250ms, 입력 $0.042/1M tokens, 출력 무료, 1,200 req/min, 7일 동일요청 캐시.
  - **함정**: 배열 인덱스(`candidates[i]`) 참조는 대량일수록 오답률 급증 → 객체 키(`candidates.k137`)로 참조하거나 항목별 질문으로 분리.
  - 적합: 정오 판정, 분류, 루브릭 채점, 랭킹, 필터링 등 **텍스트 출력이 필요 없는 판단**. 부적합: 설명/해설/문제 텍스트 생성(→ LLM).
- LLM CLI: `claude -p "<prompt>" --output-format json`(Claude Code headless), `codex exec "<prompt>"`(Codex CLI non-interactive), `gemini -p "<prompt>"`(Gemini CLI). API: Anthropic Messages API, OpenAI API, 로컬 Ollama(OpenAI 호환 `http://localhost:11434/v1`).
- 이 컨테이너의 외부 네트워크는 일부 도메인이 차단됨(GitHub, npm, PyPI는 허용).

## 4. 프로세스 원칙 (UR-03/05/06/18 해석)

1. **기획(상위 모델)** → 액터/아이디어/요구사항 → 검증(적대적 리뷰) → 확정.
2. **설계(상위 모델)** → 아키텍처·인터페이스·데이터·데이터수집·AI·화면·표준 → 교차 검증 → **아키텍처 동결(freeze)**.
3. **개발(하위 모델)** 반복(Iteration): 개발 → 검증/보완 → 통합. **통합 2회마다 회고(상위 모델)**.
4. 각 Iteration 시작 시 graphify 그래프로 작업 흐름 탐색. 동결된 아키텍처를 뒤집는 변경은 ADR로만.
