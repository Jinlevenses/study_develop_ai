---
schema_v: 1
id: net.tls
track: net
level: 2
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "TLS 1.3·인증서 체인", en: "Tls" }
summary_ko: "TLS 1.3·인증서 체인: 네트워크·프로토콜 트랙의 L2 개념이다."
aliases: ["Tls"]
tags: []
volatility: stable
required_for_level: null
prereqs: [net.tcp-handshake, sec.crypto-basics]
sources:
  - { source_id: src.rfc-9293, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

TLS 1.3·인증서 체인: 네트워크·프로토콜 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: TLS 1.3·인증서 체인는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: TLS 1.3·인증서 체인가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: TLS 1.3·인증서 체인를 쓰지 않는 편이 나은 상황은?
