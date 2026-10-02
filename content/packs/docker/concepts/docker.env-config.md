---
schema_v: 1
id: docker.env-config
track: docker
level: 2
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "환경 변수·설정 주입·12-Factor", en: "Env config" }
summary_ko: "환경 변수·설정 주입·12-Factor: 컨테이너 트랙의 L2 개념이다."
aliases: ["Env config"]
tags: []
volatility: stable
required_for_level: null
prereqs: [docker.run-lifecycle]
sources:
  - { source_id: src.docker-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

환경 변수·설정 주입·12-Factor: 컨테이너 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 환경 변수·설정 주입·12-Factor는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 환경 변수·설정 주입·12-Factor가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 환경 변수·설정 주입·12-Factor를 쓰지 않는 편이 나은 상황은?
