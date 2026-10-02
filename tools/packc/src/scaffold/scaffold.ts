// scaffold(PGM-PACKC-005): R4 §5 표 → Tier C 골격 개념 469개 + pack.yaml 20개. 이미 있는 파일은 절대 덮어쓰지 않는다(멱등).
// 입력 파손은 아무것도 쓰기 전에 err로 돌려준다(exit 2). 쓰기는 파일마다 `*.tmp` → rename.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { parseR4 } from './r4.js';
import { renderConcept, renderPackYaml } from './render.js';
import { TRACKS, trackOf } from './tracks.js';

export type ScaffoldSummary = {
  readonly rows: number;
  readonly edges: number;
  readonly created: number;
  readonly skipped: number;
  readonly packsCreated: number;
};

export type ScaffoldOptions = {
  readonly r4Path: string;
  readonly contentDir: string;
  /** YYYY-MM-DD. */
  readonly asOf: string;
};

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

export function scaffold(opts: ScaffoldOptions): Result<ScaffoldSummary, string> {
  if (!existsSync(opts.r4Path)) {
    return err(`R4 file not found: ${opts.r4Path}`);
  }
  const table = parseR4(readFileSync(opts.r4Path, 'utf8'));
  if (!table.ok) {
    return err(table.error);
  }
  const plan: { path: string; text: string }[] = [];
  for (const row of table.value.rows) {
    const track = trackOf(row.track);
    if (track === undefined) {
      return err(`R4 ${row.id}: track '${row.track}' is not one of the 20 tracks`);
    }
    plan.push({
      path: join(opts.contentDir, 'packs', row.track, 'concepts', `${row.id}.md`),
      text: renderConcept(row, track, opts.asOf),
    });
  }
  const packPlan: { path: string; text: string }[] = [];
  for (const t of TRACKS) {
    const text = renderPackYaml(t.id);
    if (text !== null) {
      packPlan.push({ path: join(opts.contentDir, 'packs', t.id, 'pack.yaml'), text });
    }
  }
  let created = 0;
  let skipped = 0;
  for (const p of plan) {
    if (existsSync(p.path)) {
      skipped += 1;
    } else {
      writeAtomic(p.path, p.text);
      created += 1;
    }
  }
  let packsCreated = 0;
  for (const p of packPlan) {
    if (!existsSync(p.path)) {
      writeAtomic(p.path, p.text);
      packsCreated += 1;
    }
  }
  return ok({ rows: table.value.rows.length, edges: table.value.edges, created, skipped, packsCreated });
}
