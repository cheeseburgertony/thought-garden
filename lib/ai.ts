import "server-only";
import { ExpandRequestSchema, ExpandResponseSchema } from "@/lib/schemas";
import { buildSystemPrompt } from "@/lib/ai-prompts";
import { requestDeepSeekJson } from "@/lib/ai-provider";
import { mockExpansionNodes } from "@/lib/ai-mock-data";

export async function expandThought(input: unknown) {
  const request = ExpandRequestSchema.parse(input);

  if (process.env.NEXT_PUBLIC_AI_MOCK === "true") {
    const existing = new Set([
      ...request.children.map((node) => node.text.toLocaleLowerCase()),
      ...request.previousCandidates.map((text) => text.toLocaleLowerCase()),
    ]);
    const nodes = mockExpansionNodes[request.action]
      .filter((node) => !existing.has(node.text.toLocaleLowerCase()))
      .slice(0, 4);
    return ExpandResponseSchema.parse({ nodes });
  }

  const { action, ...context } = request;
  return requestDeepSeekJson({
    systemPrompt: buildSystemPrompt(action),
    userMessage: context,
    temperature: 0.8,
  }, ExpandResponseSchema);
}
