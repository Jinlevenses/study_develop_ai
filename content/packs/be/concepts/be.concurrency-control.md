---
schema_v: 1
id: be.concurrency-control
track: be
level: 3
tier: C
knowledge_type: { primary: S, secondary: [] }
stage2_kind: case
title: { ko: "동시성 제어 (낙관/비관 락, 분산 락)", en: "Concurrency control" }
summary_ko: "동시성 제어 (낙관/비관 락, 분산 락): 백엔드 트랙의 L3 개념이다."
aliases: ["Concurrency control"]
tags: []
volatility: stable
required_for_level: null
prereqs: [db.isolation-levels]
sources:
  - { source_id: src.rfc-9110, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

동시성 제어 (낙관/비관 락, 분산 락): 백엔드 트랙의 L3 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 동시성 제어 (낙관/비관 락, 분산 락)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 동시성 제어 (낙관/비관 락, 분산 락)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 동시성 제어 (낙관/비관 락, 분산 락)를 쓰지 않는 편이 나은 상황은?
