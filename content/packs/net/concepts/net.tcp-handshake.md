---
schema_v: 1
id: net.tcp-handshake
track: net
level: 2
tier: A
knowledge_type: { primary: C, secondary: [P] }
stage2_kind: code
title: { ko: "TCP 연결 수립과 종료", en: "TCP Connection Establishment and Termination" }
summary_ko: "TCP는 3방향 핸드셰이크로 양쪽 순서 번호를 맞춘 뒤 데이터를 보내고, 방향마다 FIN을 주고받아 닫으며 먼저 닫은 쪽은 TIME-WAIT에 잠시 머문다."
aliases: ["3-way handshake", "3방향 핸드셰이크", "TCP handshake", "TIME_WAIT", "TIME-WAIT", "CLOSE_WAIT", "FIN", "SYN", "4-way close"]
tags: ["qa:reliability", "lc:operate"]
volatility: stable
required_for_level: 2
prereqs: [net.tcp-udp]
siblings:
  net.socket: { axis: "프로토콜 상태(커널) vs 애플리케이션이 쓰는 소켓 API" }
extends: []
deprecated_by: null
id_aliases: []
sources:
  - { source_id: src.rfc-9293, locator: "RFC 9293 §3.5", section: "Establishing a Connection", usage: paraphrase, retrieved_at: "2026-10-02" }
  - { source_id: src.rfc-9293, locator: "RFC 9293 §3.6", section: "Closing a Connection", usage: paraphrase, retrieved_at: "2026-10-02" }
  - { source_id: src.rfc-9293, locator: "RFC 9293 §3.3.2", section: "State Machine Overview", usage: paraphrase, retrieved_at: "2026-10-02" }
  - { source_id: src.linux-man-pages, locator: "/man2/listen.2.html", section: "listen(2) — NOTES", usage: paraphrase, retrieved_at: "2026-10-02" }
diagrams:
  dg_handshake:
    alt: "SYN, SYN+ACK, ACK 세 세그먼트로 연결이 열리고 양쪽 상태가 바뀌는 순서"
    summary: "클라이언트가 자기 초기 순서 번호 x를 담은 SYN을 보내 SYN-SENT가 된다. 서버는 x+1을 확인하면서 자기 번호 y를 담은 SYN+ACK로 답하고 SYN-RECEIVED가 된다. 클라이언트가 y+1을 확인하는 ACK를 보내면 양쪽 모두 ESTABLISHED가 된다."
  dg_close:
    alt: "FIN과 ACK를 방향마다 주고받아 연결을 닫고 먼저 닫은 쪽이 TIME-WAIT에 머무는 흐름"
    summary: "먼저 닫는 쪽이 FIN을 보내 FIN-WAIT 상태로 들어가고, 받은 쪽은 ACK 후 CLOSE-WAIT에서 애플리케이션의 close를 기다린다. 받은 쪽이 자기 FIN을 보내면 LAST-ACK가 되고, 먼저 닫은 쪽은 마지막 ACK를 보낸 뒤 TIME-WAIT에서 2MSL을 기다렸다가 CLOSED가 된다."
learning:
  objectives:
    ob_1: { bloom: understand, text: "3방향 핸드셰이크가 양쪽 초기 순서 번호를 확인하는 데 왜 세 세그먼트로 충분한지 설명한다" }
    ob_2: { bloom: understand, text: "연결 종료 과정에서 FIN-WAIT·CLOSE-WAIT·LAST-ACK·TIME-WAIT 상태가 어느 쪽에 생기는지 설명한다" }
    ob_3: { bloom: analyze, text: "ss 출력에서 CLOSE-WAIT·TIME-WAIT 누적을 보고 원인이 애플리케이션인지 정상 동작인지 구분한다" }
    ob_4: { bloom: apply, text: "핸드셰이크와 종료 과정의 세그먼트를 순서 번호·확인 번호와 함께 차례대로 배열한다" }
  depth_facets:
    l3: "SYN 큐·accept 큐 크기와 SYN 폭주 대응(SYN 쿠키)을 운영 관점에서 판단한다(→ net.kernel-net)"
  pre_questions:
    - "TCP 연결을 여는 데 왜 두 번이 아니라 세 번의 세그먼트를 주고받을까?"
    - "서버에 TIME-WAIT 소켓이 수천 개 쌓여 있다면 그것은 장애의 신호일까?"
  contrast_pairs:
    cp_wait_states: { a: "TIME-WAIT", b: "CLOSE-WAIT", axis: "먼저 닫은 쪽의 정상 대기 vs 나중에 닫는 쪽이 close를 부르지 않은 상태" }
    cp_fin_rst: { a: "FIN", b: "RST", axis: "보낼 데이터를 다 보냈다는 정상 종료 vs 연결을 즉시 버리는 중단" }
  mnemonic: "먼저 끊은 사람이 문 앞에서 기다린다(TIME-WAIT)"
  estimated_minutes: { theory: 12, code: 15, core: 6 }
review: { verified_against: "RFC 9293", valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

### 왜 필요한가

IP는 패킷을 보낼 뿐 순서나 도착을 약속하지 않는다. TCP가 신뢰할 수 있는 바이트 스트림을 만들려면 데이터를 보내기 전에 양쪽이 "어디부터 번호를 셀지"를 합의해야 한다. 이 합의가 연결 수립이고, 쓰고 나면 남은 데이터를 잃지 않으면서 자원을 돌려주는 절차가 연결 종료다. 운영에서 자주 보는 `TIME-WAIT`·`CLOSE-WAIT` 같은 상태 이름도 이 두 절차에서 나온다. 핸드셰이크는 데이터 전에 왕복 한 번(RTT)을 더 쓰므로, 연결을 매번 새로 여는 설계는 그만큼 느려진다.

### 메커니즘

연결 수립은 3방향 핸드셰이크(three-way handshake)다. 클라이언트가 자기 초기 순서 번호(ISN, initial sequence number)를 담은 SYN을 보내고, 서버는 그 번호를 확인(ACK)하면서 자기 ISN을 담은 SYN을 한 세그먼트로 돌려준다. 마지막으로 클라이언트가 서버의 번호를 확인하면 양쪽이 서로의 시작 번호를 알게 된다. 방향마다 "번호 알림 + 확인"이 필요한데, 서버 쪽의 확인과 알림을 합쳤기 때문에 세 번으로 끝난다.

```mermaid dg_handshake
sequenceDiagram
  participant C as 클라이언트
  participant S as 서버
  Note over S: LISTEN
  C->>S: SYN seq=x
  Note over C: SYN-SENT
  S->>C: SYN+ACK seq=y ack=x+1
  Note over S: SYN-RECEIVED
  C->>S: ACK ack=y+1
  Note over C,S: ESTABLISHED
```

::embed[net.tcp-handshake.i13]

종료는 방향별로 따로 닫는다. 먼저 닫는 쪽이 FIN을 보내면 받은 쪽은 ACK를 돌려준 뒤 CLOSE-WAIT에 머물며, 애플리케이션이 close를 부를 때까지 반대 방향으로 데이터를 계속 보낼 수 있다(반쪽 닫힘, half-close). 받은 쪽이 자기 FIN을 보내고 그 ACK를 받으면 끝난다.

```mermaid dg_close
sequenceDiagram
  participant A as 먼저 닫는 쪽
  participant B as 나중에 닫는 쪽
  A->>B: FIN
  Note over A: FIN-WAIT-1
  B->>A: ACK
  Note over B: CLOSE-WAIT
  Note over A: FIN-WAIT-2
  B->>A: FIN
  Note over B: LAST-ACK
  A->>B: ACK
  Note over A: TIME-WAIT (2MSL 후 CLOSED)
```

먼저 FIN을 보낸 쪽은 마지막 ACK를 보낸 뒤 바로 사라지지 않고 TIME-WAIT에서 최대 세그먼트 수명(MSL)의 두 배를 기다린다. 그 ACK가 유실되면 다시 보내야 하고, 같은 주소·포트 쌍으로 새로 열린 연결에 이전 연결의 늦은 세그먼트가 섞이면 안 되기 때문이다.

## 코드

### Worked example

서버(예시 주소 `192.0.2.10`)에서 `ss`로 연결 상태를 관찰하는 순서다. 명령은 보기용이며 주석의 번호가 관찰 순서(서브골)다.

```bash
# ① 듣는 소켓을 확인한다 — 상태가 LISTEN이면 SYN을 받을 준비가 된 것이다
ss -tln '( sport = :8080 )'
# ② 다른 터미널에서 요청을 하나 보낸다 — 핸드셰이크가 끝나야 HTTP 요청이 나간다
curl -s http://192.0.2.10:8080/ > /dev/null
# ③ 상태별로 연결 수를 센다 — 첫 줄은 머리글이다
ss -tan | awk 'NR > 1 { print $1 }' | sort | uniq -c
# ④ CLOSE-WAIT만 골라 어느 프로세스가 붙잡고 있는지 본다 — 프로세스 정보는 root 권한에서 보인다
ss -tanp state close-wait
```

③의 출력 예시다. 숫자는 합성한 값이다.

```text
      1 LISTEN
      3 ESTAB
     42 TIME-WAIT
    118 CLOSE-WAIT
```

TIME-WAIT 42개는 서버가 먼저 연결을 닫은 결과로, 시간이 지나면 저절로 사라진다. CLOSE-WAIT 118개는 상대가 이미 FIN을 보냈는데 이 서버의 애플리케이션이 소켓을 닫지 않았다는 뜻이므로 ④로 프로세스를 찾아 코드에서 close 누락을 확인한다.

## 핵심

### 언제 쓰지 않나

- TIME-WAIT 소켓이 많다는 이유만으로 커널 설정을 바꿔 대기 시간을 없애지 않는다. 대부분은 정상 동작이며, 줄이고 싶다면 연결 재사용(keep-alive·커넥션 풀)이 먼저다(→ [커넥션 풀](concept:db.connection-pool)).
- 연결을 끊는 수단으로 RST를 일부러 보내지 않는다. RST는 아직 전달되지 않은 데이터를 버리므로 정상 종료가 아니라 중단이다.
- 핸드셰이크 지연이 문제인 짧은 요청을 매번 새 연결로 보내는 설계는 피한다. 상위 프로토콜의 연결 재사용을 먼저 검토한다(→ [HTTP 기초](concept:net.http-basics)).

### 대조

| | TIME-WAIT | CLOSE-WAIT |
|---|---|---|
| 생기는 쪽 | 먼저 FIN을 보낸 쪽 | FIN을 받고 아직 닫지 않은 쪽 |
| 의미 | 정상 대기(2MSL 후 자동 해제) | 애플리케이션이 close를 부르지 않음 |
| 많을 때 할 일 | 대개 그대로 둔다, 연결 재사용 검토 | 코드에서 소켓 닫기 누락을 찾는다 |

::ku-list
