export interface GenerateRequest { task: string; prompt: string }
export async function generate(req: GenerateRequest): Promise<string> {
  return `stub:${req.task}:${req.prompt.length}`;
}
