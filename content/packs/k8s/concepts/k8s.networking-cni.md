---
schema_v: 1
id: k8s.networking-cni
track: k8s
level: 3
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "네트워킹 모델·CNI·kube-proxy (iptables/IPVS/eBPF)", en: "Networking cni" }
summary_ko: "네트워킹 모델·CNI·kube-proxy (iptables/IPVS/eBPF): 쿠버네티스 트랙의 L3 개념이다."
aliases: ["Networking cni"]
tags: []
volatility: evolving
required_for_level: null
prereqs: [k8s.service, net.nat-routing]
sources:
  - { source_id: src.k8s-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2027-03-31" }
---

## 이론

네트워킹 모델·CNI·kube-proxy (iptables/IPVS/eBPF): 쿠버네티스 트랙의 L3 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 네트워킹 모델·CNI·kube-proxy (iptables/IPVS/eBPF)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 네트워킹 모델·CNI·kube-proxy (iptables/IPVS/eBPF)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 네트워킹 모델·CNI·kube-proxy (iptables/IPVS/eBPF)를 쓰지 않는 편이 나은 상황은?
