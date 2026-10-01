import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSqliteLoader, installSqliteWarningFilter } from '../../../src/service/sqlite-loader.js';

type Emit = (...args: unknown[]) => void;

function fakeTarget(): { target: { emitWarning: (...args: never[]) => void }; passed: unknown[][] } {
  const passed: unknown[][] = [];
  const target = {
    emitWarning: ((...args: unknown[]) => void passed.push(args)) as unknown as (...args: never[]) => void,
  };
  return { target, passed };
}

describe('installSqliteWarningFilter', () => {
  it('UT-SK-194 ExperimentalWarning 중 메시지에 SQLite가 든 것만 버리고 나머지는 원래 함수로 넘긴다 [NFR-PORT-009]', () => {
    // Arrange
    const { target, passed } = fakeTarget();
    installSqliteWarningFilter(target);
    const emit = target.emitWarning as unknown as Emit;
    // Act
    emit('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning'); // 버림
    emit('SQLite is an experimental feature', { type: 'ExperimentalWarning' }); // 버림
    const err = new Error('SQLite is an experimental feature');
    err.name = 'ExperimentalWarning';
    emit(err); // 버림
    emit('Import assertions are experimental', 'ExperimentalWarning'); // SQLite 아님 → 통과
    emit('SQLite is deprecated', 'DeprecationWarning'); // 유형이 다름 → 통과
    emit('x', 'DeprecationWarning'); // 통과
    emit('plain'); // 유형 없음 → 통과
    // Assert
    expect(passed.map((a) => (typeof a[0] === 'string' ? a[0] : 'error'))).toEqual([
      'Import assertions are experimental',
      'SQLite is deprecated',
      'x',
      'plain',
    ]);
  });

  it('UT-SK-194 로더는 같은 호출에 같은 Promise를 돌려주고 필터를 건 뒤 sqlite 함수 5개를 담아 준다 [NFR-PORT-009]', async () => {
    // Arrange
    const { target } = fakeTarget();
    const before = target.emitWarning;
    const load = createSqliteLoader(target);
    // Act
    const first = load();
    const second = load();
    const runtime = await first;
    // Assert
    expect(second).toBe(first);
    expect(target.emitWarning).not.toBe(before); // 필터가 걸렸다
    expect(Object.keys(runtime).sort()).toEqual([
      'migrate',
      'openDb',
      'readMigrationBundle',
      'vacuumInto',
      'verifySchema',
    ]);
    expect(typeof runtime.openDb).toBe('function');
    expect(createSqliteLoader(target)()).not.toBe(first); // 로더 객체마다 캐시(모듈 전역 0)
  });
});

describe('값 import 0 검사', () => {
  it('UT-SK-194 src/{service,eventing,idempotency}/**에서 sqlite/sqlite·node:sqlite 값 import 0 (로더의 boundary-ok 동적 import 2줄만 예외) [NFR-PORT-009]', () => {
    // Arrange
    const root = fileURLToPath(new URL('../../../src/', import.meta.url));
    const offenders: string[] = [];
    const sqliteSpecifier = /(?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite|\.\.\/sqlite\/sqlite)/;
    // Act
    for (const dir of ['service', 'eventing', 'idempotency']) {
      for (const file of readdirSync(path.join(root, dir))) {
        const text = readFileSync(path.join(root, dir, file), 'utf8');
        text.split('\n').forEach((line, i) => {
          const code = line.replace(/\s\/\/.*$/, '').trim(); // 줄 끝 주석은 코드가 아니다
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || !sqliteSpecifier.test(code)) {
            return;
          }
          const typeOnly =
            /^import\s+type\b/.test(code) || /\btypeof\s+import\(/.test(code) || /^export\s+type\b/.test(code);
          const sanctioned = /boundary-ok:/.test(line) && /await import\(/.test(line);
          if (!typeOnly && !sanctioned) {
            offenders.push(`${dir}/${file}:${i + 1}: ${code}`);
          }
        });
      }
    }
    // Assert
    expect(offenders).toEqual([]);
    const loader = readFileSync(path.join(root, 'service', 'sqlite-loader.ts'), 'utf8');
    expect(loader.match(/boundary-ok:/g)).toHaveLength(2);
    expect(loader.startsWith('// ported-from: spikes/sp4-node-sqlite/src/warnings.mjs')).toBe(true);
    const codeOnly = loader
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toMatch(/process\.on\(\s*['"]warning|removeAllListeners|--no-warnings/);
  });
});
