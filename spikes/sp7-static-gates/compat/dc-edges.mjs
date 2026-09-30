import path from "node:path"; import { pathToFileURL } from "node:url";
const cwd = process.cwd();
const dc = await import(pathToFileURL(path.join(cwd, "node_modules/dependency-cruiser/src/main/index.mjs")).href);
const FIX = path.resolve(cwd, "../../fixture/violations");
const r = await dc.cruise(["services"], { baseDir: FIX, tsConfig: { fileName: path.join(FIX, "tsconfig.json") }, exclude: { path: "node_modules" } });
const m = r.output.modules.find((x) => x.source.endsWith("services/a/src/cross.ts"));
console.log(m.dependencies.map((d) => `${d.module} => ${d.resolved} [${d.dependencyTypes.join(",")}]${d.couldNotResolve ? " UNRESOLVED" : ""}`).join("\n"));
