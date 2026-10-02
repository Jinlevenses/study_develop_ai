---
schema_v: 1
id: net.latency-tail
track: net
level: 4
tier: C
knowledge_type: { primary: S, secondary: [] }
stage2_kind: case
title: { ko: "지연·대역폭·BDP·tail latency", en: "Latency tail" }
summary_ko: "지연·대역폭·BDP·tail latency: 네트워크·프로토콜 트랙의 L4 개념이다."
aliases: ["Latency tail"]
tags: []
volatility: stable
required_for_level: null
prereqs: [net.tcp-flow-congestion]
sources:
  - { source_id: src.rfc-9293, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

지연·대역폭·BDP·tail latency: 네트워크·프로토콜 트랙의 L4 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 지연·대역폭·BDP·tail latency는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 지연·대역폭·BDP·tail latency가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 지연·대역폭·BDP·tail latency를 쓰지 않는 편이 나은 상황은?
