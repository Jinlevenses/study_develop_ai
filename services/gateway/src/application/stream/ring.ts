// SSE 재전송 링 — 용량 N, 넘으면 가장 오래된 항목 폐기. `seq`는 1부터 단조 증가(메모리, 재시작 시 0부터).

export type RingEntry = {
  readonly seq: number;
  readonly event_id: string;
  readonly type: string;
  /** JSON 한 줄. */
  readonly data: string;
};

export interface Ring {
  /** 같은 `event_id`가 링에 있으면 null(버림). */
  push(e: { readonly event_id: string; readonly type: string; readonly data: string }): RingEntry | null;
  /** 마지막으로 부여한 seq(없으면 0). */
  head(): number;
  /** 링에 남은 가장 오래된 seq(비었으면 head + 1). */
  oldest(): number;
  /** `seq` 초과 항목을 순서대로. */
  after(seq: number): readonly RingEntry[];
}

export function createRing(capacity: number): Ring {
  const entries: RingEntry[] = [];
  const ids = new Set<string>(); // 링과 같은 수명
  let head = 0;
  return {
    push(e): RingEntry | null {
      if (ids.has(e.event_id)) {
        return null;
      }
      head += 1;
      const entry: RingEntry = { seq: head, event_id: e.event_id, type: e.type, data: e.data };
      entries.push(entry);
      ids.add(e.event_id);
      while (entries.length > capacity) {
        const dropped = entries.shift();
        if (dropped !== undefined) {
          ids.delete(dropped.event_id);
        }
      }
      return entry;
    },
    head: () => head,
    oldest: () => entries[0]?.seq ?? head + 1,
    after: (seq) => entries.filter((x) => x.seq > seq),
  };
}
