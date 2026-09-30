import path from "node:path"; import { pathToFileURL } from "node:url";
const cwd = process.cwd();
const dc = await import(pathToFileURL(path.join(cwd, "node_modules/dependency-cruiser/src/main/index.mjs")).href);
const FIX = path.resolve(cwd, "../../fixture/violations");
const ruleSet = { forbidden: [{ name: "no-cross-service", severity: "error", from: { path: "^services/([^/]+)/" }, to: { path: "^services/([^/]+)/", pathNot: "^services/$1/" } }] };
for (const opts of [{ parser: "swc" }, { tsPreCompilationDeps: true }, { tsPreCompilationDeps: false }, {}]) {
  try {
    const r = await dc.cruise(["services", "packages", "apps"], { ...opts, ruleSet, baseDir: FIX, validate: true, tsConfig: { fileName: path.join(FIX, "tsconfig.json") }, exclude: { path: "node_modules" } });
    console.log(JSON.stringify(opts), "modules", r.output.modules.length, "violations", r.output.summary.violations.map((v) => `${v.from}->${v.to}`));
  } catch (e) { console.log(JSON.stringify(opts), "ERR", e.message.split("\n")[0]); }
}
