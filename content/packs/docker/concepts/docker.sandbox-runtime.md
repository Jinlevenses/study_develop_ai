---
schema_v: 1
id: docker.sandbox-runtime
track: docker
level: 5
tier: C
knowledge_type: { primary: S, secondary: [] }
stage2_kind: case
title: { ko: "rootless·샌드박스 런타임 (gVisor, Kata)", en: "Sandbox runtime" }
summary_ko: "rootless·샌드박스 런타임 (gVisor, Kata): 컨테이너 트랙의 L5 개념이다."
aliases: ["Sandbox runtime"]
tags: []
volatility: stable
required_for_level: null
prereqs: [docker.oci-runtime]
sources:
  - { source_id: src.docker-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

rootless·샌드박스 런타임 (gVisor, Kata): 컨테이너 트랙의 L5 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: rootless·샌드박스 런타임 (gVisor, Kata)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: rootless·샌드박스 런타임 (gVisor, Kata)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: rootless·샌드박스 런타임 (gVisor, Kata)를 쓰지 않는 편이 나은 상황은?
