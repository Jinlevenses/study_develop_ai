// ADR-011 §2 · FR-PRG-027 — 학습일(study_day)·FSRS 시각(fsrs_at)은 이벤트 생성 시 정해 payload에 내장한다. 리플레이는 TZ·설정을 다시 읽지 않는다.
// `Date`·`Date.now()` 금지(STD-TS-20): 시각 분해는 `Intl.DateTimeFormat`, 날짜 −1은 정수 civil-day 산술.
export type StudyDayContext = { readonly timeZone: string; readonly dayBoundaryMinutes: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
}

type LocalParts = { readonly year: number; readonly month: number; readonly day: number; readonly minuteOfDay: number };

function localParts(atMs: number, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(atMs)) {
    if (p.type === 'year' || p.type === 'month' || p.type === 'day' || p.type === 'hour' || p.type === 'minute') {
      parts[p.type] = Number(p.value);
    }
  }
  const { year, month, day, hour, minute } = parts;
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    throw new Error('invariant: Intl.DateTimeFormat parts incomplete');
  }
  return { year, month, day, minuteOfDay: hour * 60 + minute };
}

/** 1970-01-01 기준 civil day 번호(proleptic Gregorian, Howard Hinnant 알고리즘). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z0: number): { year: number; month: number; day: number } {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * `YYYY-MM-DD`(사용자 일 경계 기준 로컬 날짜). 로컬 시각이 경계(`dayBoundaryMinutes`, 기본 240 = 04:00)보다 이르면 전날이다
 * (03:59 = 전날, 04:00 = 당일).
 */
export function studyDayOf(atMs: number, ctx: StudyDayContext): string {
  const local = localParts(atMs, ctx.timeZone);
  const { year, month, day } =
    local.minuteOfDay < ctx.dayBoundaryMinutes
      ? civilFromDays(daysFromCivil(local.year, local.month, local.day) - 1)
      : local;
  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`;
}

/** 클라이언트 `answered_at`을 `[sessionStartedAt, now]`로 클램프한다(`sessionStartedAt > now`면 상한 `now` 우선). */
export function clampAnsweredAt(answeredAt: number, sessionStartedAt: number, now: number): number {
  const lower = Math.min(sessionStartedAt, now);
  return Math.min(Math.max(answeredAt, lower), now);
}

/** `fsrs_at = max(clamped, last_fsrs_at + 1)` — 카드별 엄격 증가(첫 채점은 클램프 값). */
export function nextFsrsAt(clamped: number, lastFsrsAt: number | null): number {
  return lastFsrsAt === null ? clamped : Math.max(clamped, lastFsrsAt + 1);
}
