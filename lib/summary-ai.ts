import "server-only";
import type { z } from "zod";
import { requestDeepSeekJson } from "@/lib/ai-provider";
import { SUMMARY_SYSTEM_PROMPT } from "@/lib/ai-prompts";
import { SummarizeRequestSchema, SummarizeResponseSchema } from "@/lib/schemas";

type SummaryNodes = z.infer<typeof SummarizeRequestSchema>["nodes"];

function buildVerificationGroups(nodes: SummaryNodes) {
  const factualNodes = nodes.filter((node) => node.kind !== "question");
  const format = (text: string, note: string, prefix = "") =>
    `${prefix}${text}${note ? ` · 用户说明：${note}` : ""}`.slice(0, 180);

  return {
    verifiedEvidence: factualNodes
      .filter((node) => node.verification?.status === "confirmed")
      .slice(0, 5)
      .map((node) => format(node.text, node.verification?.note ?? "")),
    unverifiedAssumptions: factualNodes
      .filter((node) => !node.verification || node.verification.status === "unverified")
      .slice(0, 5)
      .map((node) => format(node.text, node.verification?.note ?? "", "待验证：")),
    refutedClaims: factualNodes
      .filter((node) => node.verification?.status === "refuted")
      .slice(0, 5)
      .map((node) => format(node.text, node.verification?.note ?? "", "已否定：")),
  };
}

function buildMockSummary(nodes: SummaryNodes) {
  const first = nodes.find((node) => node.depth === 0) ?? nodes[0];
  const summary = SummarizeResponseSchema.parse({
    conclusion: `当前思考围绕「${first.text.slice(0, 48)}」展开，接下来可以先验证最关键的假设。`,
    openQuestions: ["什么证据能说明这个方向值得继续？"],
    nextAction: "找一位相关的人聊 15 分钟，确认这个问题是否真实且重要。",
    sourceNodeIds: [first.id],
  });

  return { ...summary, ...buildVerificationGroups(nodes) };
}

export async function summarizeThoughts(input: unknown) {
  const request = SummarizeRequestSchema.parse(input);
  if (process.env.NEXT_PUBLIC_AI_MOCK === "true") return buildMockSummary(request.nodes);

  const result = await requestDeepSeekJson({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    userMessage: request,
    temperature: 0.4,
  }, SummarizeResponseSchema);

  const includedIds = new Set(request.nodes.map((node) => node.id));
  const sourceNodeIds = result.sourceNodeIds.filter((id) => includedIds.has(id));
  if (!sourceNodeIds.length) throw new Error("AI provider returned no valid source references");

  return {
    ...result,
    sourceNodeIds,
    ...buildVerificationGroups(request.nodes),
  };
}
