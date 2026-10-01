// ported-from: spikes/sp4-node-sqlite/src/warnings.mjs (case 10·16~18; audit-fixed: ExperimentalWarning만 필터·process.on('warning') 미사용·기존 NODE_OPTIONS 보존)
// `node:sqlite` 등 실험 기능의 ExperimentalWarning만 버린다. 다른 경고(DeprecationWarning 등)는 그대로 통과시킨다.
// 금지: `--no-warnings`·`NODE_NO_WARNINGS`·`removeAllListeners('warning')`·`process.on('warning')`.

/**
 * @param {{ emitWarning: (warning: unknown, ...rest: unknown[]) => void }} target `process` 또는 같은 모양의 객체
 */
export function installExperimentalWarningFilter(target) {
  const original = target.emitWarning.bind(target);
  target.emitWarning = (warning, ...rest) => {
    const first = rest[0];
    const type = typeof first === 'string' ? first : first?.type;
    const name = type ?? warning?.name;
    if (name === 'ExperimentalWarning') {
      return;
    }
    return original(warning, ...rest);
  };
}
