# content/ — 콘텐츠 원천

## 1. 이 디렉터리

- 이 디렉터리는 학습 콘텐츠의 **원천(YAML·Markdown)** 이다.
- 컴파일본(`.fpack`)은 `dist/packs/`에 생기며 커밋하지 않는다.

## 2. 트리 요약

- 전체 트리는 [DCP-01 §5.1](../docs/02-design/04-data-collection-plan.md#51-저장소-트리)을 따른다.
- `packs/<트랙>/pack.yaml` — 트랙 20개의 팩 매니페스트
- `packs/<트랙>/concepts/*.md` — 개념 골격과 본문
- `packs/<트랙>/{kus,misconceptions,items,item-models,labs,cases,artifacts,rubrics}/` — 트랙별 콘텐츠
- `templates/{t2,dig,rubrics}/` — 범용 T2 템플릿 5 · 디깅 질문 8 · 공용 루브릭 6
- `sources/registry.yaml` — 출처 레지스트리 40, `sources/requests/` — 새 출처 요청
- `review/` — 리뷰 기록, `.schemas/` — 생성된 JSON Schema 12개

## 3. 명령

| 명령 | 설명 |
|---|---|
| `pnpm content:check [--pack <id>]` | 원천 검증(V1·V2·V7, 린트 규칙) |
| `pnpm content:scaffold` | R4 기준 골격 생성(기존 파일은 변경하지 않음) |
| `pnpm content:schemas` | `.schemas/*.schema.json` 갱신(`--check`는 비교만) |
| `pnpm packs:build` | 팩 컴파일(`dist/packs/`) |

종료 코드는 `0` 통과, `1` 위반, `2` 엔진 고장(스캔 0파일 포함)이다.

## 4. 소유 규칙 (DCP §9.1)

- 개념 5파일은 그 개념을 맡은 WP가 소유한다.
- `sources/registry.yaml`은 WP-INT, `templates/**`는 WP-00, `review/V7/**`는 WP-REV가 소유한다.
- 새 출처는 레지스트리를 직접 고치지 않고 `sources/requests/<wp>.yaml`에 요청한다.
- `.schemas/**`와 scaffold 출력은 손으로 고치지 않고 명령으로만 갱신한다.

## 5. 저작 금지 사항

- 원문 문장을 복사하지 않는다. 모든 문장은 자체 문장으로 쓴다.
- 한 출처에서 1문장을 넘겨 인용하지 않는다.
- 이미지 파일을 넣지 않는다.
- `gate_status`를 직접 바꾸지 않는다.
- 실명과 실제 도메인을 쓰지 않는다.

## 6. 커밋 전

- `pnpm content:check`가 exit 0인지 확인한다.
- DCP §7.4 자기 점검표를 확인한다.
