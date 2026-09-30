// Thin helper over TypeScript 7's experimental JS API (`typescript/unstable/sync`, spawns the native tsgo process).
// Status: "unstable" by name -- pin typescript@7.0.x exactly and keep this behind an engine flag.
import path from "node:path";

export async function openProject(root, tsconfig = "tsconfig.json") {
  const { API } = await import("typescript/unstable/sync");
  const api = new API({ cwd: root });
  const snapshot = api.updateSnapshot({ openProjects: [path.join(root, tsconfig)] });
  const project = snapshot.getProjects()[0];
  if (!project) { api.close(); throw new Error(`tsgo: could not open project ${path.join(root, tsconfig)}`); }
  return {
    api, project, checker: project.checker, program: project.program,
    /** absolute source files that belong to the repo (no node_modules, no lib.*.d.ts) */
    files: project.program.getSourceFileNames().filter((f) => f.startsWith(root + path.sep) && !f.includes(`${path.sep}node_modules${path.sep}`)),
    close: () => api.close(),
  };
}
