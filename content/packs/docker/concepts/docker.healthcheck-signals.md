---
schema_v: 1
id: docker.healthcheck-signals
track: docker
level: 2
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "헬스체크·시그널·PID 1 문제", en: "Healthcheck signals" }
summary_ko: "헬스체크·시그널·PID 1 문제: 컨테이너 트랙의 L2 개념이다."
aliases: ["Healthcheck signals"]
tags: []
volatility: stable
required_for_level: null
prereqs: [docker.run-lifecycle, linux.process-mgmt]
sources:
  - { source_id: src.docker-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

헬스체크·시그널·PID 1 문제: 컨테이너 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 헬스체크·시그널·PID 1 문제는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 헬스체크·시그널·PID 1 문제가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 헬스체크·시그널·PID 1 문제를 쓰지 않는 편이 나은 상황은?
