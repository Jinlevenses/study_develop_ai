---
schema_v: 1
id: docker.networking
track: docker
level: 2
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "컨테이너 네트워크 (bridge, 포트 매핑, 내장 DNS)", en: "Networking" }
summary_ko: "컨테이너 네트워크 (bridge, 포트 매핑, 내장 DNS): 컨테이너 트랙의 L2 개념이다."
aliases: ["Networking"]
tags: []
volatility: stable
required_for_level: null
prereqs: [docker.run-lifecycle, net.ip-addressing]
sources:
  - { source_id: src.docker-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

컨테이너 네트워크 (bridge, 포트 매핑, 내장 DNS): 컨테이너 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 컨테이너 네트워크 (bridge, 포트 매핑, 내장 DNS)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 컨테이너 네트워크 (bridge, 포트 매핑, 내장 DNS)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 컨테이너 네트워크 (bridge, 포트 매핑, 내장 DNS)를 쓰지 않는 편이 나은 상황은?
