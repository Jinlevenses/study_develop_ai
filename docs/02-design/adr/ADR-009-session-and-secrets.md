# ADR-009. 세션과 비밀 — 쿠키 + CSRF + fragment 부트스트랩, 포트 바인딩, 내부 IPC 토큰, DEK/KEK 키 저장, 위협 모델

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-15·17, NFR-SEC-001·002·003·004·012·017·019, FR-SET-015·023, FR-AI-022, IR-010·014, PLN-REV-01 PX-07·FE-10·FE-15·AQ-04·AQ-06, 심사 기록 AQ-04·AQ-06 입장
- **관련**: ARC-01 §12.2~§12.4, ADR-005·012·016

## 맥락 (Context)

- 매일 진입 마찰(터미널·재인증)이 이탈 1순위다(PX-07). 재기동 후에도 북마크·다중 탭이 입력 없이 동작해야 한다. v1.0의 sessionStorage 토큰은 Deprecated(NFR-SEC-019 v1.1).
- 127.0.0.1 http라 `Secure` 쿠키를 쓸 수 없고, 쿠키는 포트로 격리되지 않는다(같은 host의 다른 포트 서비스가 쿠키를 받는다). DNS rebinding·교차 출처 요청을 Host·Origin·CSRF로 막아야 한다.
- 부트스트랩 토큰을 쿼리 문자열(`?t=`)로 넘기면 서버 로그·Referer에 남는다(심사 graft C).
- API 키는 ai-gateway만 읽는다. 비밀은 argv(`ps`)·env·DB·로그·export에 남으면 안 되고, KEK 평문을 같은 디스크에 두면 안 된다(FE-10). `scrypt` 파라미터는 A·C(N=2^17)와 B(N=2^15)가 갈렸다.
- 내부 서비스 토큰은 디스크·로그 0이어야 한다(NFR-SEC-003). env로 넘기면 `/proc/<pid>/environ`으로 읽히고 자식에게 상속될 수 있다(심사 지적, B 기각).

## 결정 (Decision)

### 1. 브라우저 세션

1. **부트스트랩 발급**: `fathom up`/`fathom open` → CLI가 `POST /api/v1/cli/bootstrap-token`(Bearer `cli.token`) → gateway가 32B 무작위(base64url) 1회용 토큰을 **메모리**에 60s TTL로 보관하고 반환 → CLI가 `http://127.0.0.1:<port>/#bt=<token>`을 기본 브라우저로 연다. fragment는 서버로 전송되지 않으므로 로그·Referer에 남지 않는다.
2. **교환**: SPA 부팅 시 `location.hash`의 `bt`를 읽고 즉시 `history.replaceState`로 지운 뒤 `POST /api/v1/session/exchange {bt}`. gateway는 Host·Origin·`Sec-Fetch-Site` 검사 후 토큰을 **1회 소비**(재사용 → 401 `GW-AUTH-004`)하고 쿠키를 발급한다.
3. **쿠키**: `fathom_sid=v1.<sid>.<port>.<iat>.<mac>; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`(400일). `sid` = 128bit 무작위 base64url, `iat` = epoch s, `mac = base64url(HMAC-SHA256(session.key, "v1|" + sid + "|" + port + "|" + iat))`. 24h마다 사용 시 재발급(rolling). 검증: mac 상수 시간 비교 + **`port` = gateway listen 포트**(불일치 401 `GW-AUTH-001`) — 같은 host 다른 포트로 새는 쿠키를 무효화한다.
4. **CSRF**: `GET /api/v1/session/csrf`(쿠키 필요, CORS 헤더 없음, `Cache-Control: no-store`) → `{csrf: base64url(HMAC-SHA256(session.key, "csrf|" + sid))}`. GET·HEAD·OPTIONS 외 요청은 `X-Fathom-CSRF` 일치 필수(403 `GW-AUTH-002`).
5. **요청 검사 순서**(gateway `domain/session`): Host ∈ {`127.0.0.1:<port>`, `localhost:<port>`}(아니면 **421**) → 상태 변경·교환은 Origin ∈ {`http://127.0.0.1:<port>`, `http://localhost:<port>`}(아니면 **403**) → `Sec-Fetch-Site`가 있으면 `same-origin|none`만 → 쿠키 → CSRF → rate limit 300 req/min/세션(NFR-SEC-017).
6. **`session.key`**: 첫 기동 시 32B 무작위로 `run/session.key`(POSIX 0600, Windows `icacls <file> /inheritance:r /grant:r "%USERNAME%:F"`)에 만들고 재기동 후에도 유지한다 → 북마크·새 탭·재기동 후 새로고침에서 재인증 0. `fathom doctor --rotate-session-key`로 모든 세션 무효화. 로그아웃(`POST /api/v1/session/logout`)은 해당 쿠키만 지운다(무상태 검증이므로 전 세션 폐기는 키 회전).
7. **SSE**: `GET /api/v1/stream`은 쿠키만 요구(상태 변경 아님).
8. **폴백 포트**: origin이 바뀌면 쿠키 포트 불일치 → `fathom open`으로 재교환 + PWA 재설치 배너 1회.

### 2. CLI 인증

`run/cli.token`(32B, **기동마다 회전**, 0600/icacls) → `Authorization: Bearer`. 권한 = `/api/v1/cli/*`만(FR-SET-015 명령 표면). 브라우저 경로와 라우트가 분리된다.

### 3. 내부 서비스 인증(NFR-SEC-003)

supervisor가 기동마다 호출자 서비스별 256bit 토큰 5개(gateway·content·learning·ai-gateway·ops-api)를 메모리에서 만들고, fork 직후 **IPC 부트스트랩 봉투로만** 전달한다(env·디스크·로그 0, ADR-012). 각 서비스는 자기 `self_token`과 "나를 불러도 되는 서비스의 토큰" 맵(`callers`)만 받는다. 피호출자는 `Authorization: Bearer`를 상수 시간 비교로 호출자에 매핑하고 라우트 `allowedCallers`를 적용한다(401/403). 러너·CLI·pipeline·packc 자식에는 토큰을 주지 않는다. 컨테이너 뷰는 예외(ADR-014).

### 4. API 키·KEK 저장(AQ-06, NFR-SEC-004)

| 순위 | 저장소 | 방법(비밀은 항상 stdin, argv 0, `execFile`·`shell:false`) |
|---|---|---|
| 1 | OS 키체인 — 항목 `fathom.provider.<id>` | macOS `security -i`(명령 줄 자체를 stdin으로: `add-generic-password -U -a fathom -s fathom.provider.<id> -w <secret>` / `find-generic-password … -w`) · Linux `secret-tool store --label="Fathom <id>" service fathom account <id>`(비밀 stdin) / `secret-tool lookup …` · Windows `powershell -NoProfile -NonInteractive -Command -`에 DPAPI 스크립트를 stdin으로(`ProtectedData.Protect(…, 'CurrentUser')` → `secrets/dpapi/<id>.bin`) |
| 2 | 암호 파일 `secrets/ai-keys.enc` | DEK/KEK 2층(아래) |
| 3 | env(`ANTHROPIC_API_KEY`·`OPENAI_API_KEY`·`GEMINI_API_KEY`·`TYPESAFE_API_KEY`) | 읽기 전용, 설정 화면 경고 |

`ai-keys.enc` 형식(정본 = `services/ai-gateway/src/infra/secrets/format.ts` — 서비스 밖으로 나가지 않으므로 contracts에 두지 않는다):

```json
{ "v": 1,
  "kek": { "kind": "os", "ref": "fathom.kek" },
  "dek_wrapped": { "alg": "A256GCM", "iv": "<b64 12B>", "tag": "<b64 16B>", "ct": "<b64>" },
  "data": { "alg": "A256GCM", "iv": "<b64 12B>", "tag": "<b64 16B>", "aad": "fathom-ai-keys-v1", "ct": "<b64(canonical JSON {provider: secret})>" } }
```

- DEK = 32B 무작위. KEK = (a) **OS 바인딩 무작위 32B**(키체인·DPAPI 항목 `fathom.kek`) 또는 (b) **passphrase → `scrypt(N = 2^17, r = 8, p = 1, keylen = 32, maxmem = 256 MiB)`**(`"kek": {"kind": "passphrase", "kdf": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "<b64 16B>"}`, 기동 후 설정 화면에서 잠금 해제, 메모리만). Node `crypto.scrypt` 기본 `maxmem`(32MiB)으로는 N=2^17이 실패하므로 `maxmem` 지정이 필수다. **KEK 평문을 같은 디스크에 두지 않는다.**
- 키는 ai-gateway 메모리에만 있다. 응답 형태는 `{provider, source: 'keychain'|'file'|'env', last4, verifiedAt}`. 키 회전은 새 키 probe 성공 시에만 원자 교체. 구독 모드 `claude` 자식 env에서 `ANTHROPIC_API_KEY` 제거, 부모 env에 키가 있으면 경고(FR-AI-022).
- 설정 화면 → gateway → ai-gateway `PUT /internal/v1/secrets/{provider}` 본문의 비밀은 로그 redact, 응답·DB 저장 0.
- **백업 암호화 passphrase는 AI 키 KEK와 별도**다(다른 기기에서 복원해야 하므로 OS 바인딩 불가). 같은 scrypt 파라미터.

### 5. 위협 모델

| 범위 안(방어) | 범위 밖(명시) |
|---|---|
| 브라우저 교차 출처·DNS rebinding·CSRF, 같은 host 다른 포트의 쿠키 수신, 로그·Referer 토큰 노출, 러너 학습자 코드(토큰 없음), CLI 사용자 설정 주입, 가져온 콘텐츠 인젝션, 백업·export·동기화 폴더 유출(선택 암호화·키 제외), `ps`·env 비밀 노출 | 같은 OS 사용자 권한의 악성 프로세스(키체인·메모리·`session.key` 접근 가능), 물리 접근·관리자 권한, 커널·V8 0-day |

### 6. 검증(V-build)

부트스트랩 토큰 재사용 → 401 · 다른 포트의 테스트 페이지에서 교차 출처 fetch로 세션·CSRF 획득 0 · Host·Origin 불일치 421/403 · 재기동 후 기존 탭 새로고침 → 재인증 없이 200 · 쿠키 포트 변조 → 401 · DB·로그·export 키 문자열 grep 0 · 키 저장·조회 중 `ps` 인자 비밀 0 · 다른 서비스 코드의 SecretStore import 0(경계 검사). 3 엔진 쿠키 동작은 V-ci.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| sessionStorage + BroadcastChannel(v1.0) | 쿠키 문제 없음 | 매 기동 재인증, 새 창 공유 불가 | Deprecated |
| 쿼리 문자열 `?t=` 부트스트랩(A 원안) | 단순 | 서버 로그·Referer·브라우저 기록에 토큰 | 기각(fragment) |
| 자체서명 TLS + `Secure`·`__Host-` 쿠키 | 표준 강화 | 인증서 신뢰 설치 마찰, 3 OS 차이 | 기각(v1.x LAN 페어링 때 재검토) |
| env로 키·내부 토큰 전달(B) | 단순 | `/proc/<pid>/environ` 노출, 상속 | 기각 |
| keytar 등 네이티브 키체인 모듈 | API 편의 | 네이티브 빌드(NFR-PORT-003 위반) | 기각(OS CLI + stdin) |
| scrypt N=2^15(B) | 빠른 잠금 해제 | 오프라인 공격 비용 1/4 | 기각(N=2^17) |
| JWT 세션 | 표준 | 로컬 단일 사용자에 이득 없음, 알고리즘 혼동 위험 | 기각(HMAC 쿠키) |

## 결과 (Consequences)

- **긍정**: 매일 진입이 북마크 클릭 1회로 끝난다. 쿠키·CSRF·Host·Origin·포트 바인딩이 개발과 운영에서 같게 동작한다(dev도 gateway 단일 origin). 비밀이 argv·env·디스크 평문에 남지 않는다.
- **부정**: 무상태 쿠키라 개별 세션 폐기가 키 회전뿐이다(단일 사용자라 수용). 폴백 포트에서는 재교환이 필요하다. 3 OS 키체인 명령의 실제 동작은 V-live 검증이 필요하다.
- **후속**: IF-01이 `/api/v1/session/*`·`/api/v1/cli/*` 계약과 오류 코드(`GW-AUTH-001~004`)를 고정. TST-01이 교차 출처 테스트 페이지(다른 포트) 하네스를 정의. NFR-SEC-019 문구 CR-06.

## 동결 영향

쿠키 형식·검사 순서·부트스트랩 경로, 내부 토큰 전달 방식, 키 저장 우선순위·`ai-keys.enc` 형식·scrypt 파라미터, 위협 모델은 상세 동결이다.
