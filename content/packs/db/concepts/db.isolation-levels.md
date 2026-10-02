---
schema_v: 1
id: db.isolation-levels
track: db
level: 3
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "격리 수준·이상 현상", en: "Isolation levels" }
summary_ko: "격리 수준·이상 현상: 데이터베이스 트랙의 L3 개념이다."
aliases: ["Isolation levels"]
tags: []
volatility: stable
required_for_level: null
prereqs: [db.transactions]
sources:
  - { source_id: src.postgres-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

격리 수준·이상 현상: 데이터베이스 트랙의 L3 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 격리 수준·이상 현상는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 격리 수준·이상 현상가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 격리 수준·이상 현상를 쓰지 않는 편이 나은 상황은?
