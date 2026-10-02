import { type ImeEventLike, isImeComposing } from './ime.js';

export type HotkeyScope =
  | 'global'
  | 'player'
  | 'timeline'
  | 'ox'
  | 'choice'
  | 'cloze'
  | 'list'
  | 'editor'
  | 'reorder'
  | 'matching'
  | 'bugline'
  | 'srs'
  | 'note'
  | 'dialog'
  | 'depth_map'
  | 'lesson'
  | 'form'
  | 'none';

/** 'Mod' = mac ⌘ / 그 외 Ctrl. */
export interface Combo {
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly code: string;
}

export interface KeyboardEventLike extends ImeEventLike {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly target?: EventTarget | null;
  preventDefault?(): void;
}

export type Platform = 'mac' | 'other';

const SYMBOL_CODES: Readonly<Record<string, { readonly code: string; readonly shift: boolean }>> = {
  '?': { code: 'Slash', shift: true },
  '/': { code: 'Slash', shift: false },
  '\\': { code: 'Backslash', shift: false },
  ',': { code: 'Comma', shift: false },
  '.': { code: 'Period', shift: false },
  '[': { code: 'BracketLeft', shift: false },
  ']': { code: 'BracketRight', shift: false },
  '-': { code: 'Minus', shift: false },
  '=': { code: 'Equal', shift: false },
  ';': { code: 'Semicolon', shift: false },
  "'": { code: 'Quote', shift: false },
  '`': { code: 'Backquote', shift: false },
};

const NAMED_CODES: Readonly<Record<string, string>> = {
  enter: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

function keyToCode(key: string): { readonly code: string; readonly shift: boolean } {
  const symbol = SYMBOL_CODES[key];
  if (symbol !== undefined) {
    return symbol;
  }
  if (/^[A-Za-z]$/.test(key)) {
    return { code: `Key${key.toUpperCase()}`, shift: false };
  }
  if (/^[0-9]$/.test(key)) {
    return { code: `Digit${key}`, shift: false };
  }
  const named = NAMED_CODES[key.toLowerCase()];
  if (named !== undefined) {
    return { code: named, shift: false };
  }
  throw new TypeError(`알 수 없는 키: ${key}`);
}

export function parseCombo(s: string): Combo {
  const tokens = s.split('+');
  let last = tokens.pop() ?? '';
  if (last === '' && tokens.length > 0) {
    last = '+'; // 'Mod++' 같은 표기는 지원하지 않으므로 아래에서 TypeError
  }
  let mod = false;
  let shift = false;
  let alt = false;
  for (const t of tokens) {
    const name = t.toLowerCase();
    if (name === 'mod') {
      mod = true;
    } else if (name === 'shift') {
      shift = true;
    } else if (name === 'alt') {
      alt = true;
    } else {
      throw new TypeError(`알 수 없는 수식키: ${t}`);
    }
  }
  const key = keyToCode(last);
  return { mod, shift: shift || key.shift, alt, code: key.code };
}

function normalizeCode(code: string): string {
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad !== null) {
    return `Digit${numpad[1] ?? ''}`;
  }
  return code === 'NumpadEnter' ? 'Enter' : code;
}

export function matchesCombo(e: KeyboardEventLike, c: Combo, platform: Platform): boolean {
  const modPressed = platform === 'mac' ? e.metaKey : e.ctrlKey;
  const otherPressed = platform === 'mac' ? e.ctrlKey : e.metaKey;
  return (
    normalizeCode(e.code) === c.code &&
    modPressed === c.mod &&
    !otherPressed &&
    e.shiftKey === c.shift &&
    e.altKey === c.alt
  );
}

export function isTypingTarget(t: EventTarget | null | undefined): boolean {
  if (t === null || t === undefined || !(t instanceof Element)) {
    return false;
  }
  const tag = t.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }
  return t.closest('[contenteditable]:not([contenteditable="false"])') !== null || t.closest('.cm-editor') !== null;
}

export function detectPlatform(ua: string): Platform {
  return /Mac|iPhone|iPad|iPod/i.test(ua) ? 'mac' : 'other';
}

/** `fathom.keymap.v1` JSON → `{ "<원 combo>": "<새 combo>" | null }`. 파싱 실패·형식 위반 항목은 무시한다. */
export function parseKeymap(raw: string | null): Readonly<Record<string, string | null>> {
  if (raw === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 깨진 JSON — 재매핑 없음으로 취급한다.
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string' || v === null) {
      out[k] = v;
    }
  }
  return out;
}

export interface RegisterOptions {
  readonly allowInInput?: boolean;
}

export interface HotkeyManager {
  register(
    scope: HotkeyScope,
    combo: string,
    handler: (e: KeyboardEventLike) => void,
    opts?: RegisterOptions,
  ): () => void;
  /** 'G' → 'M' 같은 두 키 시퀀스(1000ms 타임아웃). */
  registerSequence(first: string, second: string, handler: () => void): () => void;
  handleKeyDown(e: KeyboardEventLike): boolean;
  setActiveScopes(scopes: readonly HotkeyScope[]): void;
}

export interface HotkeyManagerDeps {
  readonly platform: Platform;
  readonly now: () => number;
  readonly keymap?: Readonly<Record<string, string | null>>;
}

interface Registration {
  readonly scope: HotkeyScope;
  readonly combo: Combo | null; // null = 키맵이 끈 항목
  readonly handler: (e: KeyboardEventLike) => void;
  readonly allowInInput: boolean;
}

interface SequenceRegistration {
  readonly first: Combo | null;
  readonly second: Combo | null;
  readonly handler: () => void;
}

export const SEQUENCE_TIMEOUT_MS = 1000;

export function createHotkeyManager(deps: HotkeyManagerDeps): HotkeyManager {
  const keymap = deps.keymap ?? {};
  const registrations: Registration[] = [];
  const sequences: SequenceRegistration[] = [];
  let activeScopes: readonly HotkeyScope[] = [];
  let pending: { readonly first: Combo; readonly at: number } | null = null;

  function effectiveCombo(raw: string): Combo | null {
    const mapped = keymap[raw];
    if (mapped === null) {
      return null;
    }
    if (mapped !== undefined) {
      try {
        return parseCombo(mapped);
      } catch {
        // 잘못된 재매핑 값 — 원래 키를 유지한다.
        return parseCombo(raw);
      }
    }
    return parseCombo(raw);
  }

  function done(e: KeyboardEventLike): true {
    e.preventDefault?.();
    return true;
  }

  function handleSequence(e: KeyboardEventLike, plainBlocked: boolean): boolean {
    if (plainBlocked) {
      pending = null;
      return false;
    }
    if (pending !== null) {
      const { first, at } = pending;
      pending = null;
      if (deps.now() - at <= SEQUENCE_TIMEOUT_MS) {
        const hit = sequences.findLast(
          (s) =>
            s.first !== null &&
            s.second !== null &&
            sameCombo(s.first, first) &&
            matchesCombo(e, s.second, deps.platform),
        );
        if (hit !== undefined) {
          hit.handler();
          return done(e);
        }
      }
    }
    const start = sequences.find((s) => s.first !== null && matchesCombo(e, s.first, deps.platform));
    if (start?.first != null) {
      pending = { first: start.first, at: deps.now() };
      return done(e);
    }
    return false;
  }

  function scopeOrder(): readonly HotkeyScope[] {
    const inner = [...activeScopes].reverse().filter((s) => s !== 'global');
    return [...inner, 'global'];
  }

  return {
    register(scope, combo, handler, opts): () => void {
      const reg: Registration = {
        scope,
        combo: effectiveCombo(combo),
        handler,
        allowInInput: opts?.allowInInput === true,
      };
      registrations.push(reg);
      return () => {
        const i = registrations.indexOf(reg);
        if (i >= 0) {
          registrations.splice(i, 1);
        }
      };
    },
    registerSequence(first, second, handler): () => void {
      const reg: SequenceRegistration = { first: effectiveCombo(first), second: effectiveCombo(second), handler };
      sequences.push(reg);
      return () => {
        const i = sequences.indexOf(reg);
        if (i >= 0) {
          sequences.splice(i, 1);
        }
      };
    },
    handleKeyDown(e): boolean {
      if (isImeComposing(e)) {
        return false;
      }
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      const typing = plain && isTypingTarget(e.target);
      if (handleSequence(e, typing)) {
        return true;
      }
      for (const scope of scopeOrder()) {
        const hit = registrations.findLast(
          (r) =>
            r.scope === scope &&
            r.combo !== null &&
            matchesCombo(e, r.combo, deps.platform) &&
            !(typing && !r.allowInInput),
        );
        if (hit !== undefined) {
          hit.handler(e);
          return done(e);
        }
      }
      return false;
    },
    setActiveScopes(scopes): void {
      activeScopes = [...scopes];
    },
  };
}

function sameCombo(a: Combo, b: Combo): boolean {
  return a.code === b.code && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;
}
