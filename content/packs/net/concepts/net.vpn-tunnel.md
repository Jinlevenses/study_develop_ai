---
schema_v: 1
id: net.vpn-tunnel
track: net
level: 3
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "VPN·터널링 (IPsec, WireGuard)", en: "Vpn tunnel" }
summary_ko: "VPN·터널링 (IPsec, WireGuard): 네트워크·프로토콜 트랙의 L3 개념이다."
aliases: ["Vpn tunnel"]
tags: []
volatility: stable
required_for_level: null
prereqs: [net.nat-routing]
sources:
  - { source_id: src.rfc-9293, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

VPN·터널링 (IPsec, WireGuard): 네트워크·프로토콜 트랙의 L3 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: VPN·터널링 (IPsec, WireGuard)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: VPN·터널링 (IPsec, WireGuard)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: VPN·터널링 (IPsec, WireGuard)를 쓰지 않는 편이 나은 상황은?
