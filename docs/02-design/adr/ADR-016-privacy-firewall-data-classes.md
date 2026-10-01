# ADR-016. Privacy Firewall과 데이터 등급 — 로컬 판정 전용, `FirewalledPayload` 브랜드 타입, C0~C3, ingress·egress 2지점

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-15·16, NG-06, FR-AI-019·020·021·023·024, FR-IMP-001·002·010, NFR-SEC-008·013, NFR-DATA-010, DEC-CNV-28, PLN-REV-01 FE-08, 심사 기록 graft(C → A: `FirewalledPayload`, 데이터 등급, generic-cli unverified → C0)
- **관련**: ARC-01 §12.7·§12.8, ADR-005·009

## 맥락 (Context)

- 사용자는 회사 노트북에서도 쓴다(P0~P2). 학습자 답안·가져온 자료에 사내 도메인·사번·키·사설 IP가 섞일 수 있다. 외부 AI(Jev 포함)로 나가는 페이로드 100%가 로컬 방화벽을 통과해야 한다(NFR-SEC-013).
- 기밀 여부를 판정하려고 Jev 같은 외부 서비스로 보내는 것 자체가 유출이다(FE-08 → v1.0 Jev 기밀 판정 Deprecated). Jev는 7일 동일요청 캐시를 둔다.
- 우회 경로가 "코드 리뷰로 막는다" 수준이면 하위 모델 에이전트가 실수로 어댑터를 직접 호출할 수 있다. 타입 수준 강제가 필요하다(심사 graft).
- 사용자가 등록하는 범용 CLI는 격리 canary를 통과하지 않았을 수 있다(신뢰 미검증).

## 결정 (Decision)

1. **데이터 등급**(`@fathom/contracts/ai/data-class`):

   | 등급 | 정의 | 외부 송출 |
   |---|---|---|
   | `C0` | 시드 콘텐츠·공개 출처 기반 텍스트, 시스템 프롬프트 | 모든 동의 제공자(`trust: unverified` 범용 CLI 포함) |
   | `C1` | 학습자 산출물(답안·백지노트·대화 턴·산출물 초안) | 검증된 제공자만, 전송 로그에 외부 처리자 표시 |
   | `C2` | 사용자가 가져온 자료(Inbox·import 원문·붙여넣기) | 과업 `data_class_max ≥ C2`일 때만(예: AI-G05·J13~J16) |
   | `C3` | 민감: 비밀 패턴·사내 패턴 적중, 로컬 LLM 기밀 분류 양성, 사용자가 "로컬 전용" 지정 | **Ollama(127.0.0.1)만** 또는 차단(FR-AI-023), 외부 0 |

   모든 컨텍스트 블록은 `{ text, data_class, untrusted: boolean, source_ref }`를 가진다. 과업 레지스트리의 `data_class_max`와 어댑터 신뢰 등급으로 라우팅 후보를 거른다(ADR-005 §5).
2. **egress 1지점(ai-gateway `domain/privacy`)**:
   ```ts
   declare const fw: unique symbol;
   export type FirewalledPayload<T> = T & { readonly [fw]: true; readonly decision_id: string;
     readonly data_class: DataClass; readonly route: 'external' | 'local_only' };
   // 생성자는 firewall.inspect만 export한다(같은 모듈 밖에서 브랜드를 만들 수 없음)
   export function inspect<T extends { blocks: ContextBlock[] }>(payload: T, route: RouteCandidate):
     { kind: 'pass'; payload: FirewalledPayload<T> } | { kind: 'masked'; payload: FirewalledPayload<T>; masks: Mask[] }
     | { kind: 'force_local'; payload: FirewalledPayload<T> } | { kind: 'block'; reason: string };
   ```
   제공자 어댑터의 `judge()`·`generate()`는 `FirewalledPayload`만 받는다 → 방화벽을 거치지 않은 외부 호출은 **타입 오류**다. 런타임 단언(브랜드 + `decision_id`가 `ai_firewall_log`에 있음)을 겹으로 둔다.
3. **판정 파이프라인(로컬 전용, 순서 고정)**: ① 정규화(NFC·제로폭·양방향 제어문자 제거) ② `firewall_rules@v1` 내장 정규식(API 키·토큰·주민등록번호 형식·전화·이메일·사설 IP·내부 호스트명 패턴) ③ 사용자 사내 패턴(`ai_firewall_pattern`: 도메인·사번·프로젝트 코드) ④ (선택, 사용자가 켠 경우) 로컬 Ollama 기밀 분류 ⑤ 결정 = `pass | masked(치환 토큰 ⟨SECRET_n⟩) | force_local | block` ⑥ `ai_firewall_log`(decision_id, task, provider, data_class, rule_hits, action, ts) 기록. **판정 목적의 외부 호출 0**(Jev 포함, 전 모드).
4. **ingress 1지점(content acquisition)**: Inbox·import·붙여넣기 원문을 **저장 전에** `@fathom/shared-kernel/redact/redact` + `firewall_rules@v1` + 사용자 패턴(ai-gateway `GET /internal/v1/firewall/patterns`; ai-gateway가 꺼져 있으면 내장 규칙만 적용하고 `masking: 'partial'` 표시 + 다음 기동 시 재스캔)으로 마스킹한다(NFR-DATA-010). 가져온 텍스트는 C2, 비신뢰(`untrusted: true`) 구획(`<source-<nonce>>`)으로만 프롬프트에 들어간다. 주입 의심 청크(H + AI-J16)는 `quarantined`, 사용자 확인 전 LLM 투입 0.
5. **Jev = 외부 처리자**: Jev 호출도 egress를 통과하며, 전송 로그에 외부 처리자로 표시하고 설정 화면에 "Jev 서버 7일 동일요청 캐시"를 고지한다.
6. **범용 CLI 신뢰**: `trust: unverified`(canary 미통과) 어댑터는 C0만 받는다. `verified`는 canary 통과 기록이 있어야 하며 수동 토글로 바꿀 수 없다.
7. **생성 정책 연계**(FR-AI-020·FR-STD-018, NG-G7): privacy 계층이 `@fathom/contracts/ai/ai-gateway-policy`의 `deny_before_submit: ["blank_note.*"]`를 집행한다 — `generate/*` 요청의 `context_ref.kind = 'blank_note'`·`phase = 'pre_submit'`이면 과업과 무관하게(AI-G06·G12 포함) 403 `AI-POLICY-001`(CR-44)(정답 대필 금지). 이 런타임 거부가 본체이고, 정적 게이트(`ng-g7/*`)는 정책 파일 양성 단언과 `blank-note/` 코드의 AI import 금지로 보조한다(ADR-010).
8. **검증(V-build)**: 비밀 테스트셋 50건 재현율 1.0(차단 또는 마스킹), 비식별화 30건, 네트워크 계층 계수 테스트(undici `MockAgent` + spawn 래퍼 — 모든 외부 요청에 기록된 `decision_id`가 있다, 우회 0), 주입 30건(가져온 문서·학습자 답안 → 산출물·판정 변화 없음), `ai_call_log`·로그에 비밀 원문 0.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| Jev `noul`로 기밀 판정(v1.0) | 판정 정확도 | 판정하려고 외부 전송 = 유출 | Deprecated(DEC-CNV-28) |
| 어댑터마다 개별 검사 | 국소적 | 누락 경로 발생, 일관성 없음 | 기각(단일 egress) |
| 등급 없이 이진(허용/차단) | 단순 | 가져온 자료·학습자 답안의 차등 정책 불가 | 기각 |
| 코드 리뷰로만 우회 방지 | 구현 비용 0 | 병렬 에이전트 실수 방지 불가 | 기각(브랜드 타입 + 런타임 단언 + 계수 테스트) |

## 결과 (Consequences)

- **긍정**: 외부 전송 통제가 타입·런타임·테스트 세 겹으로 증명된다. 회사 데이터가 섞여도 기본값이 안전 쪽이다. 사용자가 전송 로그에서 무엇이 어디로 갔는지 본다.
- **부정**: 정규식 기반이라 오탐(과잉 마스킹)이 생길 수 있다 → 마스킹 미리보기·사용자 예외(과업 단위 일회 허용, 로그 기록). Ollama가 없으면 C3 과업은 보류된다.
- **후속**: DCP-01이 비밀 50·비식별화 30·주입 30 평가셋을 제작. SCR-01이 전송 로그·사내 패턴 설정 화면을 설계.

## 동결 영향

데이터 등급 4종, `FirewalledPayload` 계약, 판정 파이프라인 순서, ingress·egress 2지점, unverified CLI의 C0 제한은 상세 동결이다. 패턴 목록은 `firewall_rules@v1` 정책 버전으로 바꾼다.
