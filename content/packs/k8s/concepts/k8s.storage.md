---
schema_v: 1
id: k8s.storage
track: k8s
level: 2
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "PV·PVC·StorageClass", en: "Storage" }
summary_ko: "PV·PVC·StorageClass: 쿠버네티스 트랙의 L2 개념이다."
aliases: ["Storage"]
tags: []
volatility: evolving
required_for_level: null
prereqs: [k8s.pod]
sources:
  - { source_id: src.k8s-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2027-03-31" }
---

## 이론

PV·PVC·StorageClass: 쿠버네티스 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: PV·PVC·StorageClass는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: PV·PVC·StorageClass가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: PV·PVC·StorageClass를 쓰지 않는 편이 나은 상황은?
