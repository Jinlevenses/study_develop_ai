---
schema_v: 1
id: k8s.probes
track: k8s
level: 2
tier: A
knowledge_type: { primary: C, secondary: [P] }
stage2_kind: code
title: { ko: "프로브(liveness·readiness·startup)", en: "Kubernetes Probes" }
summary_ko: "kubelet은 프로브로 컨테이너를 주기적으로 진단해, liveness 실패는 재시작으로, readiness 실패는 트래픽 제외로, startup은 느린 시작 보호로 처리한다."
aliases: ["liveness probe", "readiness probe", "startup probe", "헬스 체크", "health check", "livenessProbe", "readinessProbe", "startupProbe", "프로브"]
tags: ["qa:reliability", "qa:availability", "lc:operate", "cert:cka", "cert:ckad"]
volatility: evolving
required_for_level: 2
prereqs: [k8s.pod, docker.healthcheck-signals]
siblings: {}
extends: []
deprecated_by: null
id_aliases: []
sources:
  - { source_id: src.k8s-docs, locator: "/concepts/configuration/liveness-readiness-startup-probes/", section: "Liveness, Readiness, and Startup Probes", usage: paraphrase, retrieved_at: "2026-10-02", product_version: "1.34" }
  - { source_id: src.k8s-docs, locator: "/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/", section: "Configure Liveness, Readiness and Startup Probes", usage: paraphrase, retrieved_at: "2026-10-02", product_version: "1.34" }
  - { source_id: src.k8s-docs, locator: "/concepts/workloads/pods/pod-lifecycle/#container-probes", section: "Container probes", usage: paraphrase, retrieved_at: "2026-10-02", product_version: "1.34" }
diagrams:
  dg_probe_flow:
    alt: "startup 성공 뒤 liveness·readiness가 돌고 각 실패가 재시작 또는 트래픽 제외로 이어지는 흐름"
    summary: "컨테이너가 시작되면 startupProbe가 먼저 돈다. 성공하면 liveness와 readiness가 함께 주기적으로 실행되고, startup이 끝내 실패하면 컨테이너가 종료된다. liveness가 연속 실패하면 컨테이너를 재시작하고, readiness가 실패하면 컨테이너는 그대로 두고 Service 엔드포인트에서만 뺀다."
learning:
  objectives:
    ob_1: { bloom: understand, text: "liveness·readiness·startup 프로브가 실패했을 때 kubelet과 Service가 각각 어떻게 반응하는지 설명한다" }
    ob_2: { bloom: apply, text: "시작이 느린 HTTP 서버에 세 프로브를 알맞은 임계값으로 설정한다" }
    ob_3: { bloom: analyze, text: "의존성을 확인하는 liveness처럼 재시작 연쇄를 부르는 프로브 설정 결함을 찾는다" }
  depth_facets:
    l3: "롤링 업데이트·PodDisruptionBudget과 readiness를 엮어 무중단 배포 조건을 설계한다(→ k8s.deployment)"
    l4: "프로브 설계가 연쇄 장애를 키우거나 막는 조건을 판단한다(→ sre.cascading-failure)"
  pre_questions:
    - "readiness 프로브가 실패한 컨테이너는 재시작될까, 아니면 다른 일이 일어날까?"
    - "데이터베이스가 잠깐 끊겼을 때 모든 Pod가 동시에 재시작된다면 어떤 프로브 설정을 의심해야 할까?"
  contrast_pairs:
    cp_live_ready: { a: "liveness 실패", b: "readiness 실패", axis: "컨테이너 재시작 vs 재시작 없이 트래픽 대상에서 제외" }
    cp_startup_delay: { a: "startupProbe", b: "initialDelaySeconds", axis: "시작 완료를 확인할 때까지 보호 vs 고정 시간만큼 무조건 대기" }
  mnemonic: "liveness는 살리고(재시작), readiness는 가린다(트래픽 제외)"
  estimated_minutes: { theory: 12, code: 18, core: 6 }
review: { verified_against: "Kubernetes 1.34", valid_as_of: "2026-10-02", review_by: "2027-03-31" }
---

## 이론

### 왜 필요한가

프로세스가 떠 있다고 해서 일을 할 수 있는 것은 아니다. 교착(deadlock)에 빠진 서버는 프로세스로는 살아 있지만 요청에 답하지 못하고, 막 시작한 서버는 캐시를 채우기 전이라 요청을 받으면 안 된다. 쿠버네티스는 컨테이너 상태를 "실행 중"보다 세밀하게 알아야 재시작할지, 트래픽을 보낼지 판단할 수 있다. 그 판단 근거를 주는 장치가 프로브(probe)다.

### 메커니즘

프로브는 각 노드의 kubelet이 컨테이너에 주기적으로 실행하는 진단이다. 방식은 명령 실행(exec), HTTP 요청(httpGet), TCP 연결(tcpSocket), gRPC 헬스 체크(grpc) 중 하나이고, 결과는 성공·실패로 판정된다. 같은 진단이라도 어떤 프로브 자리에 두느냐에 따라 실패의 결과가 완전히 달라진다.

```mermaid dg_probe_flow
flowchart TB
  S["컨테이너 시작"] --> SP{"startupProbe 성공?"}
  SP -- "임계값만큼 실패" --> K["컨테이너 종료 → restartPolicy"]
  SP -- "성공" --> RUN["liveness·readiness 주기 실행"]
  RUN --> L{"liveness 연속 실패?"}
  L -- "예" --> K
  RUN --> R{"readiness 실패?"}
  R -- "예" --> EP["Service 엔드포인트에서 제외<br/>컨테이너는 그대로"]
  R -- "다시 성공" --> IN["엔드포인트에 복귀"]
```

liveness 프로브(liveness probe)가 정해진 횟수만큼 연속 실패하면 kubelet은 컨테이너를 종료하고 restartPolicy에 따라 다시 띄운다. readiness 프로브(readiness probe)는 실패해도 재시작하지 않는다. 대신 Pod가 Ready 상태를 잃어 Service가 트래픽을 보내지 않고, 다시 성공하면 돌아온다.

::embed[k8s.probes.i13]

startup 프로브(startup probe)는 시작이 느린 앱을 위한 보호막이다. 이것이 설정되어 있으면 성공할 때까지 나머지 두 프로브가 돌지 않으므로, 준비 중인 컨테이너가 liveness에 걸려 죽는 일을 막는다. 주의할 점은 liveness에 데이터베이스 같은 외부 의존성 확인을 넣지 않는 것이다. 의존성이 잠시 끊기면 모든 Pod가 함께 재시작되어 장애가 커진다.

## 코드

### Worked example

시작에 최대 2분이 걸리는 HTTP 서버에 세 프로브를 붙인 Pod다. 주석의 번호가 설정 순서(서브골)이며, 매니페스트는 보기용이다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: catalog-api
spec:
  containers:
    - name: app
      image: registry.example.com/catalog-api:3.1.0
      ports:
        - containerPort: 8080
      # ① 느린 시작을 보호한다 — 성공할 때까지 liveness·readiness가 돌지 않는다
      startupProbe:
        httpGet: { path: /healthz, port: 8080 }
        periodSeconds: 10
        failureThreshold: 12        # ② 최대 시작 시간 ≈ 12 × 10초 = 120초
      # ③ 프로세스 자신만 본다 — DB 같은 외부 의존성은 넣지 않는다
      livenessProbe:
        httpGet: { path: /healthz, port: 8080 }
        periodSeconds: 10
        failureThreshold: 3         # ④ 한 번의 지연으로 재시작하지 않도록 여유를 둔다
      # ⑤ 요청을 받을 준비가 됐는지 본다 — 실패하면 재시작 없이 트래픽에서만 빠진다
      readinessProbe:
        httpGet: { path: /ready, port: 8080 }
        periodSeconds: 5
        failureThreshold: 2
```

`/healthz`는 프로세스 내부 상태(이벤트 루프 응답, 교착 여부)만 확인하고, `/ready`는 캐시 적재처럼 요청 처리에 필요한 조건까지 확인하도록 앱에서 나눠 구현한다. 상태는 `kubectl describe pod catalog-api`의 Events와 Conditions에서 확인한다.

## 핵심

### 언제 쓰지 않나

- 외부 의존성(데이터베이스·다른 서비스)이 끊겼는지를 liveness로 확인하지 않는다. 재시작해도 고쳐지지 않는 문제라 모든 Pod가 함께 재시작되며 장애를 키운다(→ [연쇄 장애](concept:sre.cascading-failure)).
- 시작이 느리다는 이유로 liveness의 initialDelaySeconds만 크게 늘리지 않는다. 시작이 빨리 끝나도 그 시간 동안 감시가 비므로 startupProbe를 쓴다.
- 앱이 스스로 오류 시 종료(크래시)하는 구조라면 같은 판정을 하는 liveness를 굳이 덧붙이지 않는다. kubelet이 restartPolicy로 이미 재시작한다.

### 대조

| | liveness | readiness | startup |
|---|---|---|---|
| 실패하면 | 컨테이너 종료 후 재시작 | Service 엔드포인트에서 제외 | 컨테이너 종료 후 재시작 |
| 언제 도나 | startup 성공 뒤 계속 | startup 성공 뒤 계속 | 시작 직후, 성공하면 멈춤 |
| 확인할 것 | 프로세스 자신의 생존 | 요청 처리 준비 상태 | 시작 완료 여부 |

::ku-list
