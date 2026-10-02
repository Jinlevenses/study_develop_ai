---
schema_v: 1
id: k8s.probes
track: k8s
level: 2
tier: B
knowledge_type: { primary: P, secondary: [] }
stage2_kind: code
title: { ko: "프로브(Liveness·Readiness)", en: "Probes" }
summary_ko: "kubelet이 컨테이너의 상태를 주기적으로 검사해 재시작과 트래픽 제외를 결정하는 장치다."
aliases: ["Probes", "헬스 체크"]
tags: ["qa:reliability"]
volatility: evolving
required_for_level: 2
prereqs: [k8s.pod]
siblings: {}
extends: []
deprecated_by: null
id_aliases: []
sources:
  - { source_id: src.k8s-docs, locator: "/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/", section: "Configure Liveness, Readiness and Startup Probes", usage: paraphrase, retrieved_at: "2026-10-01" }
review: { valid_as_of: "2026-10-01", review_by: "2027-03-30" }
---

## 이론

프로브(probe)는 kubelet이 컨테이너 상태를 주기적으로 확인하는 검사다. liveness 프로브가 실패하면 컨테이너를 재시작하고, readiness 프로브가 실패하면 서비스 엔드포인트에서 Pod를 뺀다.

## 코드

```yaml
readinessProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 5
```

## 핵심

::ku-list
