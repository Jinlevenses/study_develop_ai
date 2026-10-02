---
schema_v: 1
id: k8s.pod
track: k8s
level: 1
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "Pod (멀티 컨테이너, init/sidecar)", en: "Pod" }
summary_ko: "Pod (멀티 컨테이너, init/sidecar): 쿠버네티스 트랙의 L1 개념이다."
aliases: ["Pod"]
tags: []
volatility: evolving
required_for_level: null
prereqs: [docker.dockerfile]
sources:
  - { source_id: src.k8s-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-01" }
review: { valid_as_of: "2026-10-01", review_by: "2027-03-30" }
---

## 이론

Pod (멀티 컨테이너, init/sidecar): 쿠버네티스 트랙의 L1 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: Pod (멀티 컨테이너, init/sidecar)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: Pod (멀티 컨테이너, init/sidecar)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: Pod (멀티 컨테이너, init/sidecar)를 쓰지 않는 편이 나은 상황은?
