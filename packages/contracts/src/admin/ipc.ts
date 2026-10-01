import { z } from 'zod';
import { RuntimeProfile, ServiceState } from '../common/domain.js';
import { SemVer, ServiceName, Sha256Hex, Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EpochMs } from '../common/time.js';
import { ModuleSchemaVersions } from './admin-routes.js';

export const Token = z.string().regex(/^[0-9a-f]{64}$/); // 256bit 호출자 토큰
export type Token = z.infer<typeof Token>;
const H = { v: z.literal(1), id: Ulid.optional(), re: Ulid.optional() };
export const BootstrapEnvelope = S({
  type: z.literal('bootstrap'),
  ...H,
  svc: ServiceName,
  boot_id: Ulid,
  app_version: SemVer,
  contracts_hash: Sha256Hex,
  profile: RuntimeProfile,
  home: z.string().max(1024),
  web_root: z.string().max(1024).nullable(), // gateway만 apps/web/dist
  listen: S({ host: z.literal('127.0.0.1'), port: z.number().int().min(0).max(65535) }),
  self_token: Token,
  callers: z.record(ServiceName, Token),
  peers: z.record(ServiceName, S({ url: z.string().url() })),
  flags: S({ safe_mode: z.boolean(), batch_enabled: z.boolean(), after_crash: z.boolean() }),
  log_level: z.enum(['debug', 'info', 'warn', 'error']),
});
export type BootstrapEnvelope = z.infer<typeof BootstrapEnvelope>;
export const IpcSupervisorToService = z.discriminatedUnion('type', [
  BootstrapEnvelope,
  S({ type: z.literal('registry.updated'), ...H, peers: z.record(ServiceName, S({ url: z.string().url() })) }),
  S({ type: z.literal('shutdown'), ...H, grace_ms: z.number().int().min(0).max(10_000) }),
  S({ type: z.literal('log.level'), ...H, level: z.enum(['debug', 'info', 'warn', 'error']) }),
]);
export type IpcSupervisorToService = z.infer<typeof IpcSupervisorToService>;
export const IpcServiceToSupervisor = z.discriminatedUnion('type', [
  S({ type: z.literal('listening'), ...H, port: z.number().int().min(1).max(65535) }),
  S({
    type: z.literal('ready'),
    ...H,
    contracts_hash: Sha256Hex,
    schema_versions: z.record(z.string(), ModuleSchemaVersions),
    app_version: SemVer,
  }),
  S({
    type: z.literal('fatal'),
    ...H,
    exit_code: z.union([z.literal(64), z.literal(70), z.literal(75), z.literal(78)]),
    code: z.string().max(60),
  }),
]);
export type IpcServiceToSupervisor = z.infer<typeof IpcServiceToSupervisor>;
export const SupervisedService = z.union([ServiceName, z.literal('vite')]);
export type SupervisedService = z.infer<typeof SupervisedService>;
export const RunModeArgs = z.discriminatedUnion('mode', [
  S({
    mode: z.literal('migrate'),
    dry_run: z.boolean(),
    db_copy_dir: z.string().max(1024).nullable(),
    app_dir: z.string().max(1024).nullable(),
  }),
  S({
    mode: z.literal('restore'),
    from: z.string().max(1024),
    rewind_cursors: z.record(ServiceName, z.number().int().min(0)),
  }),
  S({ mode: z.literal('verify'), replay: z.boolean(), db_copy_dir: z.string().max(1024).nullable() }),
]);
export type RunModeArgs = z.infer<typeof RunModeArgs>;
export const IpcOpsToSupervisor = z.discriminatedUnion('type', [
  S({ type: z.literal('svc.stop'), ...H, svc: SupervisedService }),
  S({ type: z.literal('svc.start'), ...H, svc: SupervisedService }),
  S({ type: z.literal('svc.restart'), ...H, svc: SupervisedService }),
  S({ type: z.literal('svc.run_mode'), ...H, svc: ServiceName, args: RunModeArgs }),
  S({ type: z.literal('status.get'), ...H }),
  S({
    type: z.literal('logs.tail'),
    ...H,
    svc: z.union([ServiceName, z.literal('supervisor')]),
    n: z.number().int().min(1).max(5000),
  }),
  S({ type: z.literal('shutdown.all'), ...H, grace_ms: z.number().int().min(0).max(10_000) }),
]);
export type IpcOpsToSupervisor = z.infer<typeof IpcOpsToSupervisor>;
export const IpcSupervisorToOps = z.discriminatedUnion('type', [
  S({ type: z.literal('svc.ack'), ...H, ok: z.boolean(), error: z.string().max(200).nullable() }),
  S({
    type: z.literal('svc.run_mode.result'),
    ...H,
    exit_code: z.number().int(),
    tail: z.array(z.string().max(2000)).max(200),
  }),
  S({
    type: z.literal('status'),
    ...H,
    services: z.array(
      S({
        svc: z.union([SupervisedService, z.literal('supervisor')]),
        state: ServiceState,
        pid: z.number().int().nullable(),
        port: z.number().int().nullable(),
        restarts_60s: z.number().int(),
        started_at: EpochMs.nullable(),
        last_exit_code: z.number().int().nullable(),
      }),
    ),
  }),
  S({ type: z.literal('logs.tail.result'), ...H, svc: z.string(), lines: z.array(z.string().max(8000)).max(5000) }),
]);
export type IpcSupervisorToOps = z.infer<typeof IpcSupervisorToOps>;
