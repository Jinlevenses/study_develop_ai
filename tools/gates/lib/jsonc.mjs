import { readFileSync } from 'node:fs';
import { GateEngineError } from './errors.mjs';

/** JSON(주석·끝 쉼표 허용) 읽기. 부재·파싱 실패 → GateEngineError('engine/config'). */
export function readJsonc(absPath) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (e) {
    throw new GateEngineError('engine/config', `cannot read ${absPath} (${e.code ?? e.message})`);
  }
  try {
    return JSON.parse(stripJsonc(text));
  } catch (e) {
    throw new GateEngineError('engine/config', `invalid JSON in ${absPath}: ${e.message}`);
  }
}

function stripJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        j += text[j] === '\\' ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
    } else if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2);
      i = j < 0 ? text.length : j + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
