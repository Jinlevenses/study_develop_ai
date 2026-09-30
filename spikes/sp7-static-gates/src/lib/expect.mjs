// Compare reported violations with // EXPECT[rule] markers in the fixture.
import { walk, loadExpectations } from "./common.mjs";

export function compare(root, violations, rulePrefixes) {
  const files = walk(root, null).filter((f) => !/(^|\/)(node_modules)\//.test(f));
  const exp = loadExpectations(root, files.filter((f) => /\.(ts|tsx|css|md|json|mjs|js)$/.test(f)), rulePrefixes);
  const got = new Set(violations.filter((v) => !rulePrefixes || rulePrefixes.some((p) => v.rule.startsWith(p))).map((v) => `${v.file}:${v.line}:${v.rule}`));
  const tp = [...got].filter((k) => exp.has(k));
  const fp = [...got].filter((k) => !exp.has(k));
  const fn = [...exp].filter((k) => !got.has(k));
  return { expected: exp.size, reported: got.size, tp: tp.length, fp, fn, precision: got.size ? tp.length / got.size : 1, recall: exp.size ? tp.length / exp.size : 1 };
}
