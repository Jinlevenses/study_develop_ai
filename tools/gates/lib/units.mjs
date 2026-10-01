import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GateEngineError } from './errors.mjs';
import { matchAny } from './glob.mjs';
import { readJsonc } from './jsonc.mjs';

const UNIT_RE = /^(apps|services|packages|tools)\/([^/]+)(?:\/|$)/;
const UNIT_NAME_RE = /^((apps|services|packages|tools)\/(\*|[a-z0-9-]+)|tests)$/;
const CONCRETE_UNIT_RE = /^((apps|services|packages|tools)\/[a-z0-9-]+|tests)$/;
const INTRA_KEYS = [
  'sqlite_direct',
  'bc',
  'grading_no_catalog',
  'domain_pure',
  'sk_pure',
  'builtin_restricted',
  'web_feature_cross',
];

/** root 기준 posix 상대 경로의 단위. 단위 밖이면 null. */
export function unitOf(rel) {
  const m = UNIT_RE.exec(rel);
  if (m) {
    return `${m[1]}/${m[2]}`;
  }
  if (rel === 'tests' || rel.startsWith('tests/')) {
    return 'tests';
  }
  if (rel === 'spikes' || rel.startsWith('spikes/')) {
    return 'spikes';
  }
  return null;
}

/** 기대 단위 존재 단언: `<root>/services/` 하위 디렉터리 ≥ 1 그리고 `<root>/packages/contracts/`. */
export function assertExpectedUnits(root) {
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch (e) {
    throw new GateEngineError('engine/no-root', `root not found: ${root} (${e.code ?? e.message})`);
  }
  if (!rootStat.isDirectory()) {
    throw new GateEngineError('engine/no-root', `root is not a directory: ${root}`);
  }
  let services = [];
  try {
    services = readdirSync(path.join(root, 'services'), { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    services = [];
  }
  let contracts = false;
  try {
    contracts = statSync(path.join(root, 'packages', 'contracts')).isDirectory();
  } catch {
    contracts = false;
  }
  if (services.length === 0 || !contracts) {
    throw new GateEngineError(
      'engine/missing-units',
      `expected units missing under ${root}: services/<name> (>=1) and packages/contracts/ (services=${services.length}, contracts=${contracts})`,
    );
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validate(cfg, where) {
  const bad = (msg) => {
    throw new GateEngineError('engine/config', `${where}: ${msg}`);
  };
  if (!isObject(cfg)) {
    bad('root must be an object');
  }
  if (cfg.version !== 1) {
    bad(`version must be 1 (got ${JSON.stringify(cfg.version)})`);
  }
  if (!Array.isArray(cfg.units) || cfg.units.length === 0) {
    bad('units must be a non-empty array');
  }
  for (const u of cfg.units) {
    if (!isObject(u) || typeof u.unit !== 'string' || !UNIT_NAME_RE.test(u.unit)) {
      bad(`invalid unit entry: ${JSON.stringify(u)}`);
    }
    if (!Array.isArray(u.allow) || u.allow.some((a) => typeof a !== 'string' || !CONCRETE_UNIT_RE.test(a))) {
      bad(`allow of ${u.unit} must list concrete unit names`);
    }
  }
  if (
    !isObject(cfg.test_only) ||
    typeof cfg.test_only.unit !== 'string' ||
    !Array.isArray(cfg.test_only.allowed_from)
  ) {
    bad('test_only must be {unit, allowed_from[]}');
  }
  if (!isObject(cfg.intra)) {
    bad('intra must be an object');
  }
  for (const k of INTRA_KEYS) {
    if (!(k in cfg.intra)) {
      bad(`intra.${k} missing`);
    }
  }
  return cfg;
}

/** 경계 설정 로드·검증. 기본 경로는 게이트 설치 위치 기준(--root와 무관). 부재·위반 → engine/config. */
export function loadBoundaries(configAbsPath) {
  const p = configAbsPath ?? fileURLToPath(new URL('../config/boundaries.json', import.meta.url));
  return validate(readJsonc(p), p);
}

/** 첫 매칭 units[] 항목(정확 일치 또는 `<group>/*` 와일드카드). */
export function unitRule(cfg, unit) {
  if (unit === null || unit === undefined) {
    return undefined;
  }
  return cfg.units.find((u) => u.unit === unit || (u.unit.endsWith('/*') && unit.startsWith(u.unit.slice(0, -1))));
}

/** from → to 단위 import 허용 여부. 자기 자신은 항상 허용, testkit은 test_only.allowed_from 경로에서만. */
export function isAllowed(cfg, fromUnit, toUnit, fromRel) {
  if (fromUnit === toUnit) {
    return true;
  }
  if (toUnit === cfg.test_only.unit) {
    return matchAny(fromRel, cfg.test_only.allowed_from);
  }
  const rule = unitRule(cfg, fromUnit);
  return rule ? rule.allow.includes(toUnit) : false;
}
