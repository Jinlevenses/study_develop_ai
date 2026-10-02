// scaffold 생성 파일의 정확한 바이트(Brief T-01-03 §4.7). 문자열 값은 JSON.stringify(YAML 이중 따옴표 호환), 배열은 흐름 표기, LF, 끝 \n 1개.
import type { R4Row } from './r4.js';
import type { TrackDef } from './tracks.js';
import { trackOf } from './tracks.js';

const REVIEW_DAYS = { stable: 1095, evolving: 180, volatile: 90 } as const;

const q = (s: string): string => JSON.stringify(s);

/** `YYYY-MM-DD` + days(UTC 달력). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map((x) => Number.parseInt(x, 10));
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** `tcp-handshake` → `Tcp handshake`. */
export function englishTitle(id: string): string {
  const slug = id.slice(id.indexOf('.') + 1).replace(/-/g, ' ');
  return `${slug.charAt(0).toUpperCase()}${slug.slice(1)}`;
}

export function stage2Kind(row: R4Row): 'code' | 'case' {
  if (row.primary === 'P') {
    return 'code';
  }
  return row.layer.includes('사') || row.primary === 'S' ? 'case' : 'code';
}

export function renderConcept(row: R4Row, track: TrackDef, asOf: string): string {
  const en = englishTitle(row.id);
  const summary = `${row.titleKo}: ${track.name_ko} 트랙의 L${row.level} 개념이다.`;
  const reviewBy = addDays(asOf, REVIEW_DAYS[track.volatility]);
  const secondary = row.secondary.join(', ');
  return [
    '---',
    'schema_v: 1',
    `id: ${row.id}`,
    `track: ${row.track}`,
    `level: ${row.level}`,
    'tier: C',
    `knowledge_type: { primary: ${row.primary}, secondary: [${secondary}] }`,
    `stage2_kind: ${stage2Kind(row)}`,
    `title: { ko: ${q(row.titleKo)}, en: ${q(en)} }`,
    `summary_ko: ${q(summary)}`,
    `aliases: [${q(en)}]`,
    'tags: []',
    `volatility: ${track.volatility}`,
    'required_for_level: null',
    `prereqs: [${row.prereqs.join(', ')}]`,
    'sources:',
    `  - { source_id: ${track.source_id}, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: ${q(asOf)} }`,
    `review: { valid_as_of: ${q(asOf)}, review_by: ${q(reviewBy)} }`,
    '---',
    '',
    '## 이론',
    '',
    summary,
    '',
    '## 코드',
    '',
    '::needs-enrichment',
    '',
    '## 핵심',
    '',
    `- 무엇인가: ${row.titleKo}는 무엇이고 어떤 문제를 푸는가?`,
    `- 왜 필요한가: ${row.titleKo}가 없으면 무엇이 어려워지는가?`,
    `- 언제 쓰지 않나: ${row.titleKo}를 쓰지 않는 편이 나은 상황은?`,
    '',
  ].join('\n');
}

export function renderPackYaml(trackId: string): string | null {
  const t = trackOf(trackId);
  if (t === undefined) {
    return null;
  }
  return [
    `# content/packs/${t.id}/pack.yaml`,
    '# yaml-language-server: $schema=../../.schemas/pack.schema.json',
    'schema_v: 1',
    `id: ${t.id}`,
    'version: "0.1.0"',
    'channel: seed',
    `track: { id: ${t.id}, name_ko: ${q(t.name_ko)}, name_en: ${q(t.name_en)}, track_group: ${t.group}, sort_order: ${t.sort},`,
    `         summary_ko: ${q(t.summary_ko)} }`,
    'requires: { packc: ">=0.1.0 <1.0.0", policy: { mastery_rules: v1, gate_thresholds: v1 } }',
    'content_license: repo',
    '',
  ].join('\n');
}
