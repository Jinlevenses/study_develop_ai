// ported-from: spikes/sp7-static-gates/fixture/clean/packages/shared-kernel/src/index.ts (audit-fixed: 최소화)
import { ContentBody } from "@fathom/contracts";

export function ident(name: string): string {
  return `"${name}:${String(ContentBody.kind)}"`;
}
