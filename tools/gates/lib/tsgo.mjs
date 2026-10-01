// ported-from: spikes/sp7-static-gates/src/lib/tsgo.mjs (audit-fixed: tsconfig 부재·API 로드 실패·프로젝트 0개·파일 0개 → engine/tsgo, 열린 api는 닫고 던짐)
// TypeScript 7 실험 JS API(`typescript/unstable/sync`, 네이티브 tsgo 프로세스)의 얇은 래퍼. typescript 7.0.2 정확 pin 전제.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { GateEngineError } from './errors.mjs';

/**
 * @param {string} root 절대 경로
 * @param {string} [tsconfig]
 * @returns {Promise<{api, project, checker, program, files: string[], close: () => void}>}
 */
export async function openProject(root, tsconfig = 'tsconfig.json') {
  const configPath = path.join(root, tsconfig);
  if (!existsSync(configPath)) {
    throw new GateEngineError('engine/tsgo', `${tsconfig} not found under ${root}`);
  }
  let mod;
  try {
    mod = await import('typescript/unstable/sync');
  } catch (e) {
    throw new GateEngineError(
      'engine/tsgo',
      `cannot load typescript/unstable/sync: ${String(e.message).split('\n')[0]}`,
    );
  }
  let api;
  try {
    api = new mod.API({ cwd: root });
  } catch (e) {
    throw new GateEngineError('engine/tsgo', `cannot start tsgo: ${String(e.message).split('\n')[0]}`);
  }
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    const project = snapshot.getProjects()[0];
    if (!project) {
      throw new GateEngineError('engine/tsgo', `could not open project ${configPath}`);
    }
    const files = project.program
      .getSourceFileNames()
      .filter((f) => f.startsWith(root + path.sep) && !f.includes(`${path.sep}node_modules${path.sep}`));
    if (files.length === 0) {
      throw new GateEngineError('engine/tsgo', `project ${configPath} has 0 source files`);
    }
    return { api, project, checker: project.checker, program: project.program, files, close: () => api.close() };
  } catch (e) {
    api.close();
    if (e instanceof GateEngineError) {
      throw e;
    }
    throw new GateEngineError('engine/tsgo', `tsgo failed: ${String(e.message).split('\n')[0]}`);
  }
}
