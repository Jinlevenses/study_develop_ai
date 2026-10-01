import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const DoctorItemId = z.enum(['node_version', 'node_eol', 'sqlite_experimental', 'data_path', 'disk', 'ports', 'integrity_quick',
  'integrity_full', 'ledger_chain', 'ledger_anchor', 'projection_hash', 'policy_lock', 'prompts_lock', 'runner_platform', 'prlimit',
  'docker', 'graphify', 'providers_live', 'keychain', 'backups', 'secondary', 'autostart', 'session_key']);
export type DoctorItemId = z.infer<typeof DoctorItemId>;
export const DoctorReport = S({ report_id: Ulid, generated_at: EpochMs, live: z.boolean(), fix: z.boolean(),
  items: z.array(S({ id: DoctorItemId, status: z.enum(['ok', 'warn', 'fail', 'skip']), summary_ko: z.string().max(200),
    detail_ko: z.string().max(2000).nullable(), fixable: z.boolean(), fix_applied: z.boolean() })).max(40) });
export type DoctorReport = z.infer<typeof DoctorReport>;
export const RunDoctorBody = S({ op_id: Ulid, fix: z.boolean(), live: z.boolean() });   // fix = 선행 스냅샷 100%(NFR-AVL-004)
export type RunDoctorBody = z.infer<typeof RunDoctorBody>;
