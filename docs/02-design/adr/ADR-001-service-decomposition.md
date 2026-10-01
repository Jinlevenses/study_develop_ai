# ADR-001. 서비스 분해 — 6개 서비스, content + assessment 병합, BC 모듈, 7번째 슬롯 예약

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-05·08·09·18, CON-004, NFR-MAINT-001·002, NFR-AVL-002, NFR-DATA-013, PLN-CNV-01 §12.1, PLN-REV-01 AQ-01·AQ-03, 심사 기록(A 24.0 > B 21.1 > C 20.2)
- **관련**: ARC-01 §5·§6·§7, ADR-002·003·011·012

## 맥락 (Context)

- 기획 기준선의 가칭 서비스는 7개(web · gateway · content · assessment · learning · ai-gateway · ops)이고, AQ-01은 content와 assessment를 합쳐 서비스 수와 홉을 줄일지 묻는다. 상한은 7개(CON-004)다.
- 서비스마다 SQLite 파일이 따로 있으므로 서비스를 넘는 원자적 쓰기가 불가능하다(FE-07). 그런데 오버레이 정답 키 수정 → 문항 보정 → 계보 기록, KU 개정 → 재게이트처럼 catalog와 문항 은행을 **한 트랜잭션**으로 바꾸고 싶은 흐름이 많다.
- 채점은 매번 KU·오개념·ItemModel을 읽는다. 분리하면 HTTP 조회나 복제 캐시가 필요하다.
- 코드는 하위 모델 에이전트가 병렬로 쓴다. 서비스 골격·템플릿이 적을수록, 통합 이벤트·사가가 적을수록 결정적 통합이 쉽다. 보장 코어는 103u다.
- 심사: 운영성·빌드 가능성 렌즈는 A(병합, 6서비스)를, 요구 적합성 렌즈는 C(병합 + forge 신설)를 1위로 뒀다. 세 렌즈 모두 B식 완전 분리의 배관 비용(이벤트 38종, 참조 사본 2벌, 교차 서비스 팩 사가)을 지적했다. forge 신설은 7슬롯을 소진해 이후 재분리를 CON-004 위반으로 만든다.

## 결정 (Decision)

1. **서비스 6개**와 책임(ARC-01 §5.1이 정본):

   | 서비스 | 패키지 | 선호 포트(prod/dev) | 호스팅 BC | 소유 DB |
   |---|---|---|---|---|
   | web | `@fathom/app-web` | gateway가 정적 제공 | UI | 없음(IndexedDB 큐만) |
   | gateway | `@fathom/svc-gateway` | 4747 / 4847 | Edge(BFF·세션·SSE) | 없음 |
   | content | `@fathom/svc-content` | 4762 / 4862 | catalog · acquisition · itembank · grading · runner | `content.db` |
   | learning | `@fathom/svc-learning` | 4763 / 4863 | practice · ledger · learner-model · insight · curriculum-ref | `learning.db`, `insight.db` |
   | ai-gateway | `@fathom/svc-ai-gateway` | 4764 / 4864 | control · routing · judge · generate · privacy | `ai.db`, `ai-cache.db` |
   | ops | `@fathom/svc-ops` | supervisor(IPC) · ops-api 4761 / 4861 | operations | `ops.db` |

2. **content = content + assessment 병합**. 경계는 서비스가 아니라 **BC 모듈**로 유지한다.
   - 코드: `services/content/src/{http,application,domain}/<bc>/`, `bc ∈ {catalog, acquisition, itembank, grading, runner}`.
   - `domain/<bcA>` → `domain/<bcB>` import 금지. 교차 BC는 `application/<bc>/ports.ts` 인터페이스로만(예: grading → `ItemReader`, itembank → `CatalogReader`, grading·itembank → `RunnerPort`).
   - 테이블 접두어 = 모듈(`ct_` `aq_` `ib_` `gr_` `rn_`), 마이그레이션 디렉터리 = 모듈(`migrations/{_infra,catalog,acquisition,itembank,grading,runner}/`), 교차 모듈 FOREIGN KEY 금지.
   - 이벤트 타입 이름의 context = BC(`catalog.*`, `acquisition.*`, `itembank.*`, `grading.*`), `producer` = `content`. 재분리해도 이름이 바뀌지 않는다.
   - **자급형 계측기**: 발행된 `ib_item`은 KU·오개념 스냅샷과 `content_hash`를 내장하고, grading은 catalog 테이블을 읽지 않는다.
   - **배치 격리**: 배치 AI 파이프라인의 CPU·메모리 무거운 단계는 `--max-old-space-size=512` 단명 자식 job `pipeline`(`src/jobs/pipeline.ts`, DB를 열지 않음)에서 계산만 하고, AI 호출·스테이징 쓰기는 부모만 한다. 스냅샷·팩 적재·무결성 검사도 content가 스스로 fork하는 단명 job(ADR-002 §3)이다. 미승인 초안은 `aq_staging_*`·`ib_staging_item`에만 있다.
3. **learning**은 증거 단일 writer이고, practice·ledger·learner-model·insight·curriculum-ref를 BC 모듈로 나눈다. learning은 `curriculum_ref` 사본으로 content 없이 세션을 조립하고 승급을 판정한다. **v1에서 learning은 AI를 호출하지 않는다**(FR-DSH-009 요약 문장은 템플릿 폴백).
4. **AQ-03**: 대화(디깅·Feynman·Case·산출물 반박)의 상태·턴 로그·재개 = learning(`domain/practice/dialog`). 턴 판정·루브릭·다음 move·발화 = content.grading(→ ai-gateway). gateway는 스트림 바이트 중계만 한다.
5. **ops = 프로세스 2개**: DB·HTTP가 없는 `supervisor`(ADR-012)와 `ops-api`. 학습 경로는 ops-api를 호출하지 않는다(ops-api kill → 학습 지속).
6. **7번째 슬롯 예약**(포트 4765/4865). **분리 재검토 트리거**: ① 러너·게이트 부하로 검색 p95 > 100ms가 2주 지속 ② 배치 파이프라인이 결정적 채점 p95 300ms를 침범 ③ catalog와 grading의 릴리스 주기 분리 필요 ④ 생성 파이프라인 크래시가 주 2회 이상 content 재시작을 유발. 충족 시 ADR로 `grading+runner` 또는 `acquisition+생성(forge)`을 분리한다.
7. **호출 ACL = 컨텍스트 맵**(ARC-01 §5.2): gateway → 4개 서비스, learning → content, content → ai-gateway, ops-api → content·learning·ai-gateway(admin)·gateway(activity), 이벤트 push는 소비자 매니페스트 선언 생산자만. 그 밖의 호출은 401/403.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| A0. 기획 그대로 7개 분리(B) | BC 경계가 배포 경계와 일치, content 장애 중에도 채점 지속 | 통합 이벤트 38종, learning·assessment의 `curriculum_ref` 사본 2벌, 3서비스 팩 활성화 사가, long-poll 약 12개, +1~2u, 7슬롯 소진 | 기각 |
| A1. 병합 + forge 신설(C) | serve/produce 프로세스 분리, 미승인 초안 물리 격리 | 7슬롯 소진(재분리 = CON-004 위반), +7.5u, 온디맨드 수명주기·2단 큐, ops의 forge.db 직접 스냅샷(NFR-MAINT-002 위반) | 기각(배치 격리는 단명 자식으로 흡수, forge는 트리거 ④로 보류) |
| A2. 병합(BC 모듈) + 슬롯 예약 | 2홉, 한 트랜잭션 원자성, ≈ 60MB 절감, 골격 1개, 재분리 여유 | content 장애 반경, 파일 소유 핫스팟 | **채택** |
| A3. 모놀리식 1프로세스 | 가장 단순 | UR-08·CON-004 위반, 키·러너 격리 약화 | 기각 |

## 결과 (Consequences)

- **긍정**: 세션 첫 문항 2홉(gateway → learning → content), 채점·생성·게이트가 프로세스 내부 호출, 오버레이·보정·계보를 한 tx로 기록. 서비스 템플릿 1개(`createService()`)와 통합 이벤트 23종으로 병렬 빌드 표면이 작다. 모듈·접두어·마이그레이션·이벤트 이름이 이미 나뉘어 있어 재분리는 이관 스크립트 + ACL 표 수정으로 끝난다.
- **부정**: content가 죽으면 채점과 카탈로그가 함께 멈춘다 → 완화: supervisor 5s 재시작, learning 블록 prefetch, web IndexedDB attempt 큐(같은 Idempotency-Key 재전송), `curriculum_ref`, 카오스 테스트에 content kill 포함(D-9). content 디렉터리가 파일 소유 핫스팟이 될 수 있다 → 완화: BC별 레인(ARC-01 §16.1), BC별 `register.ts`, 모듈별 마이그레이션 디렉터리.
- **후속**: 트리거 ①~④를 헬스 보드·Tripwire 지표로 감시(ADR-015). Task Brief의 허용 경로는 BC 디렉터리 단위로 쓴다(ADR-008). `check:boundaries`의 `bc-cross`·`grading-no-catalog` 규칙(ADR-010).

## 동결 영향

서비스 목록·포트·DB 소유·BC 모듈 목록·호출 ACL은 PG-2 상세 동결 대상이다. 서비스 추가·분리·병합은 ADR + `frozen.lock` 재생성으로만 한다.
