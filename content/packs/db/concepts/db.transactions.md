---
schema_v: 1
id: db.transactions
track: db
level: 2
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "트랜잭션·ACID", en: "Transactions" }
summary_ko: "트랜잭션·ACID: 데이터베이스 트랙의 L2 개념이다."
aliases: ["Transactions"]
tags: []
volatility: stable
required_for_level: null
prereqs: [db.sql-basics]
sources:
  - { source_id: src.postgres-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

트랜잭션·ACID: 데이터베이스 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 트랜잭션·ACID는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 트랜잭션·ACID가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 트랜잭션·ACID를 쓰지 않는 편이 나은 상황은?
