---
schema_v: 1
id: docker.storage-driver
track: docker
level: 4
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "스토리지 드라이버 (overlayfs, CoW)", en: "Storage driver" }
summary_ko: "스토리지 드라이버 (overlayfs, CoW): 컨테이너 트랙의 L4 개념이다."
aliases: ["Storage driver"]
tags: []
volatility: stable
required_for_level: null
prereqs: [docker.image-layer, cs.file-system]
sources:
  - { source_id: src.docker-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

스토리지 드라이버 (overlayfs, CoW): 컨테이너 트랙의 L4 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 스토리지 드라이버 (overlayfs, CoW)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 스토리지 드라이버 (overlayfs, CoW)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 스토리지 드라이버 (overlayfs, CoW)를 쓰지 않는 편이 나은 상황은?
