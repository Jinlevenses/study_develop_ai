// R-REF — 존재해야 하는 참조(개념·KU·MC·루브릭·출처·본문 지시문·링크·도식)와 문항 내부 키 정합(Brief T-01-03 §4.4).
import { conceptLinksOf, directivesOf, fencesOf } from '../../parse/markdown.js';
import type { Item } from '../../parse/schema/item.js';
import { byCode, finding } from '../../validate/finding.js';
import type { Finding } from '../../validate/finding.js';
import { fullId } from '../../validate/model.js';
import type { ConceptFile, ItemFileEntry, ItemModelFileEntry, LintContext } from '../../validate/model.js';

type Sink = (file: string, keypath: string, message: string) => void;

function keysOf(record: Readonly<Record<string, unknown>> | undefined): Set<string> {
  return new Set(Object.keys(record ?? {}));
}

/** 개념 파일(frontmatter + 본문)의 참조. */
function checkConcept(c: ConceptFile, ctx: LintContext, err: Sink): void {
  const { idx } = ctx;
  const d = c.data;
  const need = (keypath: string, id: string): void => {
    if (!idx.conceptById.has(id)) {
      err(c.rel, keypath, `unknown concept '${id}'`);
    }
  };
  for (const [i, p] of d.prereqs.entries()) {
    need(`prereqs.${i}`, p);
  }
  for (const s of Object.keys(d.siblings)) {
    need(`siblings.${s}`, s);
  }
  for (const [i, e] of d.extends.entries()) {
    need(`extends.${i}`, e);
  }
  if (d.deprecated_by !== null) {
    need('deprecated_by', d.deprecated_by);
  }
  for (const [i, s] of d.sources.entries()) {
    if (!idx.sourceIds.has(s.source_id)) {
      err(c.rel, `sources.${i}.source_id`, `unknown source '${s.source_id}'`);
    }
  }

  // 본문: 지시문·링크·mermaid ↔ diagrams
  const fenceKeys = new Set<string>();
  for (const sec of c.body.sections) {
    for (const dir of directivesOf(sec.lines)) {
      if (dir.name === 'lab' || dir.name === 'case') {
        err(c.rel, `body.${sec.title}`, `unsupported-in-it01: ::${dir.name}[${dir.arg ?? ''}] is not supported in IT-01`);
      } else if (dir.name === 'embed') {
        const arg = dir.arg ?? '';
        const format = idx.itemFormatById.get(arg);
        if (format === undefined) {
          err(c.rel, `body.${sec.title}`, `::embed[${arg}] refers to an unknown item`);
        } else if (format !== 'embedded') {
          err(c.rel, `body.${sec.title}`, `::embed[${arg}] must refer to an item of format 'embedded' (is '${format}')`);
        }
      }
    }
    for (const target of conceptLinksOf(sec.lines)) {
      if (!idx.conceptById.has(target)) {
        err(c.rel, `body.${sec.title}`, `link concept:${target} refers to an unknown concept`);
      }
    }
    for (const f of fencesOf(sec.lines)) {
      if (f.lang === 'mermaid') {
        if (f.key === null) {
          err(c.rel, `body.${sec.title}`, 'mermaid fence needs a diagram key: ```mermaid dg_<key>');
        } else {
          fenceKeys.add(f.key);
          if (!Object.hasOwn(d.diagrams, f.key)) {
            err(c.rel, `body.${sec.title}`, `mermaid fence '${f.key}' has no entry in diagrams`);
          }
        }
      }
    }
  }
  for (const m of c.body.malformedDirectives) {
    err(c.rel, `body.line${m.line}`, `malformed directive: ${m.text}`);
  }
  for (const key of Object.keys(d.diagrams).sort(byCode)) {
    if (!fenceKeys.has(key)) {
      err(c.rel, `diagrams.${key}`, `diagram '${key}' has no mermaid fence in the body`);
    }
  }
}

function checkKusAndMcs(ctx: LintContext, err: Sink): void {
  const { idx, model } = ctx;
  for (const f of model.kus) {
    const own = keysOf(f.data.kus);
    for (const [key, ku] of Object.entries(f.data.kus)) {
      if (ku.deprecated_by !== null && !own.has(ku.deprecated_by)) {
        err(f.rel, `kus.${key}.deprecated_by`, `unknown ku '${ku.deprecated_by}'`);
      }
      for (const [i, s] of ku.source_refs.entries()) {
        if (!idx.sourceIds.has(s.source_id)) {
          err(f.rel, `kus.${key}.source_refs.${i}.source_id`, `unknown source '${s.source_id}'`);
        }
      }
    }
  }
  for (const f of model.mcs) {
    const kus = keysOf(idx.kusByConcept.get(f.data.concept_id)?.data.kus);
    for (const [key, mc] of Object.entries(f.data.mcs)) {
      for (const [i, r] of mc.refutes.entries()) {
        if (!kus.has(r)) {
          err(f.rel, `mcs.${key}.refutes.${i}`, `unknown ku '${r}' in concept ${f.data.concept_id}`);
        }
      }
      for (const [i, s] of mc.source_refs.entries()) {
        if (!idx.sourceIds.has(s.source_id)) {
          err(f.rel, `mcs.${key}.source_refs.${i}.source_id`, `unknown source '${s.source_id}'`);
        }
      }
    }
  }
}

function rubricOk(ctx: LintContext, track: string | null, id: string): boolean {
  return ctx.idx.commonRubricIds.has(id) || (ctx.idx.packRubricIds.get(track ?? '')?.has(id) ?? false);
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** 문항 하나의 참조·내부 키 검사. */
function checkItem(f: ItemFileEntry, key: string, item: Item, ctx: LintContext, err: Sink): void {
  const { idx } = ctx;
  const cid = f.data.concept_id;
  const at = `items.${key}`;
  const ku = (keypath: string, ref: string): void => {
    if (!idx.kuIds.has(fullId(cid, ref))) {
      err(f.rel, `${at}.${keypath}`, `unknown ku '${ref}'`);
    }
  };
  const mc = (keypath: string, ref: string): void => {
    if (!idx.mcIds.has(fullId(cid, ref))) {
      err(f.rel, `${at}.${keypath}`, `unknown misconception '${ref}'`);
    }
  };
  const rubric = (keypath: string, id: string): void => {
    if (!rubricOk(ctx, f.disc.track, id)) {
      err(f.rel, `${at}.${keypath}`, `unknown rubric '${id}' (shared or same-pack rubrics only)`);
    }
  };
  const inKeys = (keypath: string, value: string, keys: ReadonlySet<string>, what: string): void => {
    if (!keys.has(value)) {
      err(f.rel, `${at}.${keypath}`, `'${value}' is not a key of ${what}`);
    }
  };
  const span = (keypath: string, from: number, to: number): void => {
    if (from > to) {
      err(f.rel, `${at}.${keypath}`, `from (${from}) must be <= to (${to})`);
    }
  };
  const distractors = (opts: ReadonlySet<string>, map: Readonly<Record<string, string>>): void => {
    for (const [o, ref] of Object.entries(map)) {
      inKeys(`distractor_mc.${o}`, o, opts, 'options');
      mc(`distractor_mc.${o}`, ref);
    }
  };

  for (const [i, r] of item.ku_refs.entries()) {
    ku(`ku_refs.${i}`, r);
  }
  for (const [i, r] of item.mc_refs.entries()) {
    mc(`mc_refs.${i}`, r);
  }

  switch (item.format) {
    case 'ox':
      if (item.false_mc !== undefined) {
        mc('false_mc', item.false_mc);
      }
      break;
    case 'mcq': {
      const opts = keysOf(item.options);
      inKeys('answer', item.answer, opts, 'options');
      distractors(opts, item.distractor_mc);
      for (const o of Object.keys(item.option_rationale)) {
        inKeys(`option_rationale.${o}`, o, opts, 'options');
      }
      break;
    }
    case 'mcq_multi': {
      const opts = keysOf(item.options);
      for (const o of Object.keys(item.answer)) {
        inKeys(`answer.${o}`, o, opts, 'options');
      }
      break;
    }
    case 'cloze': {
      const used = new Set<string>([...item.stem.matchAll(/\{\{(b[1-9])\}\}/g)].map((m) => m[1] ?? ''));
      const blanks = keysOf(item.blanks);
      if (!sameSet(used, blanks)) {
        err(
          f.rel,
          `${at}.stem`,
          `placeholders {{${[...used].sort(byCode).join(',')}}} do not match blanks [${[...blanks].sort(byCode).join(',')}]`,
        );
      }
      break;
    }
    case 'order': {
      const steps = keysOf(item.steps);
      const ans = new Set(item.answer);
      if (ans.size !== item.answer.length || !sameSet(ans, steps)) {
        err(f.rel, `${at}.answer`, 'answer must be a permutation of the steps keys');
      }
      break;
    }
    case 'matching': {
      const right = keysOf(item.right);
      if (!sameSet(keysOf(item.answer), keysOf(item.left))) {
        err(f.rel, `${at}.answer`, 'answer keys must be exactly the left keys');
      }
      for (const [l, r] of Object.entries(item.answer)) {
        inKeys(`answer.${l}`, r, right, 'right');
      }
      break;
    }
    case 'error_find':
      span('answer', item.answer.from, item.answer.to);
      if (item.bug_mc !== undefined) {
        mc('bug_mc', item.bug_mc);
      }
      break;
    case 'parsons': {
      const lines = keysOf(item.lines);
      for (const [i, l] of item.answer.entries()) {
        inKeys(`answer.${i}`, l, lines, 'lines');
      }
      break;
    }
    case 'config_review':
      for (const [df, d] of Object.entries(item.defect_manifest)) {
        span(`defect_manifest.${df}`, d.from, d.to);
        if (d.mc_ref !== undefined) {
          mc(`defect_manifest.${df}.mc_ref`, d.mc_ref);
        }
      }
      break;
    case 'log_read': {
      const opts = keysOf(item.options);
      inKeys('answer', item.answer, opts, 'options');
      distractors(opts, item.distractor_mc);
      break;
    }
    case 'cond_reversal': {
      const opts = keysOf(item.options);
      inKeys('answer.cond_a', item.answer.cond_a, opts, 'options');
      inKeys('answer.cond_b', item.answer.cond_b, opts, 'options');
      break;
    }
    case 'fermi':
      if (item.assumptions_rubric !== undefined) {
        rubric('assumptions_rubric', item.assumptions_rubric);
      }
      break;
    case 'blank_note':
      rubric('solo_rubric', item.solo_rubric);
      for (const [k, u] of Object.entries(item.idea_units)) {
        ku(`idea_units.${k}.ku_ref`, u.ku_ref);
      }
      break;
    case 'essay':
      rubric('rubric', item.rubric);
      for (const [k, p] of Object.entries(item.key_points)) {
        ku(`key_points.${k}.ku_ref`, p.ku_ref);
      }
      break;
    case 'digging':
      for (const [k, p] of Object.entries(item.expects)) {
        ku(`expects.${k}.ku_ref`, p.ku_ref);
      }
      for (const [k, fu] of Object.entries(item.followups)) {
        if (fu.mc_ref !== undefined) {
          mc(`followups.${k}.mc_ref`, fu.mc_ref);
        }
      }
      break;
    case 'digging_d4_mcq': {
      const opts = keysOf(item.options);
      inKeys('answer', item.answer, opts, 'options');
      distractors(opts, item.distractor_mc);
      break;
    }
    case 'feynman':
      rubric('rubric', item.rubric);
      for (const [k, b] of Object.entries(item.student_beliefs)) {
        mc(`student_beliefs.${k}.mc_ref`, b.mc_ref);
      }
      for (const [k, c] of Object.entries(item.checklist)) {
        ku(`checklist.${k}.ku_ref`, c.ku_ref);
      }
      break;
    case 'audit':
      for (const [df, d] of Object.entries(item.defect_manifest)) {
        if (d.mc_ref !== undefined) {
          mc(`defect_manifest.${df}.mc_ref`, d.mc_ref);
        }
      }
      break;
    case 'pr_review':
      for (const [df, d] of Object.entries(item.defect_manifest)) {
        span(`defect_manifest.${df}`, d.from, d.to);
      }
      break;
    case 'embedded':
      if (item.false_mc !== undefined) {
        mc('false_mc', item.false_mc);
      }
      if (item.shape === 'mcq') {
        if (item.options === undefined) {
          err(f.rel, `${at}.options`, "shape 'mcq' requires options");
        } else if (typeof item.answer !== 'string') {
          err(f.rel, `${at}.answer`, "shape 'mcq' requires an option key answer");
        } else {
          inKeys('answer', item.answer, keysOf(item.options), 'options');
        }
      } else {
        if (item.options !== undefined) {
          err(f.rel, `${at}.options`, "shape 'ox' must not have options");
        }
        if (typeof item.answer !== 'boolean') {
          err(f.rel, `${at}.answer`, "shape 'ox' requires a boolean answer");
        }
      }
      break;
    default:
      break;
  }
}

function checkModel(f: ItemModelFileEntry, ctx: LintContext, err: Sink): void {
  const cid = f.data.concept_id;
  const kuOk = (keypath: string, ref: string): void => {
    if (!ctx.idx.kuIds.has(fullId(cid, ref))) {
      err(f.rel, keypath, `unknown ku '${ref}'`);
    }
  };
  for (const [key, m] of Object.entries(f.data.models)) {
    if (m.kind === 't1') {
      for (const [i, r] of m.ku_refs.entries()) {
        kuOk(`models.${key}.ku_refs.${i}`, r);
      }
    } else {
      for (const [i, r] of (m.source.ku_refs ?? []).entries()) {
        kuOk(`models.${key}.source.ku_refs.${i}`, r);
      }
    }
  }
}

export function ruleRef(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  const err: Sink = (file, keypath, message) => {
    out.push(finding('R-REF', 'error', file, keypath, message));
  };
  for (const c of ctx.model.concepts) {
    checkConcept(c, ctx, err);
  }
  checkKusAndMcs(ctx, err);
  for (const f of ctx.model.items) {
    for (const [key, item] of Object.entries(f.data.items)) {
      checkItem(f, key, item, ctx, err);
    }
  }
  for (const f of ctx.model.itemModels) {
    checkModel(f, ctx, err);
  }
  return out;
}
