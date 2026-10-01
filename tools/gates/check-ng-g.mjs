#!/usr/bin/env node
// ported-from: spikes/sp7-static-gates/src/check-ng-g.mjs (audit-fixed: 예외·0파일 → exit 2(runGate), 어휘·정규식 전부 config/ng-g.json, 규칙 ID를 DS-01 §13 이름으로(pre-submit-fields·due-danger·blank-note-ai), G7 정책 파일 고정 경로, ng-g3/web-renderer-reveal 가산(CR-60), 어휘 가산(DS-01 §13), push-api 허용 경로)
// check:ng-g (FR-UX-008, NFR-UX-008, CR-23) — NG-G1~G7 자동화 가능 부분 + 디자인 raw color.
//   NG-G1 보상 메커닉        → ng-g1/reward-vocab                      NG-G2 비교·공유 → ng-g2/social-vocab · ng-g2/network-share
//   NG-G3 제출 전 정답 금지  → ng-g3/pre-submit-fields · ng-g3/web-renderer-reveal
//   NG-G4 강제 잠금 금지     → ng-g4/hard-lock · ng-g4/prereq-redirect
//   NG-G5 연체 위험색·푸시   → ng-g5/due-danger · ng-g5/push-api · ng-g5/loss-copy
//   NG-G6 강의 영상 금지     → ng-g6/video                             NG-G7 제출 전 AI 생성 금지 → ng-g7/blank-note-ai · policy-missing-deny · policy-file-missing
//   디자인                   → design/raw-color (packages/design-tokens/** 밖의 hex·rgb()·hsl()·oklch())
// 이월(WP-02-00): design/tailwind-palette · glass-allowlist · motion-duration · syntax-scope · spacing-scale · ng-g1/celebration-single-use
// 사용: node tools/gates/check-ng-g.mjs [--root <dir>] [--config <path>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, readJsonc, runGate, SRC_EXT, snake } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { matchAny, matchGlob } from './lib/glob.mjs';
import { extractImports } from './lib/imports.mjs';
import { deepTokens, maskComments, matchClose, stringPieces, tokenize } from './lib/lex.mjs';
import { walk } from './lib/walk.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const REGEX_KEYS = [
  'routing_path',
  'pre_submit_path',
  'blank_note_path',
  'post_submit_path',
  'contracts_path',
  'reveal_ident',
  'reward_words',
  'social_words',
  'lock_words',
  'ai_call_ident',
  'ai_import',
  'push_import',
  'due_words',
  'danger_words',
  'loss_copy',
  'reward_copy',
  'social_copy',
  'video_tag',
  'video_text',
  'video_word',
  'color_fn',
  'hex_long',
  'hex_short',
  'hex_short_whole',
  'color_key',
  'class_fns',
];

/** config/ng-g.json 로드·검증·정규식 컴파일. 부재·파싱 실패·version !== 1·필수 키 누락 → engine/config(exit 2). */
export function loadNgConfig(configPath) {
  const p = configPath ?? fileURLToPath(new URL('./config/ng-g.json', import.meta.url));
  const raw = readJsonc(p);
  const bad = (msg) => {
    throw new GateEngineError('engine/config', `${p}: ${msg}`);
  };
  if (!isObject(raw)) {
    bad('root must be an object');
  }
  if (raw.version !== 1) {
    bad(`version must be 1 (got ${JSON.stringify(raw.version)})`);
  }
  const cfg = { ...raw };
  const compile = (key, v) => {
    if (!isObject(v) || typeof v.source !== 'string') {
      bad(`${key} must be {source, flags?}`);
    }
    try {
      return new RegExp(v.source, v.flags ?? '');
    } catch (e) {
      return bad(`${key}: invalid regex (${e.message})`);
    }
  };
  for (const k of REGEX_KEYS) {
    cfg[k] = compile(k, raw[k]);
  }
  if (!Array.isArray(raw.token_dirs) || raw.token_dirs.length === 0) {
    bad('token_dirs must be a non-empty array of {source, flags?}');
  }
  cfg.token_dirs = raw.token_dirs.map((v, i) => compile(`token_dirs[${i}]`, v));
  if (!Array.isArray(raw.banned_pre_submit_keys)) {
    bad('banned_pre_submit_keys must be an array');
  }
  cfg.banned_pre_submit_keys = new Set(raw.banned_pre_submit_keys);
  if (!Array.isArray(raw.push_allow_paths)) {
    bad('push_allow_paths must be an array');
  }
  if (!isObject(raw.deps)) {
    bad('deps must be an object');
  }
  for (const k of ['network_share', 'push_api', 'policy', 'g3_web']) {
    if (!isObject(raw[k])) {
      bad(`${k} must be an object`);
    }
  }
  const pol = raw.policy;
  if (typeof pol.file !== 'string' || typeof pol.deny_key !== 'string') {
    bad('policy must be {file, deny_key, required_prefix}');
  }
  cfg.policy = { ...pol, required_prefix: compile('policy.required_prefix', pol.required_prefix) };
  const g3 = raw.g3_web;
  if (![g3.scope, g3.exclude, g3.forbid_import].every((a) => Array.isArray(a))) {
    bad('g3_web must be {scope[], exclude[], forbid_import[]}');
  }
  return cfg;
}

const V = (file, line, rule, message, severity = 'error') => ({ file, line, rule, message, severity });

// ---------------- source (ts/tsx/js) ----------------
export function checkSource(rel, src, cfg) {
  const v = [];
  const { tokens, comments, lineOf } = tokenize(src);
  const masked = maskComments(src, comments);
  const all = [...deepTokens(tokens)];
  const inTokens = cfg.token_dirs.some((r) => r.test(rel));
  const isContracts = cfg.contracts_path.test(rel);
  const pushAllowed = matchAny(rel, cfg.push_allow_paths);
  const push = (line, rule, message) => {
    if (rule === 'ng-g5/push-api' && pushAllowed) {
      return;
    }
    v.push(V(rel, line, rule, message));
  };
  const share = cfg.network_share;
  const papi = cfg.push_api;

  // NG-G1 / NG-G2 식별자 어휘
  for (const t of all) {
    if (t.t !== 'id') {
      continue;
    }
    const w = snake(t.v);
    if (cfg.reward_words.test(w)) {
      push(t.line, 'ng-g1/reward-vocab', `identifier "${t.v}" implements a reward mechanic (NG-G1)`);
    }
    if (cfg.social_words.test(w)) {
      push(t.line, 'ng-g2/social-vocab', `identifier "${t.v}" implies social comparison`);
    }
  }
  // 한국어 UI 카피(JSX 텍스트 포함: 주석 마스킹한 원문 기준)
  masked.split('\n').forEach((l, i) => {
    if (cfg.reward_copy.test(l)) {
      push(i + 1, 'ng-g1/reward-vocab', 'reward vocabulary in UI copy');
    }
    if (cfg.social_copy.test(l)) {
      push(i + 1, 'ng-g2/social-vocab', 'social-comparison vocabulary in UI copy');
    }
    if (cfg.loss_copy.test(l)) {
      push(i + 1, 'ng-g5/loss-copy', 'loss/overdue-fear vocabulary in UI copy');
    }
    if (cfg.video_tag.test(l) || cfg.video_text.test(l)) {
      push(i + 1, 'ng-g6/video', 'video content element/embed');
    }
  });
  for (let i = 0; i < all.length - 2; i++) {
    const t = all[i];
    if (t.t === 'id' && t.v === share.object && all[i + 1].v === '.' && all[i + 2].v === share.member) {
      push(t.line, 'ng-g2/network-share', `${share.object}.${share.member}(): no network sharing (NG-G2)`);
    }
    if (t.t === 'id' && t.v === papi.object && all[i + 1].v === '.' && all[i + 2].v === papi.member) {
      push(t.line, 'ng-g5/push-api', `${papi.object}.${papi.member}(): push/notification API unused (NG-G5)`);
    }
    if (t.t === 'id' && t.v === papi.ctor && all[i - 1]?.v === 'new' && all[i + 1].v === '(') {
      push(t.line, 'ng-g5/push-api', `new ${papi.ctor}(): push/notification API unused (NG-G5)`);
    }
    if (t.t === 'id' && papi.identifiers.includes(t.v)) {
      push(t.line, 'ng-g5/push-api', `${t.v}: push API unused (NG-G5)`);
    }
  }
  // import: push 라이브러리, blank-note의 AI
  const imports = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].t === 'id' && tokens[i].v === 'from' && tokens[i + 1].t === 'str' && tokens[i - 1]?.v !== '.') {
      imports.push(tokens[i + 1]);
    }
  }
  for (const s of imports) {
    if (cfg.push_import.test(s.v)) {
      push(s.line, 'ng-g5/push-api', `import of push library "${s.v}"`);
    }
    if (cfg.reward_words.test(snake(s.v.replace(/[@/.]/g, '_')))) {
      push(s.line, 'ng-g1/reward-vocab', `import of reward library "${s.v}"`);
    }
  }

  // 디자인: 원색 리터럴
  if (!inTokens) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.t !== 'str' && t.t !== 'tpl') {
        continue;
      }
      const pieces = t.t === 'str' ? [t.v] : t.quasis.map((q) => q.v);
      const key = tokens[i - 1]?.v === ':' ? tokens[i - 2] : null;
      const colorCtx = key && (key.t === 'id' || key.t === 'str') && cfg.color_key.test(key.v);
      for (const p of pieces) {
        if (cfg.hex_long.test(p) || cfg.color_fn.test(p) || (colorCtx && cfg.hex_short_whole.test(p.trim()))) {
          v.push(
            V(
              rel,
              t.line,
              'design/raw-color',
              `raw colour literal "${p.slice(0, 30)}": use a design token (var(--color-*))`,
            ),
          );
          break;
        }
      }
    }
  }

  // NG-G5: 연체·스트릭에 위험색(className 속성, cn()/clsx() 인자, 단독 문자열)
  const dueDanger = (texts, line) => {
    const j = texts.join(' ');
    if (cfg.due_words.test(j) && cfg.danger_words.test(j)) {
      v.push(V(rel, line, 'ng-g5/due-danger', 'danger colour combined with due/overdue/streak styling (NG-G5)'));
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'id' && t.v === 'className' && tokens[i + 1]?.v === '=') {
      const n = tokens[i + 2];
      if (n?.t === 'str') {
        dueDanger([n.v], n.line);
      } else if (n?.v === '{') {
        const c = matchClose(tokens, i + 2);
        dueDanger(
          [...stringPieces(tokens.slice(i + 3, c), lineOf)].map((p) => p.text),
          t.line,
        );
      }
    } else if (t.t === 'id' && cfg.class_fns.test(t.v) && tokens[i + 1]?.v === '(') {
      const c = matchClose(tokens, i + 1);
      dueDanger(
        [...stringPieces(tokens.slice(i + 2, c), lineOf)].map((p) => p.text),
        t.line,
      );
    } else if (t.t === 'str' && !(tokens[i - 1]?.v === '=' && tokens[i - 2]?.v === 'className')) {
      if (tokens[i - 1]?.v === '(' && cfg.class_fns.test(tokens[i - 2]?.v ?? '')) {
        continue;
      }
      dueDanger([t.v], t.line);
    }
  }

  // NG-G3: 제출 전 스키마
  const scopeRanges = [];
  if (cfg.pre_submit_path.test(rel)) {
    scopeRanges.push({ name: '(file)', from: 0, to: tokens.length });
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    const t = tokens[i];
    if (
      t.t === 'id' &&
      ['const', 'interface', 'type', 'class'].includes(t.v) &&
      tokens[i + 1]?.t === 'id' &&
      /pre_?submit/.test(snake(tokens[i + 1].v))
    ) {
      let d = 0;
      let j = i + 2;
      let opened = false;
      const isIface = t.v === 'interface';
      for (; j < tokens.length; j++) {
        const x = tokens[j];
        if (x.t === 'p' && '([{'.includes(x.v)) {
          d++;
          if (x.v === '{') {
            opened = true;
          }
        } else if (x.t === 'p' && ')]}'.includes(x.v)) {
          d--;
          if (isIface && opened && d === 0) {
            j++;
            break;
          }
        } else if (d === 0 && x.t === 'p' && x.v === ';') {
          j++;
          break;
        } else if (
          d === 0 &&
          j > i + 2 &&
          x.t === 'id' &&
          ['export', 'const', 'interface', 'type', 'function', 'import'].includes(x.v) &&
          x.line > tokens[j - 1].line
        ) {
          break;
        }
      }
      scopeRanges.push({ name: tokens[i + 1].v, from: i, to: j });
    }
  }
  for (const r of scopeRanges) {
    for (let k = r.from; k < r.to - 1; k++) {
      const x = tokens[k];
      if (
        (x.t === 'id' || x.t === 'str') &&
        cfg.banned_pre_submit_keys.has(x.v) &&
        (tokens[k + 1].v === ':' || (tokens[k + 1].v === '?' && tokens[k + 2]?.v === ':')) &&
        ['{', ',', ';'].includes(tokens[k - 1]?.v ?? '{')
      ) {
        v.push(
          V(
            rel,
            x.line,
            'ng-g3/pre-submit-fields',
            `pre-submit schema "${r.name}" declares "${x.v}" (answer/explanation only after submission)`,
          ),
        );
      }
      if (x.t === 'id' && cfg.reveal_ident.test(x.v) && x.v !== r.name && tokens[k - 1]?.v !== '.') {
        v.push(
          V(
            rel,
            x.line,
            'ng-g3/pre-submit-fields',
            `pre-submit schema "${r.name}" derives from post-submit shape "${x.v}"`,
          ),
        );
      }
    }
  }
  // NG-G3 web(CR-60): renderers 안의 pre-submit 코드가 post-submit 계약을 import
  const g3 = cfg.g3_web;
  if (matchAny(rel, g3.scope) && !matchAny(rel, g3.exclude)) {
    for (const imp of extractImports(src)) {
      if (typeof imp.spec === 'string' && g3.forbid_import.some((g) => matchGlob(imp.spec, g))) {
        v.push(
          V(
            rel,
            imp.line,
            'ng-g3/web-renderer-reveal',
            `renderer outside post-submit/ imports the reveal contract "${imp.spec}" (NG-G3)`,
          ),
        );
      }
    }
  }

  // NG-G4 라우팅
  if (cfg.routing_path.test(rel)) {
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      if (t.t !== 'id') {
        continue;
      }
      if (cfg.lock_words.test(snake(t.v))) {
        v.push(
          V(rel, t.line, 'ng-g4/hard-lock', `routing code contains lock semantics "${t.v}" (soft gate only, NG-G4)`),
        );
      }
      if (t.v === 'redirect' && all[i + 1]?.v === '(') {
        let hit = false;
        for (let k = i - 1; k >= Math.max(0, i - 25); k--) {
          if (all[k].v === ';' || all[k].v === '}') {
            break;
          }
          if (all[k].t === 'id' && /prereq/i.test(all[k].v)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          v.push(
            V(rel, t.line, 'ng-g4/prereq-redirect', 'redirect() conditioned on prerequisites = forced lock (NG-G4)'),
          );
        }
      }
    }
  }

  // NG-G6: contracts의 video 어휘
  if (isContracts) {
    for (const t of all) {
      if (
        (t.t === 'id' || t.t === 'str') &&
        cfg.video_word.test(snake(t.t === 'str' ? t.v.replace(/[^\w]/g, '_') : t.v))
      ) {
        v.push(
          V(rel, t.line, 'ng-g6/video', `contracts mention "${t.v}": content schema has no video body type (NG-G6)`),
        );
      }
    }
  }

  // NG-G7: blank-note 제출 전 경로
  if (cfg.blank_note_path.test(rel) && !cfg.post_submit_path.test(rel)) {
    for (const s of imports) {
      if (cfg.ai_import.test(s.v)) {
        v.push(
          V(
            rel,
            s.line,
            'ng-g7/blank-note-ai',
            `blank-note pre-submit code imports AI gateway client "${s.v}" (NG-G7)`,
          ),
        );
      }
    }
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      if (t.t !== 'id') {
        continue;
      }
      if (cfg.ai_call_ident.test(t.v) || (t.v === 'generate' && all[i + 1]?.v === '(')) {
        v.push(
          V(
            rel,
            t.line,
            'ng-g7/blank-note-ai',
            `blank-note pre-submit code calls/defines AI generation "${t.v}" (NG-G7)`,
          ),
        );
      }
    }
  }
  return v;
}

// ---------------- css ----------------
export function checkCss(rel, src, cfg) {
  const v = [];
  const masked = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lineAt = (pos) => masked.slice(0, pos).split('\n').length;
  const inTokens = cfg.token_dirs.some((r) => r.test(rel));
  for (const m of masked.matchAll(/-{0,2}[A-Za-z_][\w-]*/g)) {
    const w = m[0].replace(/^-+/, '').replace(/-/g, '_').toLowerCase();
    if (cfg.reward_words.test(w)) {
      v.push(V(rel, lineAt(m.index), 'ng-g1/reward-vocab', `CSS name "${m[0]}" is a reward animation/token`));
    }
    if (cfg.social_words.test(w)) {
      v.push(V(rel, lineAt(m.index), 'ng-g2/social-vocab', `CSS name "${m[0]}" implies social comparison`));
    }
  }
  for (const m of masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const body = m[2];
    const bodyStart = m.index + m[0].indexOf('{') + 1;
    if (!inTokens) {
      for (const d of body.matchAll(/([\w-]+)\s*:\s*([^;]+)(;|$)/g)) {
        if (cfg.hex_long.test(d[2]) || cfg.hex_short.test(d[2]) || cfg.color_fn.test(d[2])) {
          v.push(
            V(
              rel,
              lineAt(bodyStart + d.index),
              'design/raw-color',
              `raw colour "${d[2].trim().slice(0, 30)}" in ${d[1]}: use a design token`,
            ),
          );
        }
      }
    }
    if (cfg.due_words.test(selector) && cfg.danger_words.test(body)) {
      v.push(
        V(
          rel,
          lineAt(m.index + m[0].search(/\S/)),
          'ng-g5/due-danger',
          `CSS rule "${selector.slice(0, 30)}" paints due/overdue/streak with a danger colour (NG-G5)`,
        ),
      );
    }
  }
  return v;
}

// ---------------- package.json ----------------
export function checkPackageJson(rel, text, cfg) {
  const v = [];
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return v;
  }
  const deps = { ...json.dependencies, ...json.devDependencies };
  const lines = text.split('\n');
  for (const [rule, names] of Object.entries(cfg.deps)) {
    for (const n of names) {
      if (n in deps) {
        const line = lines.findIndex((l) => l.includes(`"${n}"`)) + 1;
        v.push(V(rel, line, rule, `dependency "${n}" contradicts NG-G (${rule})`));
      }
    }
  }
  return v;
}

// ---------------- 저장소 단위: ai-gateway 정책(NG-G7 양성 단언, 고정 경로) ----------------
export function checkPolicy(root, cfg) {
  const v = [];
  const pol = cfg.policy;
  let text;
  try {
    text = readFileSync(path.join(root, pol.file), 'utf8');
  } catch {
    return [
      V(
        '(repo)',
        0,
        'ng-g7/policy-file-missing',
        `${pol.file} not found: the gateway must deny blank-note generation before submit`,
      ),
    ];
  }
  const { tokens } = tokenize(text);
  const k = tokens.findIndex(
    (t, idx) => (t.t === 'id' || t.t === 'str') && t.v === pol.deny_key && tokens[idx + 1]?.v === ':',
  );
  if (k < 0) {
    return [V(pol.file, 1, 'ng-g7/policy-missing-deny', `policy has no ${pol.deny_key} list`)];
  }
  const open = k + 2;
  if (tokens[open]?.v !== '[') {
    return [V(pol.file, tokens[k].line, 'ng-g7/policy-missing-deny', `${pol.deny_key} must be an array literal`)];
  }
  const close = matchClose(tokens, open);
  const denied = tokens
    .slice(open, close)
    .filter((t) => t.t === 'str')
    .map((t) => t.v);
  if (!denied.some((s) => pol.required_prefix.test(s))) {
    v.push(
      V(
        pol.file,
        tokens[k].line,
        'ng-g7/policy-missing-deny',
        `${pol.deny_key} lacks a blank_note.* generation task (has: ${denied.join(', ') || 'none'})`,
      ),
    );
  }
  return v;
}

export function analyze(root, opts = {}) {
  const cfg = loadNgConfig(opts.config);
  const inc = ['apps/*/src/**', 'services/*/src/**', 'packages/*/src/**'];
  const sources = walk(root, { exts: [...SRC_EXT, '.css'], include: inc });
  const pkgs = walk(root, {
    exts: ['.json'],
    include: ['apps/*/package.json', 'services/*/package.json', 'packages/*/package.json'],
  });
  const violations = [];
  for (const f of sources) {
    const text = readFileSync(path.join(root, f), 'utf8');
    violations.push(...(f.endsWith('.css') ? checkCss(f, text, cfg) : checkSource(f, text, cfg)));
  }
  for (const f of pkgs) {
    violations.push(...checkPackageJson(f, readFileSync(path.join(root, f), 'utf8'), cfg));
  }
  violations.push(...checkPolicy(root, cfg));
  return { files: sources.length + pkgs.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:ng-g', requireUnits: true, spec: { options: ['config'] } }, (o) =>
    analyze(o.root, { config: o.get('config') ? path.resolve(o.get('config')) : undefined }),
  );
}
