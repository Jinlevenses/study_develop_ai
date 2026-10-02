---
schema_v: 1
id: db.distributed-sql
track: db
level: 5
tier: C
knowledge_type: { primary: S, secondary: [] }
stage2_kind: case
title: { ko: "분산 SQL·NewSQL (Spanner, CockroachDB)", en: "Distributed sql" }
summary_ko: "분산 SQL·NewSQL (Spanner, CockroachDB): 데이터베이스 트랙의 L5 개념이다."
aliases: ["Distributed sql"]
tags: []
volatility: stable
required_for_level: null
prereqs: [db.partitioning-sharding, arch.consistency-models]
sources:
  - { source_id: src.postgres-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

분산 SQL·NewSQL (Spanner, CockroachDB): 데이터베이스 트랙의 L5 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 분산 SQL·NewSQL (Spanner, CockroachDB)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 분산 SQL·NewSQL (Spanner, CockroachDB)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 분산 SQL·NewSQL (Spanner, CockroachDB)를 쓰지 않는 편이 나은 상황은?
