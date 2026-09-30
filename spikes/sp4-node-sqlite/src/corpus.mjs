// Loads the hand-written 310-doc developer-concept corpus and the 40-query eval set.
// Ground truth (`rel`) is author-annotated by intent, NOT derived from any search method.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function loadDocs() {
  return readFileSync(join(here, 'corpus-data.txt'), 'utf8')
    .split('\n').filter(Boolean)
    .map((line) => {
      const [slug, title, alias, body] = line.split('|');
      return { slug, title, alias, body };
    });
}

// cat: L = Korean >=3 chars, E = English/abbr >=3 chars, S = short Korean (1-2 chars), M = mixed/natural, F = known failure mode probes
export const QUERIES = [
  // A. Korean, >= 3 chars
  { q: '쿠버네티스 파드 스케줄링', cat: 'L', rel: ['k8s.pod-scheduling', 'k8s.taint-toleration'] },
  { q: '멀티스테이지 빌드', cat: 'L', rel: ['docker.multistage-build'] },
  { q: '스케줄링', cat: 'L', rel: ['k8s.pod-scheduling', 'os.cpu-scheduling', 'k8s.taint-toleration'] },
  { q: '핸드셰이크', cat: 'L', rel: ['net.tcp-3way-handshake', 'net.tls-handshake', 'net.keepalive'] },
  { q: '데드락', cat: 'L', rel: ['db.deadlock', 'os.deadlock-conditions'] },
  { q: '정규화', cat: 'L', rel: ['db.normalization', 'db.denormalization'] },
  { q: '트랜잭션 격리 수준', cat: 'L', rel: ['db.isolation-levels', 'db.transaction-acid'] },
  { q: '이벤트 루프', cat: 'L', rel: ['js.event-loop', 'js.microtask'] },
  { q: '가상 메모리', cat: 'L', rel: ['os.virtual-memory', 'os.page-replacement', 'os.tlb'] },
  { q: '의존성 주입', cat: 'L', rel: ['arch.dependency-injection'] },
  // B. English / abbreviation, >= 3 chars
  { q: 'K8s', cat: 'E', rel: ['k8s.pod-scheduling', 'k8s.pod', 'k8s.configmap-secret', 'k8s.hpa', 'k8s.helm'] },
  { q: 'JWT', cat: 'E', rel: ['sec.jwt-verify', 'sec.jwt-structure'] },
  { q: 'TCP', cat: 'E', rel: ['net.tcp-3way-handshake', 'net.tcp-4way-teardown', 'net.tcp-flow-control', 'net.tcp-congestion', 'net.keepalive', 'net.osi-model', 'net.http2'] },
  { q: 'CI/CD', cat: 'E', rel: ['ci.cicd-pipeline'] },
  { q: '3-way handshake', cat: 'E', rel: ['net.tcp-3way-handshake'] },
  { q: 'OAuth', cat: 'E', rel: ['sec.oauth2', 'sec.oidc'] },
  { q: 'Kubernetes', cat: 'E', rel: ['k8s.pod-scheduling', 'k8s.pod', 'k8s.deployment', 'k8s.service', 'k8s.ingress', 'k8s.probes'] },
  { q: 'REST', cat: 'E', rel: ['net.rest'] },
  { q: 'B-Tree', cat: 'E', rel: ['db.btree-index'] },
  { q: 'Redis', cat: 'E', rel: ['db.redis', 'db.cache-aside', 'db.cache-invalidation'] },
  // C. Korean, 1-2 chars (trigram cannot index)
  { q: '캐시', cat: 'S', rel: ['net.http-caching', 'net.cdn', 'db.redis', 'db.cache-aside', 'db.cache-invalidation', 'db.cache-stampede', 'algo.lru-cache', 'algo.cache-policies', 'os.cpu-cache', 'os.tlb', 'docker.image-layers', 'web.service-worker', 'ci.artifact', 'net.dns-resolution', 'os.fsync'] },
  { q: '해시', cat: 'S', rel: ['ds.hash-table', 'ds.hash-collision', 'sec.hash-functions', 'sec.password-hashing', 'sec.hmac', 'ds.consistent-hashing', 'db.join-algorithms', 'algo.lru-cache'] },
  { q: '파드', cat: 'S', rel: ['k8s.pod', 'k8s.pod-scheduling', 'k8s.deployment', 'k8s.service', 'k8s.hpa', 'k8s.configmap-secret', 'k8s.pv-pvc', 'k8s.taint-toleration', 'k8s.cni'] },
  { q: '도커', cat: 'S', rel: ['docker.image-layers', 'docker.multistage-build', 'docker.volumes', 'docker.networking', 'docker.compose'] },
  { q: '큐', cat: 'S', rel: ['ds.queue', 'ds.deque', 'ds.priority-queue', 'arch.message-queue', 'algo.bfs-dfs', 'os.ipc', 'js.event-loop', 'js.microtask', 'algo.dijkstra'] },
  { q: '락', cat: 'S', rel: ['db.locking', 'db.deadlock', 'os.file-lock'] },
  { q: '소켓', cat: 'S', rel: ['net.socket', 'os.fd', 'os.ipc', 'net.websocket'] },
  { q: '세션', cat: 'S', rel: ['sec.session-vs-token', 'db.redis', 'net.tls-handshake'] },
  { q: '트리', cat: 'S', rel: ['ds.binary-tree', 'ds.bst', 'ds.avl-redblack', 'ds.trie', 'ds.segment-tree', 'algo.mst', 'db.btree-index', 'ds.heap'] },
  { q: '스택', cat: 'S', rel: ['ds.stack', 'os.stack-heap', 'algo.recursion', 'algo.bfs-dfs', 'js.event-loop'] },
  // D. Mixed / natural developer queries (incl. 2-char tokens next to long ones)
  { q: 'TCP 3-way 핸드셰이크', cat: 'M', rel: ['net.tcp-3way-handshake'] },
  { q: 'JWT 검증', cat: 'M', rel: ['sec.jwt-verify'] },
  { q: '쿠버네티스 스케줄링', cat: 'M', rel: ['k8s.pod-scheduling', 'k8s.taint-toleration'] },
  { q: 'CI 파이프라인', cat: 'M', rel: ['ci.cicd-pipeline', 'ci.github-actions', 'ci.artifact'] },
  { q: 'docker 멀티스테이지', cat: 'M', rel: ['docker.multistage-build'] },
  { q: 'DB 인덱스', cat: 'M', rel: ['db.index-basics', 'db.btree-index', 'db.composite-index', 'db.covering-index'] },
  { q: 'HTTP 캐시', cat: 'M', rel: ['net.http-caching'] },
  { q: 'redis 캐시', cat: 'M', rel: ['db.redis', 'db.cache-aside', 'db.cache-invalidation'] },
  { q: 'git 리베이스', cat: 'M', rel: ['git.rebase-vs-merge'] },
  { q: 'SQL 조인', cat: 'M', rel: ['db.join-types', 'db.join-algorithms'] },
];

// Known failure-mode probes (category F): whitespace variance and a Korean particle (josa) attached to a noun.
// Reported separately from the 40-query headline set.
export const PROBES = [
  { q: '이벤트루프', cat: 'F', rel: ['js.event-loop', 'js.microtask'] },
  { q: '쿠버네티스에서 파드', cat: 'F', rel: ['k8s.pod', 'k8s.pod-scheduling'] },
];
