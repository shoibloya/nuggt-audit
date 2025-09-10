// app/api/profiles/[id]/generate-prompts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generatePromptsForProfile } from "@/lib/prompt-gen";
import { initializeApp, getApps } from "firebase/app";

// Ensure Firebase is initialized in this route's process too
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

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const data = await generatePromptsForProfile(id);
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
