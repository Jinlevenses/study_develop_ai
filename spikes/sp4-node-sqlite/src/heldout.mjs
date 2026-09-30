// Held-out queries: written AFTER the ranking heuristics were frozen and evaluated exactly once
// (no tuning on them). Ground truth is author-annotated by intent.
export const HELDOUT = [
  { q: '롤링 업데이트', cat: 'L', rel: ['infra.rolling-update', 'k8s.deployment'] },
  { q: '리버스 프록시', cat: 'L', rel: ['net.reverse-proxy'] },
  { q: 'CSRF 방어', cat: 'M', rel: ['sec.csrf'] },
  { q: 'SQL 인젝션 파라미터 바인딩', cat: 'M', rel: ['sec.sql-injection'] },
  { q: '프로세스 스레드 차이', cat: 'M', rel: ['os.process-vs-thread'] },
  { q: '메모이제이션', cat: 'L', rel: ['algo.dp', 'web.memoization-react'] },
  { q: 'LRU', cat: 'E', rel: ['algo.lru-cache', 'algo.cache-policies', 'os.page-replacement'] },
  { q: 'websocket', cat: 'E', rel: ['net.websocket'] },
  { q: '웹소켓', cat: 'L', rel: ['net.websocket'] },
  { q: 'gRPC protobuf', cat: 'E', rel: ['net.grpc'] },
  { q: '뮤텍스', cat: 'L', rel: ['os.mutex-semaphore'] },
  { q: '힙', cat: 'S', rel: ['ds.heap', 'ds.priority-queue', 'os.stack-heap', 'algo.sorting-compare'] },
  { q: '그래프', cat: 'L', rel: ['ds.graph', 'algo.dijkstra', 'db.nosql-types'] },
  { q: '토큰', cat: 'S', rel: ['sec.jwt-verify', 'sec.jwt-structure', 'sec.session-vs-token', 'sec.oidc', 'net.rate-limiting', 'sec.csrf'] },
  { q: '백업', cat: 'S', rel: ['obs.backup-restore'] },
  { q: '멱등', cat: 'S', rel: ['net.http-methods-idempotency', 'arch.idempotency-key', 'db.idempotent-writes'] },
  { q: 'SQLite WAL', cat: 'M', rel: ['db.sqlite-wal-mode', 'db.wal'] },
  { q: '프로토타입 오염', cat: 'L', rel: ['sec.prototype-pollution'] },
  { q: '분산 추적', cat: 'M', rel: ['obs.tracing'] },
  { q: '인덱스', cat: 'L', rel: ['db.btree-index', 'db.index-basics', 'db.composite-index', 'db.covering-index', 'db.explain-plan', 'db.uuid-ulid'] },
];
