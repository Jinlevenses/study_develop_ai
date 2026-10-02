import type { Verdict } from '@fathom/contracts/events/catalog/grading';
import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import type { InboxHandlerDef } from '@fathom/shared-kernel/eventing/eventing';
import { defineInboxHandler } from '@fathom/shared-kernel/eventing/eventing';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { AttemptLedgerContext, LedgerAppendDraft, LedgerWriter, VerdictAttemptResolver } from '../ports.js';

// PGM-LR-064 · IF-EV-05(소비, on_poison: halt) · IF-LG-01 — backstop: 동기 경로가 못 남긴 `attempt.graded`를 `grading.verdict.issued`로 보충한다.
// 멱등 키 `verdict:<verdict_id>`가 동기 경로와 backstop을 같은 행으로 접는다(duplicate = 정상).

/** `card_id = <concept_id>:<facet>:r|p` (ADR-011 §4). */
export function cardIdOfVerdict(v: Pick<Verdict, 'concept_id' | 'facet' | 'response_mode'>): string {
  return `${v.concept_id}:${v.facet}:${v.response_mode === 'recognition' ? 'r' : 'p'}`;
}

/** Verdict → `attempt.graded` 초안(item_beta_snapshot → item_beta 평탄화 + card_id + 호출자 컨텍스트 6필드). */
export function verdictToAttemptDraft(verdict: Verdict, ctx: AttemptLedgerContext): LedgerAppendDraft {
  const { item_beta_snapshot, ...carried } = verdict;
  return {
    type: 'attempt.graded',
    idempotency_key: `verdict:${verdict.verdict_id}`,
    payload: {
      ...carried,
      item_beta: item_beta_snapshot,
      card_id: cardIdOfVerdict(verdict),
      phase: ctx.phase,
      rating: ctx.rating,
      cbm_score: ctx.cbm_score,
      fsrs_at: ctx.fsrs_at,
      study_day: ctx.study_day,
      policy_version: ctx.policy_version,
    },
  };
}

export function createGradingVerdictIssuedHandler(deps: {
  readonly writer: LedgerWriter;
  readonly resolver: VerdictAttemptResolver;
  readonly log: Logger;
}): InboxHandlerDef {
  return defineInboxHandler('grading.verdict.issued', EVENT_PAYLOADS['grading.verdict.issued'], (_env, verdict, db) => {
    const ctx = deps.resolver.resolve(db, verdict);
    if (ctx === null) {
      deps.log.warn(
        { event: 'ledger.verdict.orphan', verdict_id: verdict.verdict_id },
        'verdict for an unknown attempt',
      );
      return;
    }
    const res = deps.writer.appendInTx(verdictToAttemptDraft(verdict, ctx), {
      afterAppend: (txDb, event) => deps.resolver.onRecorded?.(txDb, verdict, event),
    });
    if (!res.ok) {
      // on_poison: halt — 같은 tx가 롤백되고 스트림이 멈춘다(원장 경로를 조용히 건너뛰지 않는다).
      throw new Error(`ledger backstop failed: ${res.error.kind}`);
    }
  });
}
