---
schema_v: 1
id: net.kernel-net
track: net
level: 5
tier: C
knowledge_type: { primary: P, secondary: [] }
stage2_kind: code
title: { ko: "커널 네트워크 스택 튜닝 (backlog, conntrack, SO_REUSEPORT)", en: "Kernel net" }
summary_ko: "커널 네트워크 스택 튜닝 (backlog, conntrack, SO_REUSEPORT): 네트워크·프로토콜 트랙의 L5 개념이다."
aliases: ["Kernel net"]
tags: []
volatility: stable
required_for_level: null
prereqs: [net.socket, cs.kernel-internals]
sources:
  - { source_id: src.rfc-9293, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

커널 네트워크 스택 튜닝 (backlog, conntrack, SO_REUSEPORT): 네트워크·프로토콜 트랙의 L5 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 커널 네트워크 스택 튜닝 (backlog, conntrack, SO_REUSEPORT)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 커널 네트워크 스택 튜닝 (backlog, conntrack, SO_REUSEPORT)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 커널 네트워크 스택 튜닝 (backlog, conntrack, SO_REUSEPORT)를 쓰지 않는 편이 나은 상황은?
