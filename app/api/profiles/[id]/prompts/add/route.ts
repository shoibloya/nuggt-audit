// app/api/profiles/[id]/prompts/add/route.ts
import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, get, set, child } from "firebase/database";
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
const db = getDatabase();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { category, text } = await req.json();

    if (!category || !text) {
      return NextResponse.json({ success: false, error: "Missing category or text" }, { status: 400 });
    }

    const profileRef = ref(db, `profiles/${id}`);

    // get existing keys in category to assign next index
    const catSnap = await get(child(profileRef, `prompts/${category}`));
    const existing = (catSnap.val() || {}) as Record<string, any>;
    const used = Object.keys(existing)
      .map((k) => parseInt(k, 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
    const nextIndex = used.length ? used[used.length - 1] + 1 : 0;
    const key = String(nextIndex).padStart(2, "0");

    await set(child(profileRef, `prompts/${category}/${key}`), {
      id: key,
      category,
      text: String(text).trim(),
      createdAt: Date.now(),
    });

    const promptId = `${category}:${key}`;

    // kick off SERP for this prompt
    await runSerpForPrompt(id, promptId);

    return NextResponse.json({ success: true, data: { promptId } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
