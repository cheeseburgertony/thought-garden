import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { summarizeThoughts } from "@/lib/summary-ai";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    return NextResponse.json(await summarizeThoughts(body));
  } catch (error) {
    console.error("[api/ai/summarize]", error);
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "整理内容格式不正确，请重新选择想法。" }, { status: 400 });
    }
    return NextResponse.json({ error: "暂时无法整理这张画布，请稍后重试。" }, { status: 502 });
  }
}
