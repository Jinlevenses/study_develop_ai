const CSRF_RE = /^[A-Za-z0-9_-]{43}$/;

/** CSRF 토큰 저장소 — 메모리만(STD-SEC-26). 어떤 영속 저장소에도 쓰지 않는다. */
export interface CsrfStore {
  get(): string | null;
  set(v: string): void;
  clear(): void;
}

export function createCsrfStore(): CsrfStore {
  let value: string | null = null;
  return {
    get(): string | null {
      return value;
    },
    set(v: string): void {
      if (!CSRF_RE.test(v)) {
        throw new TypeError('CSRF 토큰 형식이 올바르지 않습니다');
      }
      value = v;
    },
    clear(): void {
      value = null;
    },
  };
}
