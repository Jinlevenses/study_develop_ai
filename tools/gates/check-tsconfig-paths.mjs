#!/usr/bin/env node
// check:tsconfig-paths (NFR-MAINT-001, STD-TS-01~03, STD-NAM-01~05) — tsconfig `paths`·`baseUrl` 금지, 루트 include, 패키지 이름 형식.
//   입력: root·단위({apps,services,packages,tools}/*, tests)의 tsconfig*.json(JSONC) + 단위 package.json.
// 사용: node tools/gates/check-tsconfig-paths.mjs [--root <dir>] [--json] [--quiet]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isMain, readJsonc, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';

const UNIT_GROUPS = ['apps', 'services', 'packages', 'tools'];
const NAME_PREFIX = { apps: '@fathom/app-', services: '@fathom/svc-', packages: '@fathom/', tools: '@fathom/tool-' };
const REQUIRED_INCLUDE = ['apps/*/src', 'services/*/src', 'packages/*/src'];
const TSCONFIG_RE = /^tsconfig(\..+)?\.json$/;

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 단위 디렉터리 목록(root 포함): [{dir(rel, ''=root), group|null, name|null}]. */
function unitDirs(root) {
  const out = [{ dir: '', group: null, name: null }];
  for (const g of UNIT_GROUPS) {
    const base = path.join(root, g);
    if (!isDir(base)) {
      continue;
    }
    for (const ent of readdirSync(base, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (ent.isDirectory()) {
        out.push({ dir: `${g}/${ent.name}`, group: g, name: ent.name });
      }
    }
  }
  if (isDir(path.join(root, 'tests'))) {
    out.push({ dir: 'tests', group: null, name: null });
  }
  return out;
}

function lineOfKey(lines, key) {
  const re = new RegExp(`"${key}"\\s*:`);
  const i = lines.findIndex((l) => re.test(l));
  return i >= 0 ? i + 1 : 1;
}

export async function analyze(root) {
  const violations = [];
  const add = (file, line, rule, message) => violations.push({ file, line, rule, message, severity: 'error' });
  let tsconfigs = 0;
  let rootTsconfigSeen = false;
  for (const u of unitDirs(root)) {
    const abs = path.join(root, u.dir);
    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile() && TSCONFIG_RE.test(e.name))
      .map((e) => e.name)
      .sort();
    for (const name of entries) {
      tsconfigs++;
      const rel = u.dir ? `${u.dir}/${name}` : name;
      const text = readFileSync(path.join(abs, name), 'utf8');
      const cfg = readJsonc(path.join(abs, name));
      const lines = text.split('\n');
      const co = isObject(cfg) && isObject(cfg.compilerOptions) ? cfg.compilerOptions : {};
      if ('paths' in co) {
        add(rel, lineOfKey(lines, 'paths'), 'tsconfig/paths', 'compilerOptions.paths is forbidden; use package exports (STD-TS-03)');
      }
      if ('baseUrl' in co) {
        add(rel, lineOfKey(lines, 'baseUrl'), 'tsconfig/base-url', 'compilerOptions.baseUrl is forbidden (STD-TS-03)');
      }
      if (u.dir === '' && name === 'tsconfig.json') {
        rootTsconfigSeen = true;
        const include = isObject(cfg) && Array.isArray(cfg.include) ? cfg.include.map(String) : [];
        const missing = REQUIRED_INCLUDE.filter((r) => !include.some((i) => i === r || i.startsWith(`${r}/`)));
        if (missing.length > 0) {
          add('tsconfig.json', 1, 'tsconfig/root-include', `root include lacks: ${missing.join(', ')} (STD-TS-02)`);
        }
      }
    }
    if (u.group !== null) {
      const pkgPath = path.join(abs, 'package.json');
      if (existsSync(pkgPath)) {
        const text = readFileSync(pkgPath, 'utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new GateEngineError('engine/input-missing', `${u.dir}/package.json: invalid JSON (${e.message})`);
        }
        const expected = `${NAME_PREFIX[u.group]}${u.name}`;
        if (json.name !== expected) {
          add(
            `${u.dir}/package.json`,
            lineOfKey(text.split('\n'), 'name'),
            'tsconfig/package-name',
            `package name must be "${expected}" (found ${JSON.stringify(json.name)}) (STD-NAM-01~05)`,
          );
        }
      }
    }
  }
  if (tsconfigs === 0) {
    throw new GateEngineError('engine/input-missing', `no tsconfig*.json found under ${root}`);
  }
  if (!rootTsconfigSeen) {
    add('tsconfig.json', 1, 'tsconfig/root-include', 'root tsconfig.json is missing (STD-TS-02)');
  }
  return { files: tsconfigs, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:tsconfig-paths', requireUnits: true, spec: {} }, (o) => analyze(o.root));
}
