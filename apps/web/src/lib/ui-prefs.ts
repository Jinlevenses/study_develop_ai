/**
 * 기기별 UI 선호 저장소 — 브라우저 영속 저장소 접근은 이 모듈 한 곳뿐이다(STD-WEB-14 예외, DS DN-D5·SCR DN-05).
 * 토큰·CSRF·서버 데이터는 절대 쓰지 않는다(STD-SEC-26).
 */
export const UI_PREF_KEYS = [
  'fathom.theme',
  'fathom.hat',
  'fathom.keymap.v1',
  'fathom.suggest.home.dismissed_at',
] as const;

export type UiPrefKey = (typeof UI_PREF_KEYS)[number] | `fathom.ctx.${string}`;

export const UI_PREF_MAX_LENGTH = 4096;
const CTX_PREFIX = 'fathom.ctx.';

function isAllowedKey(key: string): boolean {
  return (
    (UI_PREF_KEYS as readonly string[]).includes(key) || (key.startsWith(CTX_PREFIX) && key.length > CTX_PREFIX.length)
  );
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 접근 자체가 막힌 환경(사설 모드 등) — 저장소 없음으로 취급한다.
    return null;
  }
}

function resolveStorage(storage: Storage | null | undefined): Storage | null {
  return storage === undefined ? defaultStorage() : storage;
}

export function readPref(key: UiPrefKey, storage?: Storage | null): string | null {
  if (!isAllowedKey(key)) {
    throw new TypeError(`허용되지 않은 UI 선호 키: ${key}`);
  }
  const s = resolveStorage(storage);
  if (s === null) {
    return null;
  }
  try {
    return s.getItem(key);
  } catch {
    // 읽기 예외 — 값 없음으로 취급한다.
    return null;
  }
}

/** `value === null`은 삭제. 저장 성공 여부를 돌려준다. */
export function writePref(key: UiPrefKey, value: string | null, storage?: Storage | null): boolean {
  if (!isAllowedKey(key)) {
    throw new TypeError(`허용되지 않은 UI 선호 키: ${key}`);
  }
  if (value !== null && value.length > UI_PREF_MAX_LENGTH) {
    throw new TypeError(`UI 선호 값은 ${String(UI_PREF_MAX_LENGTH)}자 이하여야 합니다`);
  }
  const s = resolveStorage(storage);
  if (s === null) {
    return false;
  }
  try {
    if (value === null) {
      s.removeItem(key);
    } else {
      s.setItem(key, value);
    }
    return true;
  } catch {
    // 쓰기 예외(용량·사설 모드) — 저장 실패로 알린다.
    return false;
  }
}
