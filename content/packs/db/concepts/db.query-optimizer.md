---
schema_v: 1
id: db.query-optimizer
track: db
level: 5
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "옵티마이저 내부 (카디널리티 추정, 조인 알고리즘)", en: "Query optimizer" }
summary_ko: "옵티마이저 내부 (카디널리티 추정, 조인 알고리즘): 데이터베이스 트랙의 L5 개념이다."
aliases: ["Query optimizer"]
tags: []
volatility: stable
required_for_level: null
prereqs: [db.query-plan]
sources:
  - { source_id: src.postgres-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

옵티마이저 내부 (카디널리티 추정, 조인 알고리즘): 데이터베이스 트랙의 L5 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 옵티마이저 내부 (카디널리티 추정, 조인 알고리즘)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 옵티마이저 내부 (카디널리티 추정, 조인 알고리즘)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 옵티마이저 내부 (카디널리티 추정, 조인 알고리즘)를 쓰지 않는 편이 나은 상황은?
