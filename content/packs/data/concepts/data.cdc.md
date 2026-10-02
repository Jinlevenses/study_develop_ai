---
schema_v: 1
id: data.cdc
track: data
level: 4
tier: C
knowledge_type: { primary: P, secondary: [] }
stage2_kind: code
title: { ko: "CDC (Debezium, 로그 기반)", en: "Cdc" }
summary_ko: "CDC (Debezium, 로그 기반): 데이터 엔지니어링 트랙의 L4 개념이다."
aliases: ["Cdc"]
tags: []
volatility: evolving
required_for_level: null
prereqs: [db.wal-recovery]
sources:
  - { source_id: src.postgres-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2027-03-31" }
---

## 이론

CDC (Debezium, 로그 기반): 데이터 엔지니어링 트랙의 L4 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: CDC (Debezium, 로그 기반)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: CDC (Debezium, 로그 기반)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: CDC (Debezium, 로그 기반)를 쓰지 않는 편이 나은 상황은?
