import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_ROOT, launchStack } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { describe, expect, it } from 'vitest';
import { isAlive, reportDir } from '../support/direct-stack.js';

// SEC-SYS-001 — 설치 스크립트·네이티브 애드온 0 (TST-01 §14.1, ARC-01 §12.8).
// [Brief 결정, CR 후보 ①] ".node 0" 문구를 "binding.gyp 0 + 상주 프로세스가 .node를 로드하지 않음"으로 해석한다.
// 빌드 도구(rolldown·lightningcss·@tailwindcss/oxide 등)의 사전 빌드 .node 목록은 보고만 한다.

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare'];
const WORKSPACE_GLOBS = ['apps', 'services', 'packages', 'tools'];

function packageJsonFiles(): string[] {
  const files = [path.join(APP_ROOT, 'package.json')];
  for (const group of WORKSPACE_GLOBS) {
    for (const entry of readdirSync(path.join(APP_ROOT, group), { withFileTypes: true })) {
      const file = path.join(APP_ROOT, group, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

type Walk = { bindingGyp: string[]; nodeFiles: string[] };

/** 심볼릭 링크를 따라가지 않고 `.git`·`node_modules`(최상위 `.pnpm` 제외)를 건너뛰며 파일을 훑는다. */
function walk(dir: string, out: Walk, insidePnpm: boolean): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.fathom-dev' || entry.name === 'test-results') {
        continue;
      }
      if (entry.name === 'node_modules' && !insidePnpm) {
        const pnpm = path.join(full, '.pnpm');
        if (existsSync(pnpm) && dir === APP_ROOT) {
          walk(pnpm, out, true);
        }
        continue;
      }
      walk(full, out, insidePnpm);
    } else if (entry.isFile()) {
      if (entry.name === 'binding.gyp') {
        out.bindingGyp.push(path.relative(APP_ROOT, full));
      } else if (entry.name.endsWith('.node')) {
        out.nodeFiles.push(path.relative(APP_ROOT, full));
      }
    }
  }
}

function mappedNodeAddons(pid: number): string[] {
  const maps = readFileSync(`/proc/${String(pid)}/maps`, 'utf8');
  return maps
    .split('\n')
    .map((line) => line.split(/\s+/).slice(5).join(' '))
    .filter((p) => p.endsWith('.node'));
}

function writeNativeReport(nodeFiles: readonly string[]): void {
  const byPackage: Record<string, number> = {};
  for (const file of nodeFiles) {
    const m = /node_modules\/\.pnpm\/([^/]+)\//.exec(file);
    const pkg = m?.[1] ?? 'other';
    byPackage[pkg] = (byPackage[pkg] ?? 0) + 1;
  }
  mkdirSync(reportDir(), { recursive: true });
  writeFileSync(
    path.join(reportDir(), 'native.json'),
    `${JSON.stringify({ count: nodeFiles.length, by_package: byPackage, files: nodeFiles.slice(0, 200) }, null, 2)}\n`,
  );
}

describe('보안: 설치·네이티브 애드온', () => {
  it('SEC-SYS-001 설치 스크립트·binding.gyp가 0이고 상주 프로세스가 네이티브 애드온을 로드하지 않는다 [NFR-PORT-003][AP-07]', async () => {
    // ① 워크스페이스 설정
    const workspace = readFileSync(path.join(APP_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toMatch(/^onlyBuiltDependencies:\s*\[\]\s*$/m);

    // ② 설치 훅 0
    const manifests = packageJsonFiles();
    expect(manifests.length).toBeGreaterThanOrEqual(17);
    for (const file of manifests) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const scripts =
        typeof parsed === 'object' && parsed !== null && 'scripts' in parsed && typeof parsed.scripts === 'object'
          ? Object.keys(parsed.scripts ?? {})
          : [];
      const hooks = scripts.filter((name) => INSTALL_HOOKS.includes(name));
      expect(hooks, `${path.relative(APP_ROOT, file)} install hooks`).toEqual([]);
    }

    // ③ binding.gyp 0 · ⑤ *.node 목록(보고만)
    const found: Walk = { bindingGyp: [], nodeFiles: [] };
    walk(APP_ROOT, found, false);
    expect(found.bindingGyp).toEqual([]);
    writeNativeReport(found.nodeFiles);

    // ④ 호스트 관측(Linux): 실제 스택 6개 프로세스의 매핑에 .node 0
    if (process.platform !== 'linux') {
      return;
    }
    const home = await createTempHome('fathom-sec001-');
    let pids: number[] = [];
    try {
      const stack = await launchStack({ runtime: 'dist', home: home.path });
      try {
        const registry = await stack.registry();
        pids = [
          stack.supervisorPid,
          ...Object.values(registry.services).flatMap((s) => (s?.pid === null || s === undefined ? [] : [s.pid])),
        ];
        expect(pids).toHaveLength(6);
        for (const pid of pids) {
          expect(mappedNodeAddons(pid), `pid ${String(pid)} native addons`).toEqual([]);
        }
      } finally {
        await stack.stop();
      }
      for (const pid of pids) {
        expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
      }
    } finally {
      await home.cleanup();
    }
  });
});
