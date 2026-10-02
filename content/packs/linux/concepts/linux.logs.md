---
schema_v: 1
id: linux.logs
track: linux
level: 2
tier: C
knowledge_type: { primary: P, secondary: [] }
stage2_kind: code
title: { ko: "로그 관리 (logrotate, rsyslog)", en: "Logs" }
summary_ko: "로그 관리 (logrotate, rsyslog): 서버·리눅스 운영 트랙의 L2 개념이다."
aliases: ["Logs"]
tags: []
volatility: stable
required_for_level: null
prereqs: [linux.systemd]
sources:
  - { source_id: src.linux-man-pages, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

로그 관리 (logrotate, rsyslog): 서버·리눅스 운영 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 로그 관리 (logrotate, rsyslog)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 로그 관리 (logrotate, rsyslog)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 로그 관리 (logrotate, rsyslog)를 쓰지 않는 편이 나은 상황은?
