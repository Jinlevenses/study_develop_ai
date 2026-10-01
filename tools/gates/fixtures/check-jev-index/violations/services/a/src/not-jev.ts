// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/not-jev.ts (audit-fixed: fixture 규약)
// Outside Jev scope the same patterns are legal (candidate-list indexing is normal code here).
export const HELP = "Compare item 2 with item 3";
export function first(options: string[]) { return options[0]; }
