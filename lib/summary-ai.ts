import "server-only";
import type { z } from "zod";
import { SummarizeRequestSchema, SummarizeResponseSchema } from "@/lib/schemas";
import { DEEPSEEK_MODEL } from "@/lib/ai";

const systemPrompt = `你是一个帮助用户收束思路的助手。用户提供的是一张思维画布中的想法和它们之间的连接。

请严格依据给出的内容整理，不要添加画布里没有的事实。返回严格 JSON 对象，格式为：
{"conclusion":"当前可以得出的阶段性结论","openQuestions":["仍待确认的问题"],"nextAction":"下一步最小且可执行的行动","sourceNodeIds":["支撑结论或行动的想法 ID"],"verifiedEvidence":["仅来自用户标记为已证实的依据"],"unverifiedAssumptions":["来自未验证想法的假设"],"refutedClaims":["仅来自用户标记为已否定的判断"]}

结论应简洁、具体，并体现画布中已经形成的判断；若证据不足，明确保留不确定性。待确认问题可为空，最多 5 条。下一步行动只给一件可以开始做的小事。引用 1–8 个实际提供的想法 ID；不要编造 ID。

completedActions 中的 outcome 是用户记录的真实执行结果或观察；只能依据这些原文讨论行动结果，不得补写、推测或把未完成行动说成已经发生。没有提供的结果必须保持未知。把观察与推论清楚区分。只输出 JSON，不要 Markdown。`;

function verificationGroups(nodes: z.infer<typeof SummarizeRequestSchema>["nodes"]) {
  const format = (text: string, note: string, prefix: string) => `${prefix}${text}${note ? ` · 用户说明：${note}` : ""}`.slice(0, 180);
  return {
    verifiedEvidence: nodes.filter((node) => node.kind !== "question" && node.verification?.status === "confirmed")
      .slice(0, 5).map((node) => format(node.text, node.verification?.note ?? "", "")),
    unverifiedAssumptions: nodes.filter((node) => node.kind !== "question" && (!node.verification || node.verification.status === "unverified"))
      .slice(0, 5).map((node) => format(node.text, node.verification?.note ?? "", "待验证：")),
    refutedClaims: nodes.filter((node) => node.kind !== "question" && node.verification?.status === "refuted")
      .slice(0, 5).map((node) => format(node.text, node.verification?.note ?? "", "已否定：")),
  };
}

export async function summarizeThoughts(input: unknown) {
  const request = SummarizeRequestSchema.parse(input);

  if (process.env.NEXT_PUBLIC_AI_MOCK === "true") {
    const first = request.nodes.find((node) => node.depth === 0) ?? request.nodes[0];
    return {
      ...SummarizeResponseSchema.parse({
      conclusion: `当前思考围绕「${first.text.slice(0, 48)}」展开，接下来可以先验证最关键的假设。`,
      openQuestions: ["什么证据能说明这个方向值得继续？"],
      nextAction: "找一位相关的人聊 15 分钟，确认这个问题是否真实且重要。",
      sourceNodeIds: [first.id],
      }),
      ...verificationGroups(request.nodes),
    };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required when mock mode is disabled");

  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(request) },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const payload: unknown = await response.json();
  const content = (payload as { choices?: { message?: { content?: unknown } }[] })
    .choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI provider returned no message content");

  const result = SummarizeResponseSchema.parse(JSON.parse(content));
  const includedIds = new Set(request.nodes.map((node) => node.id));
  const sourceNodeIds = result.sourceNodeIds.filter((id) => includedIds.has(id));
  if (!sourceNodeIds.length) throw new Error("AI provider returned no valid source references");
  return { ...result, sourceNodeIds, ...verificationGroups(request.nodes) };
}
