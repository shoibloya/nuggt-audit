// app/api/profiles/[id]/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, get, set, child } from "firebase/database";
import OpenAI from "openai";

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
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { promptId } = await req.json();
    if (!promptId) {
      return NextResponse.json({ success: false, error: "Missing promptId" }, { status: 400 });
    }

    const profileRef = ref(db, `profiles/${id}`);
    const profSnap = await get(profileRef);
    if (!profSnap.exists()) {
      return NextResponse.json({ success: false, error: "Profile not found" }, { status: 404 });
    }
    const profile = profSnap.val() as {
      companyName: string;
      websiteUrl: string;
      competitorUrls?: string[];
    };

    const [category, key] = String(promptId).split(":");
    const pSnap = await get(child(profileRef, `prompts/${category}/${key}`));
    if (!pSnap.exists()) {
      return NextResponse.json({ success: false, error: "Prompt not found" }, { status: 404 });
    }
    const promptText = (pSnap.val() as any)?.text as string;

    const rSnap = await get(child(profileRef, `results/${promptId}`));
    const results = rSnap.val() || {};
    const g = results.google || {};
    const b = results.bing || {};

    const competitors = (profile.competitorUrls || []).join(", ") || "None provided";

    const instructions = [
      "You are a strategic content & SEO/GEO analyst.",
      "Create an opportunity report based on one search prompt and its SERP presence on Google and Bing.",
      "Be concise but insightful; use markdown headings and bullet points.",
      "",
      "Sections to include:",
      "1) Summary of the prompt intent and ICP needs",
      "2) Where the company's site shines today (with examples from top results if present)",
      "3) Where competitors shine (by name/domain) and why",
      "4) Opportunity gaps: concrete angles where the company can win",
      "5) Content plan: many blog/article ideas with short outlines (H2s/bullets), tailored to win the above gaps",
      "6) Quick wins vs. longer plays",
      "",
      "Tone: practical, specific, and actionable.",
    ].join("\n");

    const input = [
      `Company: ${profile.companyName} (${profile.websiteUrl})`,
      `Prompt: ${promptText}`,
      "",
      "Google Top 10 URLs:",
      ...(Array.isArray(g.top10) ? g.top10.map((u: string, i: number) => `${i + 1}. ${u}`) : ["(none)"]),
      "",
      "Bing Top 10 URLs:",
      ...(Array.isArray(b.top10) ? b.top10.map((u: string, i: number) => `${i + 1}. ${u}`) : ["(none)"]),
      "",
      `Company present on Google page 1: ${g.hasCompany ? "Yes" : "No"}`,
      `Company present on Bing page 1: ${b.hasCompany ? "Yes" : "No"}`,
      "",
      `Competitors list: ${competitors}`,
      `Competitors appearing (Google): ${(g.competitorsHit || []).join(", ") || "none"}`,
      `Competitors appearing (Bing): ${(b.competitorsHit || []).join(", ") || "none"}`,
      "",
      "Write the report in markdown.",
    ].join("\n");

    const resp = await openai.responses.create({
      model: "gpt-4.1",
      instructions,
      input,
      temperature: 0.6,
      max_output_tokens: 1800,
    });

    const markdown =
      resp.output_text ||
      (Array.isArray((resp as any).output)
        ? (resp as any).output
            .map((o: any) =>
              o?.content?.map((c: any) => c?.text?.value ?? "").join("") ?? ""
            )
            .join("")
        : "");

    await set(child(profileRef, `reports/${promptId}`), {
      promptId,
      prompt: promptText,
      markdown,
      createdAt: Date.now(),
    });

    return NextResponse.json({ success: true, data: { promptId } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
