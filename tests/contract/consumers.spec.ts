import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import { ROUTING, SUBSCRIPTIONS } from '@fathom/contracts/events/routing.gen';
import { APP_ROOT } from '@fathom/testkit/spawn-stack';
import { describe, expect, it } from 'vitest';

// CT-SYS-002 — 소비자 매니페스트 ↔ 이벤트 스냅샷 ↔ 생성된 라우팅 표(TST-01 §6.3).

type Json = Record<string, unknown>;
type Routing = Record<string, Record<string, { mode: string; types: readonly string[] }>>;
type Subscriptions = Record<
  string,
  Record<string, { mode: string; on_poison: string; schema_versions: readonly number[]; reads: readonly string[] }>
>;

const CONTRACTS = path.join(APP_ROOT, 'packages', 'contracts');
const PRODUCER_BY_PREFIX: Readonly<Record<string, string>> = {
  catalog: 'content',
  acquisition: 'content',
  itembank: 'content',
  grading: 'content',
  learning: 'learning',
  ai: 'ai-gateway',
  ops: 'ops-api',
};

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}
function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `$ref`·`anyOf`·`oneOf`·`allOf`를 펼쳐 이 스키마가 될 수 있는 객체 후보를 모은다. */
function expand(schema: unknown, root: Json, depth = 0): Json[] {
  if (!isRecord(schema) || depth > 8) {
    return [];
  }
  const out: Json[] = [schema];
  const ref = schema.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
    const defs = root.$defs;
    const target = isRecord(defs) ? defs[ref.slice('#/$defs/'.length)] : undefined;
    out.push(...expand(target, root, depth + 1));
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const alts = schema[key];
    if (Array.isArray(alts)) {
      for (const alt of alts) {
        out.push(...expand(alt, root, depth + 1));
      }
    }
  }
  if (isRecord(schema.items)) {
    out.push(...expand(schema.items, root, depth + 1));
  }
  return out;
}

function resolves(root: Json, dotted: string): boolean {
  let current: Json[] = expand(root, root);
  for (const segment of dotted.split('.')) {
    const next: Json[] = [];
    for (const candidate of current) {
      const props = candidate.properties;
      if (isRecord(props) && segment in props) {
        next.push(...expand(props[segment], root));
      }
    }
    if (next.length === 0) {
      return false;
    }
    current = next;
  }
  return true;
}

function loadManifests(): ConsumerManifest[] {
  const dir = path.join(CONTRACTS, 'src', 'events', '__consumers__');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => ConsumerManifest.parse(readJson(path.join(dir, n))));
}

describe('교차 계약: 소비자 매니페스트', () => {
  it('CT-SYS-002 소비자 매니페스트 5개가 이벤트 스냅샷·라우팅 표와 일치하고 23종 모두 소비자가 있다 [NFR-MAINT-003][IF-COM-004]', () => {
    // Arrange
    const dir = path.join(CONTRACTS, 'src', 'events', '__consumers__');
    const files = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
    const manifests = loadManifests();
    const snapshotDir = path.join(CONTRACTS, '.snapshots', 'events');
    const snapshotFiles = readdirSync(snapshotDir).filter((n) => n.endsWith('.json'));
    const types = new Set(snapshotFiles.map((n) => n.replace(/\.v\d+\.json$/, '')));
    const routing: Routing = ROUTING;
    const subscriptions: Subscriptions = SUBSCRIPTIONS;
    const violations: string[] = [];
    const consumed = new Set<string>();
    // Act
    for (const [i, manifest] of manifests.entries()) {
      if (files[i]?.replace(/\.json$/, '') !== manifest.consumer) {
        violations.push(`file/consumer name mismatch: ${files[i] ?? '?'} vs ${manifest.consumer}`);
      }
      for (const sub of manifest.subscriptions) {
        const tag = `${manifest.consumer}/${sub.type}`;
        consumed.add(sub.type);
        if (!types.has(sub.type)) {
          violations.push(`${tag}: unknown event type`);
        }
        for (const n of sub.schema_versions) {
          const file = path.join(snapshotDir, `${sub.type}.v${String(n)}.json`);
          let schema: unknown = null;
          try {
            schema = readJson(file);
          } catch {
            violations.push(`${tag}: snapshot v${String(n)} missing`);
            continue;
          }
          for (const read of sub.reads.filter((r) => r !== '*')) {
            if (!isRecord(schema) || !resolves(schema, read)) {
              violations.push(`${tag}: reads '${read}' not found in v${String(n)} schema`);
            }
          }
        }
        const gen = subscriptions[manifest.consumer]?.[sub.type];
        if (
          gen === undefined ||
          gen.mode !== sub.mode ||
          gen.on_poison !== sub.on_poison ||
          JSON.stringify(gen.schema_versions) !== JSON.stringify(sub.schema_versions)
        ) {
          violations.push(`${tag}: SUBSCRIPTIONS mismatch`);
        }
        const producer = PRODUCER_BY_PREFIX[sub.type.split('.')[0] ?? ''];
        const route = producer === undefined ? undefined : routing[producer]?.[manifest.consumer];
        if (route === undefined || !route.types.includes(sub.type) || route.mode !== sub.mode) {
          violations.push(`${tag}: ROUTING mismatch (producer ${producer ?? '?'})`);
        }
      }
    }
    for (const type of types) {
      if (!consumed.has(type)) {
        violations.push(`${type}: no consumer`);
      }
    }
    // Assert
    expect(manifests.map((m) => m.consumer).sort()).toEqual([
      'ai-gateway',
      'content',
      'gateway',
      'learning',
      'ops-api',
    ]);
    expect(types.size).toBe(23);
    expect(violations).toEqual([]);
  });
});
