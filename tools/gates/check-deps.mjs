#!/usr/bin/env node
// check:deps (NFR-MAINT-001, AP-07·AP-08, STD-GATE-06, STD-TS-01, STD-DIR-34) — 의존 허용표(ARC-01 §18) 대조.
//   입력: root `package.json` + {apps,services,packages,tools}/*/package.json (+ tests/package.json). 설정: config/deps.json.
// 사용: node tools/gates/check-deps.mjs [--root <dir>] [--config <path>] [--json] [--quiet]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetUnit } from './check-boundaries.mjs';
import { srcFiles } from './check-security-scan.mjs';
import { isMain, readJsonc, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { matchAny } from './lib/glob.mjs';
import { extractImports } from './lib/imports.mjs';
import { isAllowed, loadBoundaries, unitOf } from './lib/units.mjs';

const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const UNIT_GROUPS = ['apps', 'services', 'packages', 'tools'];
const ROOT_UNIT = '(root)';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function defaultConfigPath() {
  return fileURLToPath(new URL('./config/deps.json', import.meta.url));
}

/** deps.json 로드·검증. 부재·파싱 실패·version !== 1·필수 키 누락 → engine/config(exit 2). */
export function loadDepsConfig(configPath) {
  const p = configPath ?? defaultConfigPath();
  const cfg = readJsonc(p);
  const bad = (msg) => {
    throw new GateEngineError('engine/config', `${p}: ${msg}`);
  };
  if (!isObject(cfg)) {
    bad('root must be an object');
  }
  if (cfg.version !== 1) {
    bad(`version must be 1 (got ${JSON.stringify(cfg.version)})`);
  }
  if (!Array.isArray(cfg.packages) || cfg.packages.length === 0) {
    bad('packages must be a non-empty array');
  }
  for (const k of ['dev_only', 'forbidden', 'forbidden_patterns']) {
    if (!Array.isArray(cfg[k])) {
      bad(`${k} must be an array`);
    }
  }
  for (const pk of cfg.packages) {
    if (
      !isObject(pk) ||
      typeof pk.name !== 'string' ||
      typeof pk.version !== 'string' ||
      !Array.isArray(pk.units) ||
      pk.units.length === 0 ||
      (pk.import_paths !== undefined && !Array.isArray(pk.import_paths))
    ) {
      bad(`invalid packages entry: ${JSON.stringify(pk)}`);
    }
  }
  for (const f of cfg.forbidden) {
    if (!isObject(f) || typeof f.name !== 'string') {
      bad(`invalid forbidden entry: ${JSON.stringify(f)}`);
    }
  }
  let patterns;
  try {
    patterns = cfg.forbidden_patterns.map((s) => new RegExp(s));
  } catch (e) {
    return bad(`invalid forbidden_patterns: ${e.message}`);
  }
  return {
    ...cfg,
    byName: new Map(cfg.packages.map((pk) => [pk.name, pk])),
    forbiddenNames: new Map(cfg.forbidden.map((f) => [f.name, f.reason ?? ''])),
    patterns,
    devOnly: new Set(cfg.dev_only),
  };
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** root 기준 package.json 목록: [{rel, unit}] (root = '(root)'). */
function packageFiles(root) {
  const out = [];
  if (existsSync(path.join(root, 'package.json'))) {
    out.push({ rel: 'package.json', unit: ROOT_UNIT });
  }
  for (const g of UNIT_GROUPS) {
    const dir = path.join(root, g);
    if (!isDir(dir)) {
      continue;
    }
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (ent.isDirectory() && existsSync(path.join(dir, ent.name, 'package.json'))) {
        out.push({ rel: `${g}/${ent.name}/package.json`, unit: `${g}/${ent.name}` });
      }
    }
  }
  if (existsSync(path.join(root, 'tests', 'package.json'))) {
    out.push({ rel: 'tests/package.json', unit: 'tests' });
  }
  return out;
}

function unitListed(units, unit) {
  return units.some((u) => u === '*' || u === unit || (u.endsWith('/*') && unit.startsWith(u.slice(0, -1))));
}

function isRangeSpec(spec) {
  return /[\^~><*|\s]/.test(spec) || /(^|\.)[xX](\.|$)/.test(spec) || /^[A-Za-z][A-Za-z-]*$/.test(spec);
}

/** 의존 이름이 처음 나오는 줄(해당 섹션 안). 못 찾으면 1. */
function lineOfDep(lines, section, name) {
  let inSection = false;
  const key = `"${name}"`;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const sec = /^\s*"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:/.exec(l);
    if (sec) {
      inSection = sec[1] === section;
    }
    if (inSection && l.includes(key) && /"\s*:/.test(l.slice(l.indexOf(key)))) {
      return i + 1;
    }
  }
  const any = lines.findIndex((l) => l.includes(key));
  return any >= 0 ? any + 1 : 1;
}

/** 워크스페이스(@fathom/*) 의존 판정. */
function checkWorkspace({ add, bnd, section, name, spec, unit }) {
  if (spec !== 'workspace:*') {
    add(section, name, 'deps/workspace-spec', `${name} must use "workspace:*" (found "${spec}")`);
  }
  if (name === '@fathom/testkit') {
    if (section !== 'devDependencies') {
      add(section, name, 'deps/testkit-runtime', '@fathom/testkit may only be a devDependency (STD-DIR-34)');
    }
    return;
  }
  if (unit === ROOT_UNIT || unitOf(`${unit}/x`) === null) {
    return;
  }
  const tgt = targetUnit(name, `${unit}/x`);
  if (tgt && tgt !== 'builtin' && tgt !== 'external' && !isAllowed(bnd, unit, tgt, `${unit}/package.json`)) {
    add(section, name, 'deps/workspace-unit', `${unit} may not depend on ${tgt} (boundaries.json)`);
  }
}

export function analyze(root, opts = {}) {
  const cfg = loadDepsConfig(opts.config);
  const bnd = loadBoundaries();
  const pkgs = packageFiles(root);
  if (pkgs.length === 0) {
    throw new GateEngineError('engine/input-missing', `no package.json found under ${root}`);
  }
  const violations = [];
  for (const { rel, unit } of pkgs) {
    const text = readFileSync(path.join(root, rel), 'utf8');
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new GateEngineError('engine/input-missing', `${rel}: invalid JSON (${e.message})`);
    }
    const lines = text.split('\n');
    const add = (section, name, rule, message) =>
      violations.push({ file: rel, line: lineOfDep(lines, section, name), rule, message, severity: 'error' });
    for (const section of SECTIONS) {
      const deps = json[section];
      if (!isObject(deps)) {
        continue;
      }
      for (const [name, specRaw] of Object.entries(deps)) {
        const spec = String(specRaw);
        // forbidden
        const reason = cfg.forbiddenNames.get(name);
        if (
          reason !== undefined ||
          cfg.patterns.some((re) => re.test(name)) ||
          spec.includes('@typescript/typescript6')
        ) {
          add(section, name, 'deps/forbidden', `${name}@${spec} is forbidden${reason ? ` (${reason})` : ''}`);
          continue;
        }
        if (name.startsWith('@fathom/')) {
          checkWorkspace({ add, bnd, section, name, spec, unit });
          continue;
        }
        const pk = cfg.byName.get(name);
        if (!pk) {
          add(section, name, 'deps/not-allowed', `${name} is not in the dependency allow-list (ARC-01 §18)`);
          continue;
        }
        if (name === 'typescript' && unit !== ROOT_UNIT) {
          add(section, name, 'deps/typescript-local', 'typescript must be installed at the repo root only (STD-TS-01)');
        } else if (!unitListed(pk.units, unit)) {
          add(
            section,
            name,
            'deps/unit-not-allowed',
            `${name} is not allowed in ${unit} (allowed: ${pk.units.join(', ')})`,
          );
        }
        if (spec !== pk.version) {
          add(section, name, 'deps/version-mismatch', `${name} is pinned to ${pk.version}, found "${spec}"`);
        }
        if (isRangeSpec(spec)) {
          add(section, name, 'deps/range-spec', `${name} spec "${spec}" is a range/tag; pin the exact version`);
        }
        if (section === 'dependencies' && cfg.devOnly.has(name) && unit !== 'packages/testkit') {
          add(section, name, 'deps/dev-only-runtime', `${name} is dev-only but listed in dependencies`);
        }
      }
    }
  }
  // import_paths: 특정 SDK는 지정 glob 안에서만 import
  const located = cfg.packages.filter((pk) => Array.isArray(pk.import_paths));
  if (located.length > 0) {
    for (const f of srcFiles(root)) {
      let imports;
      try {
        imports = extractImports(readFileSync(path.join(root, f), 'utf8'));
      } catch {
        continue;
      }
      for (const imp of imports) {
        if (typeof imp.spec !== 'string') {
          continue;
        }
        for (const pk of located) {
          if ((imp.spec === pk.name || imp.spec.startsWith(`${pk.name}/`)) && !matchAny(f, pk.import_paths)) {
            violations.push({
              file: f,
              line: imp.line,
              rule: 'deps/import-location',
              message: `${pk.name} may only be imported from ${pk.import_paths.join(', ')}`,
              severity: 'error',
            });
          }
        }
      }
    }
  }
  return { files: pkgs.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:deps', requireUnits: true, spec: { options: ['config'] } }, (o) =>
    analyze(o.root, { config: o.get('config') ? path.resolve(o.get('config')) : undefined }),
  );
}
