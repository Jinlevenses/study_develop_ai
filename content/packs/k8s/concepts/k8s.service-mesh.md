---
schema_v: 1
id: k8s.service-mesh
track: k8s
level: 4
tier: C
knowledge_type: { primary: S, secondary: [] }
stage2_kind: case
title: { ko: "서비스 메시 (Istio/Linkerd, sidecar vs ambient)", en: "Service mesh" }
summary_ko: "서비스 메시 (Istio/Linkerd, sidecar vs ambient): 쿠버네티스 트랙의 L4 개념이다."
aliases: ["Service mesh"]
tags: []
volatility: evolving
required_for_level: null
prereqs: [k8s.networking-cni]
sources:
  - { source_id: src.k8s-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2027-03-31" }
---

## 이론

서비스 메시 (Istio/Linkerd, sidecar vs ambient): 쿠버네티스 트랙의 L4 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 서비스 메시 (Istio/Linkerd, sidecar vs ambient)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 서비스 메시 (Istio/Linkerd, sidecar vs ambient)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 서비스 메시 (Istio/Linkerd, sidecar vs ambient)를 쓰지 않는 편이 나은 상황은?
