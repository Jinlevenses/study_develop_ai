---
schema_v: 1
id: k8s.network-policy
track: k8s
level: 3
tier: C
knowledge_type: { primary: P, secondary: [] }
stage2_kind: code
title: { ko: "NetworkPolicy", en: "Network policy" }
summary_ko: "NetworkPolicy: 쿠버네티스 트랙의 L3 개념이다."
aliases: ["Network policy"]
tags: []
volatility: evolving
required_for_level: null
prereqs: [k8s.networking-cni]
sources:
  - { source_id: src.k8s-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2027-03-31" }
---

## 이론

NetworkPolicy: 쿠버네티스 트랙의 L3 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: NetworkPolicy는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: NetworkPolicy가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: NetworkPolicy를 쓰지 않는 편이 나은 상황은?
