# RTM mini (si-docs 테스트 fixture — 09-rtm.md 의 표 구조만 축소)

## 2. UR → FR 요약

| UR | 요지 | FR 수 | NFR 수 | 대표 FR |
|---|---|---|---|---|
| UR-01 | 전 분야 | 2 | 1 | FR-CUR-001 |

## 3. FR 추적표

### 3.1 FR-PRG

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-PRG-001 | 원장 멱등 \| 재수신 | Must·R0 | UR-12 | V-build | learning | IF-LR-010 | lr_event | — | — | UT-LR-012 | WP-02-01 | INT-1a |
| FR-CUR-001 | 팩 설치 | Must·R0 | UR-01 | V-build | content | IF-CT-001 | pack | SCR-04 | — | UT-CT-001 | WP-01-02 | INT-1a |
| FR-AI-001 | 제공자 probe | Must·R0 | UR-15 | B+V-live | ai | IF-AI-025 | ai_probe | — | — | UT-AI-001 | WP-04-08 | INT-1b |
| FR-AI-002 | 모드 칩 | Should·R2 | UR-15 | V-build | ai | — | — | — | — | — | WP-04-09 | INT-2~3 |
| FR-SET-024 | 자동 기동 | Should·R3 | UR-15 | B+V-ci/V-live | cli | — | — | — | — | — | WP-07-18 | v1 이월 |

## 4. NFR 추적표

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|
| NFR-DATA-013 | 이벤트 멱등 | Must·R0 | UR-17 | V-build | learning | IF-EV-01 | lr_inbox | — | WP-00-21 | INT-1a |
| NFR-PORT-001 | 이식성 | Must·R1 | UR-15 | B+V-ci | tests | — | — | UT-TK-001 | WP-07-18 | INT-2 |

## 7. `verification-class.json` 초안

```json
{ "default": "V-build",
  "exceptions": {
    "FR-AI-001": {"build": true, "beyond": ["V-live"]},
    "FR-SET-024": {"build": true, "beyond": ["V-ci", "V-live"]},
    "NFR-PORT-001": {"build": true, "beyond": ["V-ci"]},
    "FR-CUR-001": {"build": true, "beyond": ["V-field"]}
  } }
```
