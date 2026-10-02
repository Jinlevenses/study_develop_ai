---
schema_v: 1
id: net.socket
track: net
level: 2
tier: C
knowledge_type: { primary: P, secondary: [] }
stage2_kind: code
title: { ko: "소켓 프로그래밍", en: "Socket" }
summary_ko: "소켓 프로그래밍: 네트워크·프로토콜 트랙의 L2 개념이다."
aliases: ["Socket"]
tags: []
volatility: stable
required_for_level: null
prereqs: [net.tcp-handshake, cs.syscall]
sources:
  - { source_id: src.rfc-9293, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

소켓 프로그래밍: 네트워크·프로토콜 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 소켓 프로그래밍는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 소켓 프로그래밍가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 소켓 프로그래밍를 쓰지 않는 편이 나은 상황은?
