---
schema_v: 1
id: net.tcp-flow-congestion
track: net
level: 3
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "흐름 제어·혼잡 제어 (CUBIC, BBR)", en: "Tcp flow congestion" }
summary_ko: "흐름 제어·혼잡 제어 (CUBIC, BBR): 네트워크·프로토콜 트랙의 L3 개념이다."
aliases: ["Tcp flow congestion"]
tags: []
volatility: stable
required_for_level: null
prereqs: [net.tcp-handshake]
sources:
  - { source_id: src.rfc-9293, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

흐름 제어·혼잡 제어 (CUBIC, BBR): 네트워크·프로토콜 트랙의 L3 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 흐름 제어·혼잡 제어 (CUBIC, BBR)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 흐름 제어·혼잡 제어 (CUBIC, BBR)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 흐름 제어·혼잡 제어 (CUBIC, BBR)를 쓰지 않는 편이 나은 상황은?
