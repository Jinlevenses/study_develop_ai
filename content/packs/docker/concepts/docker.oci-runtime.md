---
schema_v: 1
id: docker.oci-runtime
track: docker
level: 4
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "OCI 스펙·containerd·runc", en: "Oci runtime" }
summary_ko: "OCI 스펙·containerd·runc: 컨테이너 트랙의 L4 개념이다."
aliases: ["Oci runtime"]
tags: []
volatility: stable
required_for_level: null
prereqs: [docker.image-layer, linux.cgroups-namespaces]
sources:
  - { source_id: src.docker-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

OCI 스펙·containerd·runc: 컨테이너 트랙의 L4 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: OCI 스펙·containerd·runc는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: OCI 스펙·containerd·runc가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: OCI 스펙·containerd·runc를 쓰지 않는 편이 나은 상황은?
