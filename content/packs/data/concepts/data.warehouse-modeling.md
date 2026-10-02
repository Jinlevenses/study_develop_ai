---
schema_v: 1
id: data.warehouse-modeling
track: data
level: 3
tier: C
knowledge_type: { primary: S, secondary: [] }
stage2_kind: case
title: { ko: "차원 모델링 (스타 스키마, SCD)", en: "Warehouse modeling" }
summary_ko: "차원 모델링 (스타 스키마, SCD): 데이터 엔지니어링 트랙의 L3 개념이다."
aliases: ["Warehouse modeling"]
tags: []
volatility: evolving
required_for_level: null
prereqs: [data.pipeline-basics, db.normalization]
sources:
  - { source_id: src.postgres-docs, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2027-03-31" }
---

## 이론

차원 모델링 (스타 스키마, SCD): 데이터 엔지니어링 트랙의 L3 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 차원 모델링 (스타 스키마, SCD)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 차원 모델링 (스타 스키마, SCD)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 차원 모델링 (스타 스키마, SCD)를 쓰지 않는 편이 나은 상황은?
