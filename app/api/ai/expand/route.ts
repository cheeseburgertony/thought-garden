import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { expandThought } from "@/lib/ai";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    return NextResponse.json(await expandThought(body));
  } catch (error) {
    console.error("[api/ai/expand]", error);
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "请求格式不正确，请重新尝试。" }, { status: 400 });
    }
    return NextResponse.json({ error: "这次没有长出来，再试一次。" }, { status: 502 });
  }
}
