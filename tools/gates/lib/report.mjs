// 게이트 출력 형식(§4.1.1). 결과 객체 = {root, exit, files, violations, extra?, error?}.
const count = (violations, severity) => violations.filter((v) => v.severity === severity).length;

/** stdout 마지막 줄 JSON 1개. */
export function formatJson(id, result) {
  if (result.exit === 2 || result.error !== undefined) {
    return JSON.stringify({ check: id, root: result.root, exit: 2, error: result.error });
  }
  const { violations } = result;
  return JSON.stringify({
    check: id,
    root: result.root,
    exit: result.exit,
    files: result.files,
    errors: count(violations, 'error'),
    warnings: count(violations, 'warn'),
    violations,
    ...(result.extra ?? {}),
  });
}

/** 텍스트 출력. exit 2이면 stderr용 한 줄. `quiet`이면 마지막 요약 줄만. */
export function formatText(id, result, { quiet = false } = {}) {
  if (result.exit === 2 || result.error !== undefined) {
    return `[${id}] engine error: ${result.error}`;
  }
  const { violations } = result;
  const lines = [];
  if (!quiet) {
    for (const v of violations) {
      lines.push(`${v.file}:${v.line}  ${v.severity}  ${v.rule}  ${v.message}`);
    }
  }
  lines.push(
    `[${id}] ${count(violations, 'error')} error(s), ${count(violations, 'warn')} warning(s), ${result.files} file(s)`,
  );
  return lines.join('\n');
}
