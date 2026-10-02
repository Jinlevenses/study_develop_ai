import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monotonicClientTs } from '@fathom/shared-kernel/time/time';
import { describe, expect, it } from 'vitest';
import { clampAnsweredAt, nextFsrsAt, studyDayOf } from '../../../src/domain/ledger/time/study-day.js';
import { fixtureDraft } from '../../contract/ledger/ledger-fixtures.js';
import { GOLDEN_STUDY_DAY } from '../../golden/ledger/payloads.js';
import { utcMs } from './support/epoch.js';
import { makeHarness } from './support/harness.js';

const ctx = (timeZone: string, dayBoundaryMinutes = 240) => ({ timeZone, dayBoundaryMinutes });

describe('studyDayOf', () => {
  it('UT-LR-003 04:00 경계(03:59 = 전날, 04:00 = 당일) — UTC·Asia/Seoul·America/Los_Angeles [FR-PRG-027][FR-PRG-009]', () => {
    // UTC
    expect(studyDayOf(utcMs(2026, 9, 22, 3, 59), ctx('UTC'))).toBe('2026-09-21');
    expect(studyDayOf(utcMs(2026, 9, 22, 4, 0), ctx('UTC'))).toBe('2026-09-22');
    // Asia/Seoul(UTC+9, DST 없음): 03:59 KST = 전날 18:59Z
    expect(studyDayOf(utcMs(2026, 9, 21, 18, 59), ctx('Asia/Seoul'))).toBe('2026-09-21');
    expect(studyDayOf(utcMs(2026, 9, 21, 19, 0), ctx('Asia/Seoul'))).toBe('2026-09-22');
    // America/Los_Angeles(9월 = PDT UTC−7): 03:59 PDT = 10:59Z
    expect(studyDayOf(utcMs(2026, 9, 22, 10, 59), ctx('America/Los_Angeles'))).toBe('2026-09-21');
    expect(studyDayOf(utcMs(2026, 9, 22, 11, 0), ctx('America/Los_Angeles'))).toBe('2026-09-22');
    // 월·연 경계: 2026-01-01 03:59 = 2025-12-31, 03-01 03:59 = 02-28(2026은 평년)
    expect(studyDayOf(utcMs(2026, 1, 1, 3, 59), ctx('UTC'))).toBe('2025-12-31');
    expect(studyDayOf(utcMs(2026, 3, 1, 3, 59), ctx('UTC'))).toBe('2026-02-28');
    expect(studyDayOf(utcMs(2028, 3, 1, 3, 59), ctx('UTC'))).toBe('2028-02-29'); // 윤년
  });

  it('UT-LR-003 생성 시 고정: writer는 payload의 study_day를 다시 계산하지 않고, 헬퍼 체인 값을 그대로 저장한다 [FR-PRG-027][FR-PRG-009]', async () => {
    const h = await makeHarness();
    const answeredAt = utcMs(2026, 9, 21, 18, 59, 30); // 03:59:30 KST → 전날
    const now = answeredAt + 20_000;
    h.clock.set(now);
    const clamped = clampAnsweredAt(answeredAt, now - 600_000, now);
    const base = fixtureDraft('attempt.graded');
    const payload = {
      ...base.payload,
      fsrs_at: nextFsrsAt(clamped, null),
      study_day: studyDayOf(clamped, GOLDEN_STUDY_DAY),
    };
    expect(payload.study_day).toBe('2026-09-21');
    const res = h.writer.append({ ...base, payload });
    expect(res.ok && res.value.kind === 'appended').toBe(true);
    const stored = h.db.prepare("SELECT payload FROM lr_event WHERE type = 'attempt.graded'").get();
    expect(JSON.parse(String(stored?.payload))).toMatchObject({ study_day: '2026-09-21', fsrs_at: answeredAt });
    // 값이 시계와 달라도(writer는 검증만) 그대로 보존한다.
    h.clock.set(utcMs(2026, 9, 25, 12));
    const other = h.writer.append({
      type: 'card.enrolled',
      idempotency_key: 'card:k8s.probes:definition:r',
      payload: {
        ...fixtureDraft('card.enrolled').payload,
        card_id: 'k8s.probes:definition:r',
        study_day: '2026-01-01',
      },
    });
    expect(other.ok).toBe(true);
    const kept = h.db.prepare("SELECT payload FROM lr_event WHERE type = 'card.enrolled'").get();
    expect(JSON.parse(String(kept?.payload))).toMatchObject({ study_day: '2026-01-01' });
  });
});

describe('시각 헬퍼', () => {
  it('UT-LR-040 clampAnsweredAt: [세션 시작, now]로 클램프 [FR-PRG-027]', () => {
    expect(clampAnsweredAt(500, 1000, 2000)).toBe(1000); // 미래 아님·세션 이전 → 세션 시작
    expect(clampAnsweredAt(1500, 1000, 2000)).toBe(1500);
    expect(clampAnsweredAt(9000, 1000, 2000)).toBe(2000); // 미래 → now
    expect(clampAnsweredAt(1500, 3000, 2000)).toBe(2000); // 세션 시작이 now보다 늦은 이상 상태 → now
  });

  it('UT-LR-041 nextFsrsAt: max(clamped, last+1) — 카드별 엄격 증가 [FR-PRG-027]', () => {
    expect(nextFsrsAt(1000, null)).toBe(1000);
    expect(nextFsrsAt(1000, 500)).toBe(1000);
    expect(nextFsrsAt(1000, 1000)).toBe(1001);
    expect(nextFsrsAt(1000, 5000)).toBe(5001);
    let last: number | null = null;
    for (const clamped of [10, 10, 9, 11, 11, 11]) {
      const next = nextFsrsAt(clamped, last);
      expect(last === null || next > last).toBe(true);
      last = next;
    }
  });

  it('UT-LR-042 DST: America/Los_Angeles 3월(봄 앞으로)·11월(가을 뒤로) 경계 [FR-PRG-027]', () => {
    const la = ctx('America/Los_Angeles');
    // 2026-03-08 02:00 PST → 03:00 PDT. 03:30 PDT(= 10:30Z) < 04:00 → 전날, 04:00 PDT(= 11:00Z) → 당일.
    expect(studyDayOf(utcMs(2026, 3, 8, 9, 59), la)).toBe('2026-03-07'); // 01:59 PST
    expect(studyDayOf(utcMs(2026, 3, 8, 10, 30), la)).toBe('2026-03-07'); // 03:30 PDT
    expect(studyDayOf(utcMs(2026, 3, 8, 10, 59), la)).toBe('2026-03-07'); // 03:59 PDT
    expect(studyDayOf(utcMs(2026, 3, 8, 11, 0), la)).toBe('2026-03-08'); // 04:00 PDT
    // 2026-11-01 02:00 PDT → 01:00 PST(01:00~01:59가 두 번). 03:59 PST(= 11:59Z) → 전날, 04:00 PST(= 12:00Z) → 당일.
    expect(studyDayOf(utcMs(2026, 11, 1, 8, 30), la)).toBe('2026-10-31'); // 01:30 PDT
    expect(studyDayOf(utcMs(2026, 11, 1, 9, 30), la)).toBe('2026-10-31'); // 01:30 PST(두 번째)
    expect(studyDayOf(utcMs(2026, 11, 1, 11, 59), la)).toBe('2026-10-31');
    expect(studyDayOf(utcMs(2026, 11, 1, 12, 0), la)).toBe('2026-11-01');
  });

  it('UT-LR-043 경계 분 단위: dayBoundaryMinutes 사용자 설정(예: 05:30 = 330) [FR-PRG-027]', () => {
    const c = ctx('Asia/Seoul', 330);
    expect(studyDayOf(utcMs(2026, 9, 21, 20, 29), c)).toBe('2026-09-21'); // 05:29 KST
    expect(studyDayOf(utcMs(2026, 9, 21, 20, 30), c)).toBe('2026-09-22'); // 05:30 KST
    expect(studyDayOf(utcMs(2026, 9, 21, 15, 0), ctx('Asia/Seoul', 0))).toBe('2026-09-22'); // 경계 00:00 = 자정
  });

  it('UT-LR-001 monotonicClientTs: 시계 역행에도 단조 [FR-PRG-027]', () => {
    expect(monotonicClientTs(100, null)).toBe(100);
    expect(monotonicClientTs(100, 100)).toBe(101);
    expect(monotonicClientTs(50, 100)).toBe(101);
    expect(monotonicClientTs(500, 100)).toBe(500);
  });

  it('UT-LR-044 domain/ledger·infra/ledger 소스에 Date 미사용(정적 검사) [FR-PRG-027]', () => {
    const root = fileURLToPath(new URL('../../../src/', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith('.ts')) {
          files.push(full);
        }
      }
    };
    walk(path.join(root, 'domain/ledger'));
    walk(path.join(root, 'infra/ledger'));
    walk(path.join(root, 'application/ledger'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const code = readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      expect(code, f).not.toMatch(/\bnew Date\b|\bDate\.(now|UTC|parse)\b|\bDate\(/);
    }
  });
});
