// app/api/profiles/[id]/serp/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runSerpChecksForProfile } from "@/lib/serp-runner";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const data = await runSerpChecksForProfile(id);
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
