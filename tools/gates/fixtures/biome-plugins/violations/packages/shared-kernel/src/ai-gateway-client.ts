// ported-from: spikes/sp7-static-gates/fixture/violations/packages/shared-kernel/src/ai-gateway-client.ts
export interface GenerateRequest { task: string; prompt: string }
export async function generate(req: GenerateRequest): Promise<string> {
  return `stub:${req.task}:${req.prompt.length}`;
}
