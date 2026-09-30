#!/usr/bin/env node
// check:ng-g  -- automatable subset of NG-G1..G7 (03-convergence.md §, FR-UX-008, FR-QST-022, FR-STD-018, FR-QST-026) + design lint
//   NG-G1 XP/coin/level-up fireworks  -> ng-g1/reward-vocab   (identifiers, CSS names, dependencies, Korean copy)
//   NG-G2 leaderboard / social compare -> ng-g2/social-vocab, ng-g2/network-share
//   NG-G3 answer only after submit     -> ng-g3/presubmit-field, ng-g3/presubmit-spread   (pre-submit schemas must not carry answer_key/explanation/...)
//   NG-G4 no forced prerequisite lock  -> ng-g4/hard-lock, ng-g4/prereq-redirect         (routing code)
//   NG-G5 no red overdue / push        -> ng-g5/danger-due, ng-g5/push-api, ng-g5/loss-copy
//   NG-G6 no lecture-video content     -> ng-g6/video
//   NG-G7 no AI generation pre-submit  -> ng-g7/presubmit-ai-call, ng-g7/policy-missing-deny, ng-g7/policy-file-missing
//   design lint                        -> design/raw-color (hex/rgb()/hsl()/oklch() outside packages/design-tokens)
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, walk, read, SRC_EXT, finish, snake } from "./lib/common.mjs";
import { tokenize, maskComments, stringPieces, deepTokens, callArgs, matchClose } from "./lib/lex.mjs";

export const CFG = {
  tokenDirs: [/^packages\/design-tokens\//],           // raw colours allowed here only
  routingPath: /(^|\/)(routing|router|routes)\/|\.route\.[a-z]+$/,
  preSubmitPath: /(^|\/)(pre-submit|presubmit)\//,
  blankNotePath: /(^|\/)blank-note\//,
  postSubmitPath: /(^|\/)post-submit\//,
  contractsPath: /^packages\/contracts\//,
  bannedPreSubmitKeys: new Set(["answer_key", "answerKey", "explanation", "correct_option", "correct_options", "correct_answer", "correctAnswer", "is_correct", "isCorrect", "model_answer", "modelAnswer", "exemplar_note", "exemplarNote", "rubric_answer", "solution"]),
  revealIdent: /(PostSubmit|Reveal(ed)?|AnswerKey)/,
  rewardWords: /(^|_)(confetti|fireworks?|coins?|xp|sparkles?|loot)(_|$)/,
  socialWords: /(^|_)(leaderboards?|scoreboard|friends?|followers?|other_users?|peer_rank\w*|rank_among|social_share|global_rank)(_|$)/,
  lockWords: /(^|_)(locked|is_locked|lock|unlock|hard_gate|force_lock|blocked_until)(_|$)/,
  aiCallIdent: /^(auto_?write\w*|autocomplete\w*|ai_?assist\w*|suggest_?(note|text)\w*|generate_?(note|text|summary)\w*|complete_?note\w*|draft_?with_?ai\w*)$/i,
  aiImport: /(ai-gateway|anthropic|openai|typesafe-ai|llm-provider)/i,
  pushImport: /^(web-push|node-notifier|firebase\/messaging|onesignal|@novu\/)/,
  deps: {
    "ng-g1/reward-vocab": ["canvas-confetti", "react-confetti", "js-confetti", "party-js", "react-rewards"],
    "ng-g5/push-api": ["web-push", "node-notifier", "onesignal-node", "react-onesignal"],
    "ng-g6/video": ["react-player", "video.js", "hls.js", "plyr", "video-react"],
    "ng-g2/social-vocab": ["react-share"],
  },
  dueWords: /\b(due|overdue|streak|backlog|missed)\b/i,
  dangerWords: /(?:\b(?:danger|destructive|red)\b(?:-\d+)?|var\(--(?:color-)?(?:danger|destructive|error))/i,
  lossCopy: /연체|게으름|스트릭이?\s*(?:끊|손실)|스트릭을?\s*잃|잃게\s*됩니다|streak\s*(?:lost|broken)|don'?t\s+break\s+your\s+streak/i,
  rewardCopy: /코인|폭죽|경험치/,
  socialCopy: /리더보드|랭킹|친구와\s*비교/,
  colorFn: /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(\s*[-\d.%]/i,
  hexLong: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})\b/,
  hexShortWhole: /^#(?:[0-9a-fA-F]{3,4})$/,
  colorKey: /(color|background|bg|fill|stroke|border|shadow|outline)/i,
};

const words = (name) => snake(name);
const V = (file, line, rule, message, level) => ({ file, line, rule, message, ...(level ? { level } : {}) });

// ---------------- source (ts/tsx/js) ----------------
function checkSource(rel, src) {
  const v = [];
  const { tokens, comments, lineOf } = tokenize(src);
  const masked = maskComments(src, comments);
  const all = [...deepTokens(tokens)];
  const inTokens = CFG.tokenDirs.some((r) => r.test(rel));
  const isContracts = CFG.contractsPath.test(rel);

  // NG-G1 / NG-G2 vocabulary in identifiers
  for (const t of all) {
    if (t.t !== "id") continue;
    const w = words(t.v);
    if (CFG.rewardWords.test(w)) v.push(V(rel, t.line, "ng-g1/reward-vocab", `identifier "${t.v}" implements a reward mechanic (XP/coin/confetti)`));
    if (CFG.socialWords.test(w)) v.push(V(rel, t.line, "ng-g2/social-vocab", `identifier "${t.v}" implies social comparison`));
  }
  // Korean UI copy (JSX text included: works on comment-masked raw text)
  masked.split("\n").forEach((l, i) => {
    if (CFG.rewardCopy.test(l)) v.push(V(rel, i + 1, "ng-g1/reward-vocab", "reward vocabulary in UI copy"));
    if (CFG.socialCopy.test(l)) v.push(V(rel, i + 1, "ng-g2/social-vocab", "social-comparison vocabulary in UI copy"));
    if (CFG.lossCopy.test(l)) v.push(V(rel, i + 1, "ng-g5/loss-copy", "loss/overdue-fear vocabulary in UI copy"));
    if (/<video\b/.test(l) || /youtube\.com\/embed|player\.vimeo\.com/.test(l)) v.push(V(rel, i + 1, "ng-g6/video", "video content element/embed"));
  });
  for (let i = 0; i < all.length - 2; i++) {
    const t = all[i];
    // NG-G2 navigator.share
    if (t.t === "id" && t.v === "navigator" && all[i + 1].v === "." && all[i + 2].v === "share") v.push(V(rel, t.line, "ng-g2/network-share", "navigator.share(): no network sharing (NG-G2)"));
    // NG-G5 push API
    if (t.t === "id" && t.v === "Notification" && all[i + 1].v === "." && all[i + 2].v === "requestPermission") v.push(V(rel, t.line, "ng-g5/push-api", "Notification.requestPermission(): push/notification API unused (NG-G5)"));
    if (t.t === "id" && t.v === "Notification" && all[i - 1]?.v === "new" && all[i + 1].v === "(") v.push(V(rel, t.line, "ng-g5/push-api", "new Notification(): push/notification API unused (NG-G5)"));
    if (t.t === "id" && (t.v === "pushManager" || t.v === "PushManager")) v.push(V(rel, t.line, "ng-g5/push-api", "PushManager: push API unused (NG-G5)"));
  }
  // imports: push libs, AI in blank-note
  const imports = [];
  for (let i = 0; i < tokens.length - 1; i++) if (tokens[i].t === "id" && tokens[i].v === "from" && tokens[i + 1].t === "str" && tokens[i - 1]?.v !== ".") imports.push(tokens[i + 1]);
  for (const s of imports) {
    if (CFG.pushImport.test(s.v)) v.push(V(rel, s.line, "ng-g5/push-api", `import of push library "${s.v}"`));
    if (CFG.rewardWords.test(words(s.v.replace(/[@/.]/g, "_")))) v.push(V(rel, s.line, "ng-g1/reward-vocab", `import of reward library "${s.v}"`));
  }

  // design lint: raw colours
  if (!inTokens) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.t !== "str" && t.t !== "tpl") continue;
      const pieces = t.t === "str" ? [t.v] : t.quasis.map((q) => q.v);
      const key = tokens[i - 1]?.v === ":" ? tokens[i - 2] : null;
      const colorCtx = key && (key.t === "id" || key.t === "str") && CFG.colorKey.test(key.v);
      for (const p of pieces) {
        if (CFG.hexLong.test(p) || CFG.colorFn.test(p) || (colorCtx && CFG.hexShortWhole.test(p.trim()))) { v.push(V(rel, t.line, "design/raw-color", `raw colour literal "${p.slice(0, 30)}": use a design token (var(--color-*))`)); break; }
      }
    }
  }

  // NG-G5 danger colour on due/overdue/streak: className attr, cn()/clsx() args, or a single string
  const dueDanger = (texts, line) => { const j = texts.join(" "); if (CFG.dueWords.test(j) && CFG.dangerWords.test(j)) v.push(V(rel, line, "ng-g5/danger-due", "danger colour combined with due/overdue/streak styling (NG-G5)")); };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === "id" && t.v === "className" && tokens[i + 1]?.v === "=") {
      const n = tokens[i + 2];
      if (n?.t === "str") dueDanger([n.v], n.line);
      else if (n?.v === "{") { const c = matchClose(tokens, i + 2); dueDanger([...stringPieces(tokens.slice(i + 3, c), lineOf)].map((p) => p.text), t.line); }
    } else if (t.t === "id" && /^(cn|clsx|classNames|twMerge|cva)$/.test(t.v) && tokens[i + 1]?.v === "(") {
      const c = matchClose(tokens, i + 1);
      dueDanger([...stringPieces(tokens.slice(i + 2, c), lineOf)].map((p) => p.text), t.line);
    } else if (t.t === "str" && !(tokens[i - 1]?.v === "=" && tokens[i - 2]?.v === "className")) {
      // standalone string constant containing both
      if (tokens[i - 1]?.v === "(" && /^(cn|clsx|classNames|twMerge|cva)$/.test(tokens[i - 2]?.v ?? "")) continue;
      dueDanger([t.v], t.line);
    }
  }

  // NG-G3: pre-submit schemas
  const scopeRanges = [];
  if (CFG.preSubmitPath.test(rel)) scopeRanges.push({ name: "(file)", from: 0, to: tokens.length });
  for (let i = 0; i < tokens.length - 2; i++) {
    const t = tokens[i];
    if (t.t === "id" && ["const", "interface", "type", "class"].includes(t.v) && tokens[i + 1]?.t === "id" && /pre_?submit/.test(words(tokens[i + 1].v))) {
      let d = 0, j = i + 2, opened = false;
      const isIface = t.v === "interface";
      for (; j < tokens.length; j++) {
        const x = tokens[j];
        if (x.t === "p" && "([{".includes(x.v)) { d++; if (x.v === "{") opened = true; }
        else if (x.t === "p" && ")]}".includes(x.v)) { d--; if (isIface && opened && d === 0) { j++; break; } }
        else if (d === 0 && x.t === "p" && x.v === ";") { j++; break; }
        else if (d === 0 && j > i + 2 && x.t === "id" && ["export", "const", "interface", "type", "function", "import"].includes(x.v) && x.line > tokens[j - 1].line) break;
      }
      scopeRanges.push({ name: tokens[i + 1].v, from: i, to: j });
    }
  }
  for (const r of scopeRanges) {
    for (let k = r.from; k < r.to - 1; k++) {
      const x = tokens[k];
      if ((x.t === "id" || x.t === "str") && CFG.bannedPreSubmitKeys.has(x.v) && (tokens[k + 1].v === ":" || (tokens[k + 1].v === "?" && tokens[k + 2]?.v === ":")) && ["{", ",", ";"].includes(tokens[k - 1]?.v ?? "{"))
        v.push(V(rel, x.t === "id" || x.t === "str" ? x.line : 0, "ng-g3/presubmit-field", `pre-submit schema "${r.name}" declares "${x.v}" (answer/explanation only after submission)`));
      if (x.t === "id" && CFG.revealIdent.test(x.v) && x.v !== r.name && tokens[k - 1]?.v !== ".") v.push(V(rel, x.line, "ng-g3/presubmit-spread", `pre-submit schema "${r.name}" derives from post-submit shape "${x.v}"`));
    }
  }

  // NG-G4 routing
  if (CFG.routingPath.test(rel)) {
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      if (t.t !== "id") continue;
      if (CFG.lockWords.test(words(t.v))) v.push(V(rel, t.line, "ng-g4/hard-lock", `routing code contains lock semantics "${t.v}" (soft gate only, NG-G4)`));
      if (t.v === "redirect" && all[i + 1]?.v === "(") {
        let hit = false;
        for (let k = i - 1; k >= Math.max(0, i - 25); k--) { if (all[k].v === ";" || all[k].v === "}") break; if (all[k].t === "id" && /prereq/i.test(all[k].v)) { hit = true; break; } }
        if (hit) v.push(V(rel, t.line, "ng-g4/prereq-redirect", "redirect() conditioned on prerequisites = forced lock (NG-G4)"));
      }
    }
  }

  // NG-G6 video words in contracts
  if (isContracts) for (const t of all) {
    if (t.t === "id" || t.t === "str") { if (/(^|_)video(s)?(_|$)/.test(words(t.t === "str" ? t.v.replace(/[^\w]/g, "_") : t.v))) v.push(V(rel, t.line, "ng-g6/video", `contracts mention "${t.v}": content schema has no video body type (NG-G6)`)); }
  }

  // NG-G7 blank-note pre-submit path
  if (CFG.blankNotePath.test(rel) && !CFG.postSubmitPath.test(rel)) {
    for (const s of imports) if (CFG.aiImport.test(s.v)) v.push(V(rel, s.line, "ng-g7/presubmit-ai-call", `blank-note pre-submit code imports AI gateway client "${s.v}" (NG-G7)`));
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      if (t.t !== "id") continue;
      if (CFG.aiCallIdent.test(t.v) || (t.v === "generate" && all[i + 1]?.v === "(")) v.push(V(rel, t.line, "ng-g7/presubmit-ai-call", `blank-note pre-submit code calls/defines AI generation "${t.v}" (NG-G7)`));
    }
  }
  return { v, tokens };
}

// ---------------- css ----------------
function checkCss(rel, src) {
  const v = [];
  const masked = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lineAt = (pos) => masked.slice(0, pos).split("\n").length;
  const inTokens = CFG.tokenDirs.some((r) => r.test(rel));
  // vocabulary: every css identifier-ish token
  for (const m of masked.matchAll(/-{0,2}[A-Za-z_][\w-]*/g)) {
    const w = m[0].replace(/^-+/, "").replace(/-/g, "_").toLowerCase();
    if (CFG.rewardWords.test(w)) v.push(V(rel, lineAt(m.index), "ng-g1/reward-vocab", `CSS name "${m[0]}" is a reward animation/token`));
    if (CFG.socialWords.test(w)) v.push(V(rel, lineAt(m.index), "ng-g2/social-vocab", `CSS name "${m[0]}" implies social comparison`));
  }
  // rules
  for (const m of masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim(); const body = m[2];
    const bodyStart = m.index + m[0].indexOf("{") + 1;
    if (!inTokens) {
      for (const d of body.matchAll(/([\w-]+)\s*:\s*([^;]+)(;|$)/g)) {
        if (d[1].startsWith("--") && false) continue;
        if (CFG.hexLong.test(d[2]) || /#(?:[0-9a-fA-F]{3,4})\b/.test(d[2]) || CFG.colorFn.test(d[2])) v.push(V(rel, lineAt(bodyStart + d.index), "design/raw-color", `raw colour "${d[2].trim().slice(0, 30)}" in ${d[1]}: use a design token`));
      }
    }
    if (CFG.dueWords.test(selector) && CFG.dangerWords.test(body)) v.push(V(rel, lineAt(m.index + m[0].search(/\S/)), "ng-g5/danger-due", `CSS rule "${selector.slice(0, 30)}" paints due/overdue/streak with a danger colour (NG-G5)`));
  }
  return v;
}

// ---------------- package.json ----------------
function checkPackageJson(rel, text) {
  const v = [];
  let json; try { json = JSON.parse(text); } catch { return v; }
  const deps = { ...json.dependencies, ...json.devDependencies };
  const lines = text.split("\n");
  for (const [rule, names] of Object.entries(CFG.deps)) for (const n of names) if (n in deps) {
    const line = lines.findIndex((l) => l.includes(`"${n}"`)) + 1;
    v.push(V(rel, line, rule, `dependency "${n}" contradicts NG-G (${rule})`));
  }
  return v;
}

// ---------------- repo-level: ai-gateway policy (NG-G7 positive assertion) ----------------
function checkPolicy(root, files) {
  const v = [];
  const policyFiles = files.filter((f) => /ai-gateway-policy\.[a-z]+$/.test(f));
  if (!policyFiles.length) return [V("(repo)", 0, "ng-g7/policy-file-missing", "no ai-gateway-policy.* found: the gateway must deny blank-note generation before submit")];
  for (const f of policyFiles) {
    const { tokens } = tokenize(readFileSync(path.join(root, f), "utf8"));
    const k = tokens.findIndex((t) => (t.t === "id" || t.t === "str") && t.v === "deny_before_submit" && tokens[tokens.indexOf(t) + 1]?.v === ":");
    if (k < 0) { v.push(V(f, 1, "ng-g7/policy-missing-deny", "policy has no deny_before_submit list")); continue; }
    const open = k + 2; const close = matchClose(tokens, open);
    const denied = tokens.slice(open, close).filter((t) => t.t === "str").map((t) => t.v);
    if (!denied.some((s) => /^blank_note\./.test(s))) v.push(V(f, tokens[k].line, "ng-g7/policy-missing-deny", `deny_before_submit lacks a blank_note.* generation task (has: ${denied.join(", ") || "none"})`));
  }
  return v;
}

export function run(root) {
  const files = walk(root, new Set([...SRC_EXT, ".css", ".json"]));
  const out = [];
  for (const f of files) {
    const text = read(root, f);
    if (/\.css$/.test(f)) out.push(...checkCss(f, text));
    else if (/(^|\/)package\.json$/.test(f)) out.push(...checkPackageJson(f, text));
    else if (SRC_EXT.has(path.extname(f))) out.push(...checkSource(f, text).v);
  }
  out.push(...checkPolicy(root, files));
  return { files: files.length, violations: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs();
  const { files, violations } = run(opts.root);
  finish("check:ng-g", opts.root, violations, opts, { files });
}
