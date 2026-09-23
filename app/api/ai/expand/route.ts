import { NextResponse } from "next/server";
import { expandThought } from "@/lib/ai";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    return NextResponse.json(await expandThought(body));
  } catch (error) {
    console.error("[api/ai/expand]", error);
    return NextResponse.json({ error: "这次没有长出来，再试一次。" }, { status: 502 });
  }
}
