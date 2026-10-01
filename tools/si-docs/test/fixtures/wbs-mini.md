# WBS mini

### 17.2 packages · tools

| PGM-ID | 유형 | 단위 | 모듈 · 파일 경로 | 설명 | 관련 FR·NFR | IF | SCR | WP |
|---|---|---|---|---|---|---|---|---|
| PGM-SYS-101 | CFG | repo | `package.json`, `tsconfig*.json` | 루트 설정 | NFR-MAINT-005 | — | — | WP-00-01 |
| PGM-GATE-001 | GATE | tools/gates | `tools/gates/lib/{lex,common}.mjs` | 공용 | NFR-MAINT-001 | — | — | WP-00-10 |
| PGM-CT-001 | UC | content/catalog | `services/content/src/application/<bc>/install.ts`, `infra/packs/**` | 설치 | FR-CUR-002 | IF-CT-001 | — | WP-01-02 |
| PGM-CT-002 | UC | content | `services/content/src/jobs/pack-load.ts` | 적재 | FR-CUR-002 | — | — | WP-01-02 |
