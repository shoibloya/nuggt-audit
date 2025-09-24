// app/api/volume/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** -------- Types -------- */
type ReqBody = {
  keywords: string[];
  language_name?: string; // default "English"
  location_code?: number; // default 2840 (USA) - pass 2702 for Singapore
};

type DFSItem = {
  keyword: string;
  ai_search_volume?: number;
  ai_monthly_searches?: { year: number; month: number; ai_search_volume: number }[];
};

type VolumeItem = {
  keyword: string;
  volume: number;
  monthly: { year: number; month: number; ai_search_volume: number }[];
};

type ExpansionItem = {
  original: string;
  core_terms: string[]; // 1–2 essential lemmatized terms
  variants: string[];   // <= ~8 variants; 1–3 words; must include all core_terms
};

export async function POST(req: Request) {
  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { keywords, language_name = "English", location_code = 2840 } = body || {};
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ error: "`keywords` must be a non-empty array" }, { status: 400 });
  }

  console.log(location_code);

  const wanted = dedupeStrings(keywords).map(normalizeSpaces);

  /** 1) DataForSEO call */
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    return NextResponse.json(
      { error: "Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD environment variables" },
      { status: 500 }
    );
  }

  const first = await fetchDFS(login, password, {
    language_name,
    location_code,
    keywords: wanted,
  });

  if (first.err) {
    const items = wanted.map((kw) => ({ keyword: kw, volume: 0, monthly: [] }));
    const payload = first.err?.error ? { error: first.err.error, items } : { items };
    return NextResponse.json(payload, { status: first.status ?? 502 });
  }

  const byKwFirst = new Map(first.items!.map(i => [normalizeSpaces(i.keyword), i]));
  const results: Map<string, VolumeItem> = new Map();
  const zeros: string[] = [];

  for (const kw of wanted) {
    const rec = byKwFirst.get(normalizeSpaces(kw));
    const vol = rec?.ai_search_volume ?? 0;
    const monthly = (rec?.ai_monthly_searches ?? []) as VolumeItem["monthly"];
    if (vol > 0) {
      results.set(kw, { keyword: kw, volume: vol, monthly });
    } else {
      zeros.push(kw);
    }
  }

  /** 2) Optional LLM expansion for zeros (still NO caching) */
  if (zeros.length > 0 && process.env.OPENAI_API_KEY) {
    const expansions = await expandWithLLM(zeros);
    if (expansions) {
      const expMap = new Map<string, ExpansionItem>();
      for (const item of expansions) {
        const uniqVariants = dedupeStrings([
          ...item.variants,
          item.core_terms.join(" "),
        ])
          .map(v => v.toLowerCase())
          .filter(v => v.split(/\s+/).length <= 3)
          .slice(0, 10);
        expMap.set(item.original, { original: item.original, core_terms: item.core_terms, variants: uniqVariants });
      }

      const allVariants = dedupeStrings(zeros.flatMap(z => expMap.get(z)?.variants ?? []));
      if (allVariants.length > 0) {
        const second = await fetchDFS(login, password, {
          language_name,
          location_code,
          keywords: allVariants,
        });

        if (!second.err) {
          const byKwSecond = new Map(second.items!.map(i => [normalizeSpaces(i.keyword), i]));
          for (const original of zeros) {
            const exp = expMap.get(original);
            if (!exp || exp.variants.length === 0) {
              results.set(original, { keyword: original, volume: 0, monthly: [] });
              continue;
            }
            const candidates: { v: string; vol: number; monthly: VolumeItem["monthly"] }[] = [];
            for (const v of exp.variants) {
              const rec = byKwSecond.get(normalizeSpaces(v));
              if (rec) {
                const vol = rec.ai_search_volume ?? 0;
                if (vol > 0) {
                  candidates.push({
                    v,
                    vol,
                    monthly: (rec.ai_monthly_searches ?? []) as VolumeItem["monthly"],
                  });
                }
              }
            }
            if (candidates.length === 0) {
              results.set(original, { keyword: original, volume: 0, monthly: [] });
            } else {
              const vols = candidates.map(c => c.vol).sort((a, b) => a - b);
              const maxVol = vols[vols.length - 1];
              const medianVol = vols[Math.floor((vols.length - 1) / 2)];
              const estimated = Math.round(0.85 * maxVol + 0.15 * medianVol);
              const best = candidates.reduce((a, b) => (a.vol >= b.vol ? a : b));
              results.set(original, {
                keyword: original,
                volume: estimated,
                monthly: best.monthly,
              });
            }
          }
        } else {
          zeros.forEach(z => results.set(z, { keyword: z, volume: 0, monthly: [] }));
        }
      } else {
        zeros.forEach(z => results.set(z, { keyword: z, volume: 0, monthly: [] }));
      }
    } else {
      zeros.forEach(z => results.set(z, { keyword: z, volume: 0, monthly: [] }));
    }
  } else if (zeros.length > 0) {
    zeros.forEach(z => results.set(z, { keyword: z, volume: 0, monthly: [] }));
  }

  const items = wanted.map(kw => results.get(kw) || ({ keyword: kw, volume: 0, monthly: [] }));
  return NextResponse.json({ items }, { status: 200 });
}

/* ------------------------- Helpers ------------------------- */

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

async function fetchDFS(
  login: string,
  password: string,
  payload: { language_name: string; location_code: number; keywords: string[] }
): Promise<{ items?: DFSItem[]; err?: any; status?: number }> {
  try {
    const postArray = [
      {
        language_name: payload.language_name,
        location_code: payload.location_code,
        keywords: payload.keywords,
      },
    ];

    const resp = await fetch(
      "https://api.dataforseo.com/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Basic " + Buffer.from(`${login}:${password}`).toString("base64"),
        },
        body: JSON.stringify(postArray),
      }
    );

    const rawText = await resp.text();
    let json: any;
    try {
      json = JSON.parse(rawText);
    } catch {
      return { err: { error: "DataForSEO returned non-JSON response", raw: rawText }, status: 502 };
    }

    if (!resp.ok) {
      return { err: { error: "DataForSEO error response", details: json }, status: resp.status };
    }

    const items: DFSItem[] = json?.tasks?.[0]?.result?.[0]?.items ?? [];
    return { items };
  } catch (err: any) {
    return { err: { error: err?.message ?? "Unknown server error" }, status: 500 };
  }
}

/* -------------------- LLM Expansion (Responses API) -------------------- */
async function expandWithLLM(originals: string[]): Promise<ExpansionItem[] | null> {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const instructions = [
      "You are an SEO keyword distiller for DataForSEO's AI Search Volume metric.",
      "Goal: turn each prompt into compact keyword variants that reflect how people ask AI tools,",
      "while respecting DataForSEO matching (AI questions must contain all words from the keyword).",
      "",
      "For each prompt:",
      "- Pick 1–2 essential, lemmatized core terms (nouns or short noun phrases).",
      "- Generate up to 8 keyword variants, each 1–3 words, lowercase, no punctuation.",
      "- EVERY variant must include ALL core terms (order can vary).",
      "- Prefer head terms + one modifier. Avoid stopwords.",
      "- Examples: 'ecommerce features', 'ecommerce ux', 'shopify plus migration', 'seo benefits'.",
      "",
      "Return ONLY JSON (no code fences).",
      'Format: {"items":[{"original":"<prompt>","core_terms":["term1","term2"],"variants":["term1 term2","term2 term1",...]}, ...]}',
    ].join("\n");

    const userText = JSON.stringify({ prompts: originals }, null, 2);
    const response = await client.responses.create({
      model: "gpt-4.1",
      temperature: 0,
      instructions,
      input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
    });

    let text = (response as any).output_text as string | undefined;
    if (!text) {
      try {
        const firstMsg: any = response.output?.[0];
        const firstText = firstMsg?.content?.find((c: any) => c.type === "output_text")?.text as string | undefined;
        text = firstText?.trim();
      } catch {}
    }
    if (!text) return null;

    let parsed: { items: ExpansionItem[] } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}$/);
      if (m) parsed = JSON.parse(m[0]);
    }
    if (!parsed || !Array.isArray(parsed.items)) return null;

    const cleaned: ExpansionItem[] = parsed.items.map((it) => {
      const core = (it.core_terms || [])
        .map((t: string) => sanitizeTerm(t))
        .filter(Boolean)
        .slice(0, 2);

      const variants = dedupeStrings(
        (it.variants || [])
          .map((v: string) => sanitizeVariant(v))
          .filter(Boolean)
          .filter((v: string) => includesAllCoreTerms(v, core))
          .filter((v: string) => v.split(/\s+/).length <= 3)
      ).slice(0, 10);

      if (variants.length === 0 && core.length > 0) {
        variants.push(core.join(" "));
      }

      return {
        original: it.original ?? "",
        core_terms: core,
        variants,
      };
    });

    return cleaned;
  } catch {
    return null;
  }
}

function sanitizeTerm(s: string) {
  return s?.toLowerCase()?.replace(/[^a-z0-9\s]+/g, "")?.trim() ?? "";
}
function sanitizeVariant(s: string) {
  return s?.toLowerCase()?.replace(/[^a-z0-9\s]+/g, "")?.replace(/\s+/g, " ")?.trim() ?? "";
}
function includesAllCoreTerms(variant: string, core: string[]) {
  const vTokens = new Set(variant.split(/\s+/).filter(Boolean));
  return core.every((t) => vTokens.has(t));
}
