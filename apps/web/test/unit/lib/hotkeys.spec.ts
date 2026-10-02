import { describe, expect, it, vi } from 'vitest';
import {
  createHotkeyManager,
  detectPlatform,
  isTypingTarget,
  type KeyboardEventLike,
  matchesCombo,
  parseCombo,
  parseKeymap,
} from '../../../src/lib/hotkeys.js';

function key(code: string, extra: Partial<KeyboardEventLike> = {}): KeyboardEventLike & { prevented: boolean } {
  const e = {
    code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
    ...extra,
  };
  return e;
}

function manager(opts: { keymap?: Record<string, string | null>; platform?: 'mac' | 'other' } = {}) {
  let t = 0;
  const m = createHotkeyManager({ platform: opts.platform ?? 'other', now: () => t, keymap: opts.keymap });
  return { m, tick: (ms: number) => (t += ms) };
}

describe('hotkeys', () => {
  it('UT-WEB-006 조합 중에는 단일 키·결합 키가 0회 실행되고 조합이 끝나면 같은 키가 1회 실행된다 [FR-UX-004][NFR-UX-014]', () => {
    const { m } = manager();
    const single = vi.fn();
    const combo = vi.fn();
    m.register('global', '?', single);
    m.register('global', 'Mod+K', combo);
    expect(m.handleKeyDown(key('Slash', { shiftKey: true, isComposing: true }))).toBe(false);
    expect(m.handleKeyDown(key('KeyK', { ctrlKey: true, keyCode: 229 }))).toBe(false);
    expect(m.handleKeyDown(key('KeyK', { ctrlKey: true, nativeEvent: { isComposing: true } }))).toBe(false);
    expect(single).not.toHaveBeenCalled();
    expect(combo).not.toHaveBeenCalled();
    expect(m.handleKeyDown(key('Slash', { shiftKey: true, isComposing: false }))).toBe(true);
    expect(m.handleKeyDown(key('KeyK', { ctrlKey: true }))).toBe(true);
    expect(single).toHaveBeenCalledTimes(1);
    expect(combo).toHaveBeenCalledTimes(1);
  });

  it('UT-WEB-030 parseCombo·matchesCombo는 Mod(mac=meta·other=ctrl)·Numpad1≡Digit1·수식어 정확 일치·detectPlatform을 지킨다 [FR-UX-003]', () => {
    expect(parseCombo('Mod+K')).toEqual({ mod: true, shift: false, alt: false, code: 'KeyK' });
    expect(parseCombo('?')).toEqual({ mod: false, shift: true, alt: false, code: 'Slash' });
    expect(parseCombo('G')).toMatchObject({ code: 'KeyG', mod: false });
    expect(parseCombo('1')).toMatchObject({ code: 'Digit1' });
    expect(parseCombo('Mod+\\')).toMatchObject({ mod: true, code: 'Backslash' });
    expect(parseCombo('Mod+Shift+F')).toEqual({ mod: true, shift: true, alt: false, code: 'KeyF' });
    expect(parseCombo('Enter').code).toBe('Enter');
    expect(parseCombo('Escape').code).toBe('Escape');
    expect(parseCombo('Space').code).toBe('Space');
    expect(parseCombo('Alt+ArrowUp')).toMatchObject({ alt: true, code: 'ArrowUp' });
    expect(() => parseCombo('Hyper+K')).toThrow(TypeError);
    expect(() => parseCombo('Mod+')).toThrow(TypeError);
    expect(() => parseCombo('')).toThrow(TypeError);

    const modK = parseCombo('Mod+K');
    expect(matchesCombo(key('KeyK', { metaKey: true }), modK, 'mac')).toBe(true);
    expect(matchesCombo(key('KeyK', { ctrlKey: true }), modK, 'mac')).toBe(false);
    expect(matchesCombo(key('KeyK', { ctrlKey: true }), modK, 'other')).toBe(true);
    expect(matchesCombo(key('KeyK', { metaKey: true }), modK, 'other')).toBe(false);
    expect(matchesCombo(key('KeyK', { ctrlKey: true, shiftKey: true }), modK, 'other')).toBe(false);
    expect(matchesCombo(key('KeyK', { ctrlKey: true, altKey: true }), modK, 'other')).toBe(false);
    expect(matchesCombo(key('KeyK'), modK, 'other')).toBe(false);
    expect(matchesCombo(key('Numpad1'), parseCombo('1'), 'other')).toBe(true);
    expect(matchesCombo(key('Digit1'), parseCombo('1'), 'other')).toBe(true);
    expect(matchesCombo(key('Digit2'), parseCombo('1'), 'other')).toBe(false);
    expect(matchesCombo(key('NumpadEnter'), parseCombo('Enter'), 'other')).toBe(true);
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('mac');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('other');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0)')).toBe('other');
  });

  it('UT-WEB-031 입력 포커스 중 단일 키는 무시되고 Mod+K는 실행되며 시퀀스 G→M은 1초 안에만 실행된다 [FR-UX-003][NFR-UX-014]', () => {
    const { m, tick } = manager();
    const q = vi.fn();
    const palette = vi.fn();
    const seq = vi.fn();
    m.register('global', 'Q', q);
    m.register('global', 'Mod+K', palette);
    m.registerSequence('G', 'M', seq);
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    const cm = document.createElement('div');
    cm.className = 'cm-editor';
    const inner = document.createElement('span');
    cm.append(inner);
    const plain = document.createElement('button');
    document.body.append(input, area, ce, cm, plain);
    for (const target of [input, area, ce, inner]) {
      expect(isTypingTarget(target)).toBe(true);
      expect(m.handleKeyDown(key('KeyQ', { target }))).toBe(false);
      expect(m.handleKeyDown(key('KeyK', { ctrlKey: true, target }))).toBe(true);
    }
    expect(q).not.toHaveBeenCalled();
    expect(palette).toHaveBeenCalledTimes(4);
    expect(isTypingTarget(plain)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(m.handleKeyDown(key('KeyQ', { target: plain }))).toBe(true);
    // 입력 포커스 중 시퀀스 시작 키도 무시
    expect(m.handleKeyDown(key('KeyG', { target: input }))).toBe(false);
    expect(m.handleKeyDown(key('KeyM', { target: input }))).toBe(false);
    expect(seq).not.toHaveBeenCalled();

    expect(m.handleKeyDown(key('KeyG', { target: plain }))).toBe(true);
    tick(900);
    expect(m.handleKeyDown(key('KeyM', { target: plain }))).toBe(true);
    expect(seq).toHaveBeenCalledTimes(1);
    // 1초 초과는 무시
    expect(m.handleKeyDown(key('KeyG', { target: plain }))).toBe(true);
    tick(1500);
    expect(m.handleKeyDown(key('KeyM', { target: plain }))).toBe(false);
    expect(seq).toHaveBeenCalledTimes(1);
    // 다른 키가 끼면 시퀀스 취소
    m.handleKeyDown(key('KeyG', { target: plain }));
    m.handleKeyDown(key('KeyX', { target: plain }));
    expect(m.handleKeyDown(key('KeyM', { target: plain }))).toBe(false);
    document.body.replaceChildren();
  });

  it('UT-WEB-032 keymap 재매핑·null 끄기·깨진 JSON 무시·활동 scope 우선순위·allowInInput을 지킨다 [FR-UX-003]', () => {
    const remap = manager({ keymap: { 'Mod+K': 'Mod+J', '?': null } });
    const palette = vi.fn();
    const help = vi.fn();
    remap.m.register('global', 'Mod+K', palette);
    remap.m.register('global', '?', help);
    expect(remap.m.handleKeyDown(key('KeyK', { ctrlKey: true }))).toBe(false);
    expect(remap.m.handleKeyDown(key('KeyJ', { ctrlKey: true }))).toBe(true);
    expect(remap.m.handleKeyDown(key('Slash', { shiftKey: true }))).toBe(false);
    expect(palette).toHaveBeenCalledTimes(1);
    expect(help).not.toHaveBeenCalled();
    const badRemap = manager({ keymap: { Q: '???잘못' } });
    const q = vi.fn();
    badRemap.m.register('global', 'Q', q);
    expect(badRemap.m.handleKeyDown(key('KeyQ'))).toBe(true);

    expect(parseKeymap(null)).toEqual({});
    expect(parseKeymap('{깨짐')).toEqual({});
    expect(parseKeymap('[1,2]')).toEqual({});
    expect(parseKeymap('{"Mod+K":"Mod+J","?":null,"x":5}')).toEqual({ 'Mod+K': 'Mod+J', '?': null });

    const { m } = manager();
    const order: string[] = [];
    m.register('global', 'Enter', () => order.push('global'));
    m.register('player', 'Enter', () => order.push('player'));
    m.register('ox', 'Enter', () => order.push('ox'));
    m.setActiveScopes(['player', 'ox']);
    m.handleKeyDown(key('Enter'));
    m.setActiveScopes(['ox', 'player']);
    m.handleKeyDown(key('Enter'));
    m.setActiveScopes([]);
    m.handleKeyDown(key('Enter'));
    expect(order).toEqual(['ox', 'player', 'global']);
    const off = m.register('global', 'Enter', () => order.push('later'));
    m.handleKeyDown(key('Enter'));
    off();
    m.handleKeyDown(key('Enter'));
    expect(order.slice(3)).toEqual(['later', 'global']);

    const input = document.createElement('input');
    const esc = vi.fn();
    m.register('global', 'Escape', esc, { allowInInput: true });
    expect(m.handleKeyDown(key('Escape', { target: input }))).toBe(true);
    expect(esc).toHaveBeenCalledTimes(1);
    const ev = key('Enter');
    m.handleKeyDown(ev);
    expect(ev.prevented).toBe(true);
  });
});
