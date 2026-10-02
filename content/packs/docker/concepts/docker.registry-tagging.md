---
schema_v: 1
id: docker.registry-tagging
track: docker
level: 3
tier: C
knowledge_type: { primary: S, secondary: [] }
stage2_kind: case
title: { ko: "레지스트리·태깅 전략 (immutable tag, digest pinning)", en: "Registry tagging" }
summary_ko: "레지스트리·태깅 전략 (immutable tag, digest pinning): 컨테이너 트랙의 L3 개념이다."
aliases: ["Registry tagging"]
tags: []
volatility: stable
required_for_level: null
prereqs: [docker.image-layer]
sources:
  - { source_id: src.docker-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

레지스트리·태깅 전략 (immutable tag, digest pinning): 컨테이너 트랙의 L3 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 레지스트리·태깅 전략 (immutable tag, digest pinning)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 레지스트리·태깅 전략 (immutable tag, digest pinning)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 레지스트리·태깅 전략 (immutable tag, digest pinning)를 쓰지 않는 편이 나은 상황은?
