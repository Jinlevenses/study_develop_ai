import { CT_ERRORS } from '@fathom/contracts/http/content/v1/errors';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { ServiceApp, ServiceDefinition, ServiceDeps } from '@fathom/shared-kernel/service/service';
import { CONTENT_INBOX_HANDLERS, registerAll } from './app.js';
import { CONTENT_DB } from './infra/db/open.js';
import { buildContentInbox } from './infra/events/inbox.js';
import { CONTENT_EVENTS } from './infra/events/outbox.js';
import { contentIntegrityJob } from './jobs/integrity.js';
import { contentSnapshotJob } from './jobs/snapshot.js';

/** IT-00: 정책 미로딩 — 정책 소비 WP가 `loadPolicies`를 여기에 가산한다. */
export type ContentPolicies = null;

const GUARDED = ['/api/', '/internal/'] as const;
// 비예약 문자(ALPHA·DIGIT·-._~)의 퍼센트 인코딩 — 정규형에서는 쓰지 않는다.
const ENCODED_UNRESERVED_RE = /%(?:4[1-9A-Fa-f]|5[0-9Aa]|6[1-9A-Fa-f]|7[0-9Aa]|3[0-9]|2[Dd]|2[Ee]|5[Ff]|7[Ee])/;

/**
 * SEC 경로 우회 방어 — 라우터는 `%XX`를 풀고 매칭하지만 공통 파이프라인의 호출자 인증은 원본 접두사(`/internal/`)를 본다.
 * 디코딩하면 `/internal/`·`/api/`인데 원본이 정규형이 아닌 요청(`/%69nternal/…`)과 origin-form이 아닌 요청 대상(`http://host/internal/…`)은 핸들러 전에 404로 거른다.
 * 근본 원인(shared-kernel pipeline.ts)은 T-00-08에 security 에스컬레이션으로 올렸다 — 그 수정이 들어오면 이 방어는 중복이 된다.
 */
export function isEncodedBypass(url: string): boolean {
  // origin-form이 아닌 요청 대상(absolute-form `http://host/internal/…`)은 Node가 `req.url`을 그대로 두는데 라우터는 경로로 매칭한다(RFC 9112 §3.2.2).
  if (!url.startsWith('/')) {
    return true;
  }
  const q = url.indexOf('?');
  const raw = q >= 0 ? url.slice(0, q) : url;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return false; // 잘못된 인코딩은 라우터가 400으로 거른다.
  }
  if (!GUARDED.some((p) => decoded.startsWith(p))) {
    return false;
  }
  return !GUARDED.some((p) => raw.startsWith(p)) || ENCODED_UNRESERVED_RE.test(raw);
}

async function registerGuarded(app: ServiceApp, deps: ServiceDeps<ContentPolicies>): Promise<void> {
  app.fastify.addHook('onRequest', (req, _reply, done) => {
    if (isEncodedBypass(req.url)) {
      done(new AppError('CT-NOTFOUND-900', 404, '정의되지 않은 경로다.'));
      return;
    }
    done();
  });
  await registerAll(app, deps);
}

export function createContentDefinition(opts: { readonly entry: string }): ServiceDefinition<ContentPolicies> {
  const base = {
    svc: 'content',
    entry: opts.entry,
    contractsHash: null,
    databases: [CONTENT_DB],
    peers: ['ai-gateway'],
    events: CONTENT_EVENTS,
    inbox: buildContentInbox(CONTENT_INBOX_HANDLERS),
    errors: CT_ERRORS,
    register: registerGuarded,
  } satisfies ServiceDefinition<ContentPolicies>;
  return { ...base, jobs: [contentSnapshotJob(base), contentIntegrityJob(base)] };
}
