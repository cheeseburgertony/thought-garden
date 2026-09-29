import "server-only";
import type { ZodType } from "zod";

const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";

type JsonCompletion = {
  systemPrompt: string;
  userMessage: unknown;
  temperature: number;
};

function getMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;

  const choice = choices[0];
  if (!choice || typeof choice !== "object") return null;
  const message = (choice as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;

  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export async function requestDeepSeekJson<T>(
  completion: JsonCompletion,
  responseSchema: ZodType<T>,
): Promise<T> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required when mock mode is disabled");

  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: completion.temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: completion.systemPrompt },
        { role: "user", content: JSON.stringify(completion.userMessage) },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }
  const content = getMessageContent(payload);
  if (!content) throw new Error("AI provider returned no message content");

  let output: unknown;
  try {
    output = JSON.parse(content);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }

  const parsed = responseSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(`AI provider response failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
