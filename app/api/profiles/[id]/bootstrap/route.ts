// app/api/profiles/[id]/bootstrap/route.ts
import { NextRequest, NextResponse } from "next/server";
import Firecrawl from "@mendable/firecrawl-js";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, get, update, serverTimestamp } from "firebase/database";
import { generatePromptsForProfile } from "@/lib/prompt-gen";
import { runSerpChecksForProfile } from "@/lib/serp-runner";

export const runtime = "nodejs";

const firebaseApp =
  getApps().length
    ? getApps()[0]
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
      });
const db = getDatabase(firebaseApp);

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const profileRef = ref(db, `profiles/${id}`);

  try {
    if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is not set");

    // Load profile
    const snap = await get(profileRef);
    if (!snap.exists()) {
      return NextResponse.json({ success: false, error: "Profile not found" }, { status: 404 });
    }
    const profile = snap.val() as { websiteUrl: string; companyName?: string };

    // Mark scraping
    await update(profileRef, { status: "scraping", progress: 25, updatedAt: serverTimestamp() });

    // SCRAPE (single page)
    const doc: any = await firecrawl.scrape(profile.websiteUrl, { formats: ["markdown", "html"] });
    const markdown: string = doc?.markdown ?? doc?.data?.markdown ?? "";
    const html: string | undefined = doc?.html ?? doc?.data?.html;

    // Log full markdown to server console
    console.log(`──── Firecrawl SCRAPE for ${profile.websiteUrl} ────\n`);
    console.log(markdown);

    // Save preview
    await update(profileRef, {
      scrape: {
        url: profile.websiteUrl,
        markdownPreview: markdown.slice(0, 10000),
        markdownBytes: Buffer.byteLength(markdown, "utf8"),
        htmlPreview: html ? String(html).slice(0, 5000) : undefined,
        scrapedAt: Date.now(),
      },
      progress: 45,
      updatedAt: serverTimestamp(),
    });

    // Generate prompts (Responses API)
    await generatePromptsForProfile(id);

    // Run SERP checks (Google + Bing via SerpAPI) — updates RTDB per-prompt with status "checking"/"done"
    await runSerpChecksForProfile(id);

    // Let the SERP runner own final status/progress; just return success here.
    return NextResponse.json({ success: true, data: { message: "Scrape + prompts + SERP started/completed." } });
  } catch (err: any) {
    console.error("Bootstrap error (pipeline):", err);
    await update(profileRef, {
      status: "error",
      lastError: String(err?.message ?? err),
      updatedAt: serverTimestamp(),
    });
    return NextResponse.json({ success: false, error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
