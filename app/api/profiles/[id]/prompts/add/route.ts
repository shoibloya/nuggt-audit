// app/api/profiles/[id]/prompts/add/route.ts
import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, get, set, child } from "firebase/database";
import { runSerpForPrompt } from "@/lib/serp-runner";

// 🔸 reuse the same logic as /api/volume by importing its handler directly
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

// ---- helpers
function resolveLocationCode(profile: any): number {
  const c = String(profile?.country || profile?.region || "").toLowerCase();
  if (c === "singapore" || c === "sg") return 2702;
  return 2840; // USA default
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { category, text } = await req.json();

    if (!category || !text) {
      return NextResponse.json(
        { success: false, error: "Missing category or text" },
        { status: 400 }
      );
    }

    const profileRef = ref(db, `profiles/${id}`);

    // Load profile and current category to compute key + locale
    const [profileSnap, catSnap] = await Promise.all([
      get(profileRef),
      get(child(profileRef, `prompts/${category}`)),
    ]);
    if (!profileSnap.exists()) {
      return NextResponse.json(
        { success: false, error: "Profile not found" },
        { status: 404 }
      );
    }
    const profile = profileSnap.val();
    const location_code = resolveLocationCode(profile);
    const language_name = "English";

    // Assign next key in the category (00, 01, 02, …)
    const existing = (catSnap.val() || {}) as Record<string, any>;
    const used = Object.keys(existing)
      .map((k) => parseInt(k, 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
    const nextIndex = used.length ? used[used.length - 1] + 1 : 0;
    const key = String(nextIndex).padStart(2, "0");

    // Create the prompt row
    const promptPath = `prompts/${category}/${key}`;
    await set(child(profileRef, promptPath), {
      id: key,
      category,
      text: String(text).trim(),
      createdAt: Date.now(),
    });

    // ----- CALL /api/volume (server-side) and persist under this prompt
    try {
      const volReq = new Request("http://local/api/volume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keywords: [String(text).trim()],
          language_name,
          location_code,
        }),
      });
      const volRes = await volumePOST(volReq);
      const volJson: any = await volRes.json();
      const item = volJson?.items?.[0];

      // Always write something so we don't re-hit the endpoint on next load
      await set(child(profileRef, `${promptPath}/volume`), {
        value: typeof item?.volume === "number" ? item.volume : 0,
        monthly: Array.isArray(item?.monthly) ? item.monthly : [],
        language_name,
        location_code,
        updatedAt: Date.now(),
      });
    } catch {
      // Fallback: write zero volume on failure
      await set(child(profileRef, `${promptPath}/volume`), {
        value: 0,
        monthly: [],
        language_name,
        location_code,
        updatedAt: Date.now(),
      });
    }

    const promptId = `${category}:${key}`;

    // Run SERP ONLY for this new prompt
    await runSerpForPrompt(id, promptId);

    return NextResponse.json({ success: true, data: { promptId } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
