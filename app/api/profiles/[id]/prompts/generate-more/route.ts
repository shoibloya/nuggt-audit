// app/api/profiles/[id]/prompts/generate-more/route.ts
import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, get, child, set } from "firebase/database";
import { generateMorePromptsForCategory } from "@/lib/prompt-gen";
import { runSerpForPrompt } from "@/lib/serp-runner";

// 🔸 Reuse the same logic as /api/volume by importing its POST handler directly
import { POST as volumePOST } from "@/app/api/volume/route";

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

/* ---------- helpers ---------- */
function normalizeSpaces(s: string = "") {
  return s.trim().replace(/\s+/g, " ");
}
function dedupeStrings(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of arr) {
    const k = normalizeSpaces(a.toLowerCase());
    if (!seen.has(k)) {
      seen.add(k);
      out.push(normalizeSpaces(a));
    }
  }
  return out;
}
function resolveLocationCode(profile: any): number {
  const c = String(profile?.country || profile?.region || "").toLowerCase();
  if (c === "singapore" || c === "sg") return 2702;
  return 2840; // USA default
}

/* ---------- route ---------- */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { category, count, remarks } = await req.json();

    if (!category || !count) {
      return NextResponse.json(
        { success: false, error: "Missing category or count" },
        { status: 400 }
      );
    }

    // 1) Generate prompts (writes them into RTDB and returns their ids)
    const { createdPromptIds } = await generateMorePromptsForCategory(
      id,
      category,
      Math.min(10, Number(count)),
      remarks
    );

    if (!createdPromptIds || createdPromptIds.length === 0) {
      return NextResponse.json({ success: true, data: { createdPromptIds: [] } });
    }

    // 2) Load profile + fetch the text of each new prompt so we can compute volume
    const profileRef = ref(db, `profiles/${id}`);
    const profileSnap = await get(profileRef);
    if (!profileSnap.exists()) {
      return NextResponse.json(
        { success: false, error: "Profile not found" },
        { status: 404 }
      );
    }
    const profile = profileSnap.val();
    const location_code = resolveLocationCode(profile);
    const language_name = "English";

    type NewP = { pid: string; cat: string; key: string; text: string };
    const newPrompts: NewP[] = [];
    for (const pid of createdPromptIds as string[]) {
      const [cat, key] = pid.split(":");
      const nodeSnap = await get(child(profileRef, `prompts/${cat}/${key}`));
      const text = String(nodeSnap.val()?.text || "");
      if (text) newPrompts.push({ pid, cat, key, text });
    }

    // 3) Call /api/volume ONCE for all unique texts (server-side, no extra HTTP hop)
    const uniqueKeywords = dedupeStrings(newPrompts.map((p) => p.text));
    if (uniqueKeywords.length > 0) {
      try {
        const volReq = new Request("http://local/api/volume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            keywords: uniqueKeywords,
            language_name,
            location_code,
          }),
        });
        const volRes = await volumePOST(volReq);
        const volJson: any = await volRes.json();

        const byKw = new Map<string, any>(
          (volJson?.items || []).map((it: any) => [normalizeSpaces(it.keyword), it])
        );
        const now = Date.now();

        // 4) Persist the volume under each newly-created prompt
        await Promise.all(
          newPrompts.map(async (np) => {
            const item = byKw.get(normalizeSpaces(np.text));
            await set(child(profileRef, `prompts/${np.cat}/${np.key}/volume`), {
              value: typeof item?.volume === "number" ? item.volume : 0,
              monthly: Array.isArray(item?.monthly) ? item.monthly : [],
              language_name,
              location_code,
              updatedAt: now,
            });
          })
        );
      } catch {
        // On failure, stamp zeros to avoid repeated re-calls
        const now = Date.now();
        await Promise.all(
          newPrompts.map(async (np) => {
            await set(child(profileRef, `prompts/${np.cat}/${np.key}/volume`), {
              value: 0,
              monthly: [],
              language_name,
              location_code,
              updatedAt: now,
            });
          })
        );
      }
    }

    // 5) Run SERP ONLY for the newly created prompts
    for (const pid of createdPromptIds) {
      await runSerpForPrompt(id, pid);
    }

    return NextResponse.json({ success: true, data: { createdPromptIds } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
