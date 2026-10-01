#!/usr/bin/env node
// check:frozen (NFR-MAINT-006, ADR-008 결정 8, ADR-000, D-P00-08) — 동결 파일(frozen.lock)의 sha256 대조와 계약 스냅샷 diff 분류.
//   frozen/missing · changed-without-trailer · changed-with-trailer(warn) · pending-not-owner · pending-changed(warn) · lock-edit
//   frozen/destructive-without-adr · additive-without-cr (스냅샷 JSON Schema 재귀 비교)
// 트레일러: 커밋 메시지 줄 `CR: CR-<nn>` · `ADR: ADR-<nnn>`(대소문자 구분).
// 사용: node tools/gates/check-frozen.mjs [--root <dir>] [--lock <path>] [--task <T-nn-mm>] [--base <ref>] [--changed-from <file>]
//        [--message-file <file>] [--base-dir <dir>] [--snapshots <dir>] [--json] [--quiet]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, readJsonc, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { changedFiles, commitMessages, showAtBase } from './lib/git.mjs';
import { matchAny } from './lib/glob.mjs';

const LOCK_FORMAT = 'fathom-frozen-lock/1';
const CR_RE = /^CR:\s*CR-\d{2,3}\s*$/m;
const ADR_RE = /^ADR:\s*ADR-\d{3}\s*$/m;
const TASK_TOKEN_RE = /T-\d{2}-\d{2}/g;
const NUMERIC_KEYS = [
  'const',
  'pattern',
  'format',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const esc = (seg) => String(seg).replace(/~/g, '~0').replace(/\//g, '~1');

/** JSON Schema 두 버전 비교 → {destructive: ptr[], additive: ptr[]}. */
export function diffSchema(base, cur) {
  const out = { destructive: [], additive: [] };
  const D = (ptr, why) => out.destructive.push(`${ptr || '/'} (${why})`);
  const A = (ptr, why) => out.additive.push(`${ptr || '/'} (${why})`);
  const walk = (b, c, ptr) => {
    if (!isObject(b) || !isObject(c)) {
      return;
    }
    if (!sameJson(b.type, c.type) && (b.type !== undefined || c.type !== undefined)) {
      D(`${ptr}/type`, 'type changed');
    }
    if (Array.isArray(b.enum) || Array.isArray(c.enum)) {
      const be = Array.isArray(b.enum) ? b.enum : [];
      const ce = Array.isArray(c.enum) ? c.enum : [];
      if (Array.isArray(b.enum) && !Array.isArray(c.enum)) {
        // enum 제약 제거 = 완화(가산)
        A(`${ptr}/enum`, 'enum removed');
      } else {
        for (const v of be) {
          if (!ce.some((x) => sameJson(x, v))) {
            D(`${ptr}/enum`, `value ${JSON.stringify(v)} removed`);
          }
        }
        for (const v of ce) {
          if (!be.some((x) => sameJson(x, v))) {
            A(`${ptr}/enum`, `value ${JSON.stringify(v)} added`);
          }
        }
      }
    }
    for (const k of NUMERIC_KEYS) {
      if (!sameJson(b[k], c[k])) {
        D(`${ptr}/${k}`, `${k} changed`);
      }
    }
    const breq = Array.isArray(b.required) ? b.required : [];
    const creq = Array.isArray(c.required) ? c.required : [];
    for (const r of creq) {
      if (!breq.includes(r)) {
        D(`${ptr}/required`, `"${r}" became required`);
      }
    }
    if (isObject(b.properties) || isObject(c.properties)) {
      const bp = isObject(b.properties) ? b.properties : {};
      const cp = isObject(c.properties) ? c.properties : {};
      for (const key of Object.keys(bp)) {
        if (!(key in cp)) {
          D(`${ptr}/properties/${esc(key)}`, 'property removed');
        } else {
          walk(bp[key], cp[key], `${ptr}/properties/${esc(key)}`);
        }
      }
      for (const key of Object.keys(cp)) {
        if (!(key in bp) && !creq.includes(key)) {
          A(`${ptr}/properties/${esc(key)}`, 'optional property added');
        }
      }
    }
    for (const dk of ['$defs', 'definitions']) {
      if (isObject(b[dk]) || isObject(c[dk])) {
        const bd = isObject(b[dk]) ? b[dk] : {};
        const cd = isObject(c[dk]) ? c[dk] : {};
        for (const key of Object.keys(bd)) {
          if (!(key in cd)) {
            D(`${ptr}/${dk}/${esc(key)}`, 'definition removed');
          } else {
            walk(bd[key], cd[key], `${ptr}/${dk}/${esc(key)}`);
          }
        }
        for (const key of Object.keys(cd)) {
          if (!(key in bd)) {
            A(`${ptr}/${dk}/${esc(key)}`, 'definition added');
          }
        }
      }
    }
    if (isObject(b.items) || isObject(c.items)) {
      walk(b.items, c.items, `${ptr}/items`);
    }
    if (Array.isArray(b.prefixItems) && Array.isArray(c.prefixItems)) {
      b.prefixItems.forEach((x, i) => {
        walk(x, c.prefixItems[i], `${ptr}/prefixItems/${i}`);
      });
    }
    for (const uk of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(b[uk]) || Array.isArray(c[uk])) {
        const ba = Array.isArray(b[uk]) ? b[uk] : [];
        const ca = Array.isArray(c[uk]) ? c[uk] : [];
        for (let i = 0; i < Math.min(ba.length, ca.length); i++) {
          walk(ba[i], ca[i], `${ptr}/${uk}/${i}`);
        }
        for (let i = ca.length; i < ba.length; i++) {
          D(`${ptr}/${uk}/${i}`, 'union branch removed');
        }
        for (let i = ba.length; i < ca.length; i++) {
          A(`${ptr}/${uk}/${i}`, 'union branch added');
        }
      }
    }
  };
  walk(base, cur, '');
  return out;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function loadLock(lockAbs) {
  if (!existsSync(lockAbs)) {
    throw new GateEngineError('engine/input-missing', `frozen.lock not found: ${lockAbs}`);
  }
  const lock = readJsonc(lockAbs);
  if (!isObject(lock) || lock.format !== LOCK_FORMAT) {
    throw new GateEngineError(
      'engine/config',
      `${lockAbs}: format must be "${LOCK_FORMAT}" (got ${JSON.stringify(lock?.format)})`,
    );
  }
  if (!Array.isArray(lock.files) || lock.files.length === 0) {
    throw new GateEngineError('engine/config', `${lockAbs}: files[] must be a non-empty array`);
  }
  for (const f of lock.files) {
    if (!isObject(f) || typeof f.path !== 'string' || typeof f.sha256 !== 'string') {
      throw new GateEngineError('engine/config', `${lockAbs}: invalid files[] entry ${JSON.stringify(f)}`);
    }
  }
  return {
    files: lock.files,
    pending: Array.isArray(lock.pending) ? lock.pending : [],
    excluded: new Set(
      (Array.isArray(lock.excluded) ? lock.excluded : []).map((e) => e?.path).filter((p) => typeof p === 'string'),
    ),
  };
}

const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

export function analyze(root, opts) {
  const lockAbs = path.resolve(root, opts.lock ?? 'docs/02-design/frozen.lock');
  const lock = loadLock(lockAbs);
  const lockRel = toRel(root, lockAbs);
  const task = opts.task;
  const taskBase = task === undefined ? undefined : (/^(T-\d{2}-\d{2})/.exec(task)?.[1] ?? task);
  const changed = changedFiles(root, { base: opts.base ?? 'HEAD', changedFrom: opts.changedFrom }).filter(
    (f) => !lock.excluded.has(f),
  );
  const msgs = commitMessages(root, { base: opts.base ?? 'HEAD', messageFile: opts.messageFile });
  const hasTrailer = CR_RE.test(msgs) || ADR_RE.test(msgs);
  const hasAdr = ADR_RE.test(msgs);
  const violations = [];
  const add = (file, rule, message, severity = 'error') => violations.push({ file, line: 0, rule, message, severity });

  // 1. 동결 파일 sha256
  for (const f of lock.files) {
    if (lock.excluded.has(f.path)) {
      continue;
    }
    const abs = path.join(root, f.path);
    if (!existsSync(abs)) {
      add(f.path, 'frozen/missing', `${f.path} is frozen but missing`);
      continue;
    }
    if (sha256(readFileSync(abs)) !== f.sha256) {
      if (hasTrailer) {
        add(
          f.path,
          'frozen/changed-with-trailer',
          `${f.path} differs from frozen.lock; CR/ADR trailer present — T1 must regenerate frozen.lock`,
          'warn',
        );
      } else {
        add(
          f.path,
          'frozen/changed-without-trailer',
          `${f.path} differs from frozen.lock and no \`CR: CR-<nn>\` / \`ADR: ADR-<nnn>\` trailer (ADR-000)`,
        );
      }
    }
  }

  // 2. pending(소유 Task 외 변경)
  for (const f of changed) {
    for (const p of lock.pending) {
      if (typeof p?.glob !== 'string' || !matchAny(f, [p.glob])) {
        continue;
      }
      if (hasTrailer) {
        break;
      }
      if (taskBase === undefined) {
        add(
          f,
          'frozen/pending-changed',
          `${f} matches pending ${p.glob} (owner ${p.owner_task ?? '?'}); no --task to verify ownership`,
          'warn',
        );
      } else {
        const owners = String(p.owner_task ?? '').match(TASK_TOKEN_RE) ?? [];
        if (!owners.includes(taskBase)) {
          add(
            f,
            'frozen/pending-not-owner',
            `${f} matches pending ${p.glob} owned by ${owners.join(', ') || '?'}; ${task} may not change it`,
          );
        }
      }
      break;
    }
  }

  // 3. lock 자체 수정
  if (task !== undefined && changed.includes(lockRel)) {
    add(lockRel, 'frozen/lock-edit', 'frozen.lock may be changed by T1 only');
  }

  // 4. 스냅샷 diff 분류
  const snapDir = toRel(root, path.resolve(root, opts.snapshots ?? 'packages/contracts/.snapshots'));
  for (const f of changed) {
    if (!(f.startsWith(`${snapDir}/`) && f.endsWith('.json'))) {
      continue;
    }
    const baseText = opts.baseDir
      ? existsSync(path.resolve(root, opts.baseDir, f))
        ? readFileSync(path.resolve(root, opts.baseDir, f), 'utf8')
        : null
      : showAtBase(root, opts.base ?? 'HEAD', f);
    if (baseText === null) {
      continue; // 새 스냅샷 파일 = 분류 안 함(IT-00 첫 생성 허용)
    }
    const curAbs = path.join(root, f);
    let kind;
    let pointers;
    if (!existsSync(curAbs)) {
      kind = 'destructive';
      pointers = ['/ (snapshot file deleted)'];
    } else {
      let b;
      let c;
      try {
        b = JSON.parse(baseText);
        c = JSON.parse(readFileSync(curAbs, 'utf8'));
      } catch (e) {
        throw new GateEngineError('engine/input-missing', `${f}: invalid JSON (${e.message})`);
      }
      const d = diffSchema(b, c);
      if (d.destructive.length > 0) {
        kind = 'destructive';
        pointers = d.destructive;
      } else if (d.additive.length > 0) {
        kind = 'additive';
        pointers = d.additive;
      }
    }
    if (kind === 'destructive' && !hasAdr) {
      add(
        f,
        'frozen/destructive-without-adr',
        `destructive contract change without \`ADR: ADR-<nnn>\` trailer: ${pointers.join('; ')}`,
      );
    } else if (kind === 'additive' && !hasTrailer) {
      add(
        f,
        'frozen/additive-without-cr',
        `additive contract change without \`CR: CR-<nn>\` trailer: ${pointers.join('; ')}`,
      );
    }
  }
  return { files: lock.files.length, violations, extra: { task: task ?? null } };
}

if (isMain(import.meta.url)) {
  await runGate(
    {
      id: 'check:frozen',
      requireUnits: false,
      spec: { options: ['lock', 'task', 'base', 'changed-from', 'message-file', 'base-dir', 'snapshots'] },
    },
    (o) => {
      const task = o.get('task');
      if (task !== undefined && !/^T-\d{2}-\d{2}(-r\d+)?$/.test(task)) {
        throw new GateEngineError('engine/usage', `--task must match ^T-\\d{2}-\\d{2}(-r\\d+)?$ (got ${task})`);
      }
      const abs = (name) => (o.get(name) ? path.resolve(o.get(name)) : undefined);
      return analyze(o.root, {
        lock: abs('lock'),
        task,
        base: o.get('base'),
        changedFrom: abs('changed-from'),
        messageFile: abs('message-file'),
        baseDir: abs('base-dir'),
        snapshots: o.get('snapshots'),
      });
    },
  );
}
