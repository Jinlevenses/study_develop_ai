---
schema_v: 1
id: arch.distributed-time
track: arch
level: 4
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "시간·순서 (Lamport, vector clock, HLC)", en: "Distributed time" }
summary_ko: "시간·순서 (Lamport, vector clock, HLC): 아키텍처·시스템 설계 트랙의 L4 개념이다."
aliases: ["Distributed time"]
tags: []
volatility: stable
required_for_level: null
prereqs: [arch.consistency-models]
sources:
  - { source_id: src.system-design-primer, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

시간·순서 (Lamport, vector clock, HLC): 아키텍처·시스템 설계 트랙의 L4 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 시간·순서 (Lamport, vector clock, HLC)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 시간·순서 (Lamport, vector clock, HLC)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 시간·순서 (Lamport, vector clock, HLC)를 쓰지 않는 편이 나은 상황은?
