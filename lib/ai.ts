import "server-only";
import { ExpandRequestSchema, ExpandResponseSchema } from "@/lib/schemas";
import type { ThoughtAction } from "@/lib/types";
import { buildSystemPrompt } from "@/lib/ai-prompts";

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";

const mockNodes: Record<ThoughtAction, { text: string; kind: "idea" | "question" | "insight" | "risk" | "challenge" }[]> = {
  expand: [
    { text: "谁会最频繁地遇到这个问题？", kind: "question" },
    { text: "目前人们怎么解决它？", kind: "question" },
    { text: "AI 在这里能带来什么独特价值？", kind: "question" },
    { text: "最小可验证的产品是什么？", kind: "idea" },
  ],
  deep: [
    { text: "这个问题通常在什么情境下发生？", kind: "question" },
    { text: "最让人困扰的具体环节是什么？", kind: "question" },
    { text: "现有替代方案为什么不够好？", kind: "question" },
    { text: "怎样验证它真的重要？", kind: "question" },
  ],
  challenge: [
    { text: "用户为什么不直接用现有工具？", kind: "challenge" },
    { text: "这个需求是否足够高频？", kind: "challenge" },
    { text: "去掉 AI 后，核心价值还成立吗？", kind: "challenge" },
    { text: "什么证据会证明这个假设是错的？", kind: "challenge" },
  ],
  risk: [
    { text: "用户是否愿意持续为它付费？", kind: "risk" },
    { text: "推理成本会不会高于单用户收入？", kind: "risk" },
    { text: "关键数据是否能安全获得和处理？", kind: "risk" },
    { text: "成熟平台能否快速复制这个功能？", kind: "risk" },
  ],
  perspective: [
    { text: "从第一次使用的用户角度看，哪里会困惑？", kind: "question" },
    { text: "从投资人的角度，增长空间在哪里？", kind: "question" },
    { text: "从工程师角度，最难验证的部分是什么？", kind: "question" },
    { text: "三年后，这个问题会变得更重要吗？", kind: "question" },
  ],
};

export async function expandThought(input: unknown) {
  const request = ExpandRequestSchema.parse(input);
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

  if (process.env.NEXT_PUBLIC_AI_MOCK === "true") {
    const existing = new Set(request.children.map((text) => text.toLocaleLowerCase()));
    const candidates = mockNodes[request.action].filter((node) => !existing.has(node.text.toLocaleLowerCase()));
    const nodes = (candidates.length >= 2 ? candidates : mockNodes[request.action]).slice(0, 4);
    return ExpandResponseSchema.parse({ nodes });
  }

  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required when mock mode is disabled");

  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(request.action) },
        { role: "user", content: JSON.stringify({
          current: request.current,
          parent: request.parent,
          siblings: request.siblings,
          children: request.children,
        }) },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const payload: unknown = await response.json();
  const content = (payload as { choices?: { message?: { content?: unknown } }[] })
    .choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI provider returned no message content");
  return ExpandResponseSchema.parse(JSON.parse(content));
}
