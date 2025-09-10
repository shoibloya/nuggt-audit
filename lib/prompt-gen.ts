// lib/prompt-gen.ts
import OpenAI from "openai";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, get, set, update, serverTimestamp, child } from "firebase/database";

type PromptCategory = "brainstorming" | "identified_problem" | "solution_comparing" | "info_seeking";
type PromptSet = Record<PromptCategory, string[]>;

// ───────────────── Firebase init (client SDK via env) ─────────────────
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

// ───────────────── OpenAI (Responses API, plain JSON instruction) ─────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function coerceTen(arr?: string[]) {
  const uniq = Array.from(new Set((arr ?? []).map((s) => s.trim()).filter(Boolean)));
  return uniq.slice(0, 10);
}

function stripCodeFences(s: string) {
  return s
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```?\s*$/i, "")
    .trim();
}

function extractJsonBlock(s: string) {
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return s.slice(first, last + 1);
  }
  return s.trim();
}

function safeParse<T = any>(text: string): T {
  const stripped = stripCodeFences(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const inner = extractJsonBlock(stripped);
    return JSON.parse(inner);
  }
}

const CAT_DEF: Record<PromptCategory, string> = {
  brainstorming: "vague task/guidance exploration before a concrete problem is stated",
  identified_problem: "the ICP has a clear pain stated and is seeking a solution",
  solution_comparing: "comparing alternatives, head-to-head 'vs', pros/cons",
  info_seeking: "neutral research about the product category and how it works",
};

export async function generatePromptsForProfile(profileId: string) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

  const profileRef = ref(db, `profiles/${profileId}`);

  // 1) Load profile + scraped preview
  const snap = await get(profileRef);
  if (!snap.exists()) throw new Error("Profile not found");

  const profile = snap.val() as {
    companyName: string;
    websiteUrl: string;
    remarks?: string;
    scrape?: { markdownPreview?: string; combinedMarkdownPreview?: string };
  };

  const scraped =
    profile.scrape?.markdownPreview ??
    profile.scrape?.combinedMarkdownPreview ??
    "";

  // 2) Mark progress
  await update(profileRef, {
    status: "generating_prompts",
    progress: 55,
    updatedAt: serverTimestamp(),
  });

  const CONTEXT = scraped.slice(0, 120_000);

  const instructions = [
    "You generate short, direct, human search-like prompts for chatbots.",
    "Audience: this company's Ideal Customer Profile (ICP).",
    "Output format rule: return ONLY raw JSON, no code fences, no explanations.",
    "Prompt style: simple, natural, and short (ideally 4–9 words, max 12).",
    "No fluff. No salutations. No hashtags. No emojis.",
    "It must be a query that the ICP will search either for information, to solve a problem, or to compare solutions.",
    "Put yourself in the ICPs shoes and think like the ICP",
    //"Prefer verbs upfront (e.g., 'Compare...', 'How to...', 'Best...').",
    "Avoid brand mentions unless necessary.",
    "Focus on problems, tasks, and comparisons that align with the site's offerings.",
  ].join("\n");

  const jsonShape = `{
  "brainstorming": ["string", "... 10 items total"],
  "identified_problem": ["string", "... 10 items total"],
  "solution_comparing": ["string", "... 10 items total"],
  "info_seeking": ["string", "... 10 items total"]
}`;

  const input = [
    `Company: ${profile.companyName} (${profile.websiteUrl})`,
    profile.remarks ? `Remarks: ${profile.remarks}` : "",
    "Relevant site content (truncated):",
    CONTEXT,
    "",
    "Generate 10 prompts in EACH category below. Keep each prompt short, simple, and natural. Identify the ICP put yourself in their shoes and write the prompts that the ICP will write in the tone that the ICP will write:",
    "- brainstorming = the ICP is asking about how to do something or is seeking guidance on something",
    "- identified_problem = the ICP clearly stated the problem and is seeking a solution",
    "- solution_comparing = head-to-head alternatives, 'vs', pros/cons, best.., the ICP is comparing different solution in the profiles product category",
    "- info_seeking = the ICP is seeking information related to the industry or the broader space",
    "",
    "Return ONLY raw JSON (no markdown fences, no prose) in this exact shape:",
    jsonShape,
  ].join("\n");

  const resp = await openai.responses.create({
    model: "gpt-4.1",
    instructions,
    input,
    temperature: 0.5,
    max_output_tokens: 1200,
  });

  const rawText =
    resp.output_text ||
    (Array.isArray((resp as any).output)
      ? (resp as any).output
          .map((o: any) =>
            o?.content?.map((c: any) => c?.text?.value ?? "").join("") ?? ""
          )
          .join("")
      : "");

  if (!rawText || typeof rawText !== "string") throw new Error("OpenAI returned no text output.");
  const parsed = safeParse<PromptSet>(rawText);

  const result: PromptSet = {
    brainstorming: coerceTen(parsed.brainstorming),
    identified_problem: coerceTen(parsed.identified_problem),
    solution_comparing: coerceTen(parsed.solution_comparing),
    info_seeking: coerceTen(parsed.info_seeking),
  };

  // Persist to RTDB as objects with keys 00..09 (overwrite)
  for (const category of Object.keys(result) as PromptCategory[]) {
    const arr = result[category];
    for (let i = 0; i < arr.length; i++) {
      const key = String(i).padStart(2, "0");
      await set(ref(db, `profiles/${profileId}/prompts/${category}/${key}`), {
        id: key,
        text: arr[i],
        category,
        createdAt: Date.now(),
      });
    }
  }

  await update(profileRef, { progress: 70, updatedAt: serverTimestamp() });

  return {
    counts: Object.fromEntries(
      (Object.keys(result) as PromptCategory[]).map((c) => [c, result[c].length])
    ),
  };
}

/** Generate up to 10 more prompts for one category, using current prompts + optional remarks. */
export async function generateMorePromptsForCategory(
  profileId: string,
  category: PromptCategory,
  count: number,
  remarks?: string
) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  if (count < 1) throw new Error("count must be >= 1");
  if (count > 10) count = 10;

  const profileRef = ref(db, `profiles/${profileId}`);
  const snap = await get(profileRef);
  if (!snap.exists()) throw new Error("Profile not found");

  const profile = snap.val() as {
    companyName: string;
    websiteUrl: string;
    remarks?: string;
  };

  // pull existing prompts in this category
  const catSnap = await get(child(profileRef, `prompts/${category}`));
  const existingObj = (catSnap.val() || {}) as Record<string, { text: string }>;
  const existingList = Object.keys(existingObj)
    .sort()
    .map((k) => existingObj[k].text)
    .filter(Boolean);

  const catDefinition = CAT_DEF[category];

  const instructions = [
    "You generate short, direct, human search-like prompts for chatbots.",
    "Audience: this company's Ideal Customer Profile (ICP).",
    "Output format rule: return ONLY raw JSON, no code fences, no explanations.",
    "Prompt style: simple, natural, and short (ideally 4–9 words, max 12).",
    "No fluff. No salutations. No hashtags. No emojis.",
    "Prefer verbs upfront.",
    "Avoid brand mentions unless necessary.",
  ].join("\n");

  const jsonShape = `{"prompts": ["string", "... ${count} items total"]}`;

  const input = [
    `Company: ${profile.companyName} (${profile.websiteUrl})`,
    remarks ? `Additional remarks: ${remarks}` : "",
    `Category: ${category} — ${catDefinition}`,
    "",
    "Current prompts in this category:",
    ...existingList.map((p) => `- ${p}`),
    "",
    `Generate ${count} NEW prompts for this category that are distinct from the above.`,
    "Return ONLY raw JSON (no markdown fences, no prose) in this shape:",
    jsonShape,
  ].join("\n");

  const resp = await openai.responses.create({
    model: "gpt-4.1",
    instructions,
    input,
    temperature: 0.5,
    max_output_tokens: 600,
  });

  const rawText =
    resp.output_text ||
    (Array.isArray((resp as any).output)
      ? (resp as any).output
          .map((o: any) =>
            o?.content?.map((c: any) => c?.text?.value ?? "").join("") ?? ""
          )
          .join("")
      : "");
  if (!rawText || typeof rawText !== "string") throw new Error("OpenAI returned no text output.");

  const parsed = safeParse<{ prompts: string[] }>(rawText);
  const newPrompts = (parsed.prompts || []).map((s) => s.trim()).filter(Boolean).slice(0, count);

  // compute next keys
  const usedKeys = Object.keys(existingObj)
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  let nextIndex = usedKeys.length ? usedKeys[usedKeys.length - 1] + 1 : 0;

  const createdKeys: string[] = [];
  for (const text of newPrompts) {
    const key = String(nextIndex).padStart(2, "0");
    await set(ref(db, `profiles/${profileId}/prompts/${category}/${key}`), {
      id: key,
      text,
      category,
      createdAt: Date.now(),
    });
    createdKeys.push(`${category}:${key}`);
    nextIndex++;
  }

  return { createdPromptIds: createdKeys };
}
