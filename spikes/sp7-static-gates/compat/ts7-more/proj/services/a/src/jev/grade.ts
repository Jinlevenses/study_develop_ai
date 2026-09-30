import { judge } from "@fathom/shared-kernel";

// Reference idea units by OBJECT KEY (units.u01), never by position.
export function buildInstruction(units: Record<string, string>): string {
  const lines = Object.entries(units).map(([key, text]) => `- units.${key}: ${text}`);
  return ["Judge each idea unit by its key.", "Answer format: { units: { u01: 'complete' } }", ...lines].join("\n");
}

export const NOTE = "item2vec is unrelated; keys look like u01, opt_a";

export async function grade(units: Record<string, string>) {
  const out = await judge({ instruction: buildInstruction(units), units });
  return out.units.u01; // object key access
}

// Non-candidate arrays may be indexed freely, even inside Jev code:
export function parseArgs(argv: string[], text: string) {
  const m = /(\d+)/.exec(text);
  return { first: argv[2], num: m?.[1], head: text.split(",")[0] };
}

// candidates[3] in a comment is ignored
