-- @fathom:module=catalog version=2 kind=additive
-- services/content/migrations/catalog/0002_catalog_search.sql
-- SP-4 V2 하이브리드 검색(+ V3 전환 대비 unicode61 prefix 색인). 외부 콘텐츠 FTS5 3종 + 동기화 트리거 3종.
-- 색인 문서는 활성·적재 중 설치에만 존재한다(은퇴 설치 문서는 전환 후 배치 삭제). 질의는 ct_pack_active와 JOIN.

-- @table 검색 문서(개념·KU·오개념·Case·경로). FTS5 external content의 원본. 값은 NFC 정규화, ntext·compact는 NFC + 소문자. FR-CUR-011, FR-IMP-014
CREATE TABLE ct_search_doc(
  doc_id     INTEGER PRIMARY KEY,                                                  -- FTS rowid(정수 필수). 재사용 금지는 요구하지 않음
  install_id TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE,    -- 설치 범위
  kind       TEXT    NOT NULL CHECK (kind IN ('concept','ku','misconception','case','path')), -- 문서 종류(IF-01 SearchQuery.kinds와 동일 집합, CR-52)
  ref_id     TEXT    NOT NULL,                                                     -- 원 레코드 ID(concept_id·ku_id·mc_id·case_id·path_id)
  concept_id TEXT    NOT NULL,                                                     -- 결과를 개념으로 묶는 키
  track_id   TEXT    NOT NULL,                                                     -- 트랙 필터
  title      TEXT    NOT NULL,                                                     -- 제목(오버레이 반영값, NFC)
  alias      TEXT    NOT NULL DEFAULT '',                                          -- 동의어·영문명·약어 공백 연결(NFC)
  body       TEXT    NOT NULL DEFAULT '',                                          -- 요약·진술(NFC)
  ntext      TEXT    NOT NULL,                                                     -- lower(NFC(title||'\n'||alias||'\n'||body)) — 3자 미만 토큰 instr() 스캔용
  compact    TEXT    NOT NULL,                                                     -- ntext에서 공백 제거 — 띄어쓰기 차이 흡수
  initials   TEXT    NOT NULL DEFAULT '',                                          -- 한글 초성열(es-hangul, 적재 시 앱이 계산) — 초성 질의 instr() 스캔용
  UNIQUE (install_id, kind, ref_id)
) STRICT;
CREATE INDEX ix_ct_search_doc_concept ON ct_search_doc(concept_id);

-- trigram: 3자 이상 부분 일치(V2 AND 단계). bm25 가중 = (title 10, alias 5, body 1)
CREATE VIRTUAL TABLE ct_fts_tri USING fts5(title, alias, body, content='ct_search_doc', content_rowid='doc_id', tokenize='trigram');
-- trigram(공백 제거 열): '이벤트루프' ↔ '이벤트 루프'
CREATE VIRTUAL TABLE ct_fts_cmp USING fts5(compact, content='ct_search_doc', content_rowid='doc_id', tokenize='trigram');
-- unicode61 + prefix: 문서 수 > search_params@v1.v3_switch_docs(20,000)일 때만 짧은 토큰 경로로 사용(V3). 색인은 처음부터 유지(스위치 = 정책 값)
CREATE VIRTUAL TABLE ct_fts_uni USING fts5(title, alias, body, content='ct_search_doc', content_rowid='doc_id', tokenize='unicode61 remove_diacritics 2', prefix='2 3');

-- 외부 콘텐츠 동기화(FTS5 표준 레시피: 'delete' 명령 후 재삽입)
CREATE TRIGGER ct_search_doc_ai AFTER INSERT ON ct_search_doc BEGIN
  INSERT INTO ct_fts_tri(rowid, title, alias, body) VALUES (new.doc_id, new.title, new.alias, new.body);
  INSERT INTO ct_fts_cmp(rowid, compact) VALUES (new.doc_id, new.compact);
  INSERT INTO ct_fts_uni(rowid, title, alias, body) VALUES (new.doc_id, new.title, new.alias, new.body);
END;
CREATE TRIGGER ct_search_doc_ad AFTER DELETE ON ct_search_doc BEGIN
  INSERT INTO ct_fts_tri(ct_fts_tri, rowid, title, alias, body) VALUES ('delete', old.doc_id, old.title, old.alias, old.body);
  INSERT INTO ct_fts_cmp(ct_fts_cmp, rowid, compact) VALUES ('delete', old.doc_id, old.compact);
  INSERT INTO ct_fts_uni(ct_fts_uni, rowid, title, alias, body) VALUES ('delete', old.doc_id, old.title, old.alias, old.body);
END;
CREATE TRIGGER ct_search_doc_au AFTER UPDATE ON ct_search_doc BEGIN
  INSERT INTO ct_fts_tri(ct_fts_tri, rowid, title, alias, body) VALUES ('delete', old.doc_id, old.title, old.alias, old.body);
  INSERT INTO ct_fts_cmp(ct_fts_cmp, rowid, compact) VALUES ('delete', old.doc_id, old.compact);
  INSERT INTO ct_fts_uni(ct_fts_uni, rowid, title, alias, body) VALUES ('delete', old.doc_id, old.title, old.alias, old.body);
  INSERT INTO ct_fts_tri(rowid, title, alias, body) VALUES (new.doc_id, new.title, new.alias, new.body);
  INSERT INTO ct_fts_cmp(rowid, compact) VALUES (new.doc_id, new.compact);
  INSERT INTO ct_fts_uni(rowid, title, alias, body) VALUES (new.doc_id, new.title, new.alias, new.body);
END;
