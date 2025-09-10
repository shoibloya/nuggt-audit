// app/api/profiles/[id]/prompts/generate-more/route.ts
import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase } from "firebase/database";
import { generateMorePromptsForCategory } from "@/lib/prompt-gen";
import { runSerpForPrompt } from "@/lib/serp-runner";

export const runtime = "nodejs";

if (!getApps().length) {
  initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  });
}
getDatabase(); // ensure RTDB is initialized in this lambda

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { category, count, remarks } = await req.json();

    if (!category || !count) {
      return NextResponse.json({ success: false, error: "Missing category or count" }, { status: 400 });
    }

    const { createdPromptIds } = await generateMorePromptsForCategory(id, category, Math.min(10, Number(count)), remarks);

    // run SERP for each new prompt
    for (const pid of createdPromptIds) {
      await runSerpForPrompt(id, pid);
    }

    return NextResponse.json({ success: true, data: { createdPromptIds } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
