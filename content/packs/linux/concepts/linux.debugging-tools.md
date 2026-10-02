---
schema_v: 1
id: linux.debugging-tools
track: linux
level: 4
tier: C
knowledge_type: { primary: P, secondary: [] }
stage2_kind: code
title: { ko: "저수준 디버깅 (strace, lsof, gdb, core dump)", en: "Debugging tools" }
summary_ko: "저수준 디버깅 (strace, lsof, gdb, core dump): 서버·리눅스 운영 트랙의 L4 개념이다."
aliases: ["Debugging tools"]
tags: []
volatility: stable
required_for_level: null
prereqs: [cs.syscall]
sources:
  - { source_id: src.linux-man-pages, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

저수준 디버깅 (strace, lsof, gdb, core dump): 서버·리눅스 운영 트랙의 L4 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: 저수준 디버깅 (strace, lsof, gdb, core dump)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: 저수준 디버깅 (strace, lsof, gdb, core dump)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: 저수준 디버깅 (strace, lsof, gdb, core dump)를 쓰지 않는 편이 나은 상황은?
