import type { Logger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import type { IntegrityAlarm } from '../../application/ledger/ports.js';

/**
 * 원장 무결성 경보(STD-ERR-14): 로그 1줄 + `ledger_integrity_alarm_total{kind}`. payload·답안 원문은 남기지 않는다(STD-LOG-22).
 * `degraded` 배너·doctor 연결 = IT-03 [Brief 결정].
 */
export function createIntegrityAlarm(log: Logger, metrics: MetricsRegistry): IntegrityAlarm {
  const total = metrics.counter('ledger_integrity_alarm_total', '원장 무결성 경보 수', ['kind']);
  return {
    raise(kind, detail): void {
      total.inc({ kind });
      log.error(
        {
          event: 'ledger.integrity_alarm',
          kind,
          device_id: detail.device_id,
          device_seq: detail.device_seq,
          event_id: detail.event_id,
        },
        detail.message,
      );
    },
  };
}
