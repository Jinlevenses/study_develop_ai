---
schema_v: 1
id: sec.password-storage
track: sec
level: 1
tier: C
knowledge_type: { primary: P, secondary: [] }
stage2_kind: code
title: { ko: "비밀번호 저장 (argon2/bcrypt, salt, pepper)", en: "Password storage" }
summary_ko: "비밀번호 저장 (argon2/bcrypt, salt, pepper): 보안 트랙의 L1 개념이다."
aliases: ["Password storage"]
tags: []
volatility: evolving
required_for_level: null
prereqs: [sec.authn-authz]
sources:
  - { source_id: src.owasp-top10, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2027-03-31" }
---

## 이론

비밀번호 저장 (argon2/bcrypt, salt, pepper): 보안 트랙의 L1 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 비밀번호 저장 (argon2/bcrypt, salt, pepper)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 비밀번호 저장 (argon2/bcrypt, salt, pepper)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 비밀번호 저장 (argon2/bcrypt, salt, pepper)를 쓰지 않는 편이 나은 상황은?
