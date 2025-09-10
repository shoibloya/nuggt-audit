// app/api/profiles/[id]/report/overall/route.ts
import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import {
  getDatabase,
  ref,
  get,
  set,
  child,
} from "firebase/database";
import OpenAI from "openai";

export const runtime = "nodejs";

// Init Firebase (client SDK env keys)
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

// ---------- Types ----------
type PromptCategory = "brainstorming" | "identified_problem" | "solution_comparing" | "info_seeking";

type EngineResult = {
  status?: "checking" | "done" | "error";
  top10?: string[];
  hasCompany?: boolean;
  competitorsHit?: string[];
};

type PromptResult = {
  google?: EngineResult; // used as Perplexity + Google AI Overview
  bing?: EngineResult;   // used as ChatGPT
};

type PromptItem = {
  id: string;            // "category:key"
  text: string;
  category: PromptCategory;
};

type LlmClusters = Array<{
  title: string;
  icon?: "building" | "shield" | "code" | "search" | "alert" | "file" | string;
  items: string[]; // promptIds
}>;

type LlmInsights = {
  strengths: string[];
  weaknesses: string[];
  competitiveNarrative?: string;
  categoryNarrative?: Partial<Record<PromptCategory, string>>;
};

// ---------- Helpers ----------
function stripCodeFences(s: string) {
  return s.replace(/^\s*```(?:json)?/i, "").replace(/```?\s*$/i, "").trim();
}
function extractJsonBlock(s: string) {
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return s.slice(first, last + 1);
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

const CAT_WEIGHT: Record<PromptCategory, number> = {
  brainstorming: 1.0,
  identified_problem: 1.3,
  solution_comparing: 1.7,
  info_seeking: 0.9,
};

const CAT_REASON: Record<PromptCategory, string> = {
  brainstorming: "Awareness/early exploration; useful for seeding LLM citations but lower immediate revenue intent.",
  identified_problem: "Mid-funnel urgency; users need fixes or a plan, closer to solution discovery.",
  solution_comparing: "Bottom-funnel evaluation; highest buying intent and fastest revenue signal.",
  info_seeking: "Category education and definitions; supports authority signals for LLMs.",
};

function toPct(n: number, d: number) {
  if (!d) return 0;
  return n / d;
}

function shortLabel(s: string, max = 64) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ===== BLOG outline generator (category-aware; no LLM) =====
function outlineFor(category: PromptCategory, promptText: string) {
  // universal blog scaffolding helpers
  const commonTop = (h1: string) => ([
    `H1: ${h1}`,
    "Hook: 2–3 lines framing the pain or decision.",
    "TL;DR: one-paragraph answer a busy reader can act on.",
    "Reader fit: who this is for / when to use / when not to use.",
  ]);

  switch (category) {
    case "solution_comparing": {
      // Blog: X vs Y vs Us (decision blog)
      return {
        artifactType: "blog_post" as const,
        steps: [
          ...commonTop(`${
            promptText.length > 80 ? "Comparison Guide" : promptText
          }`),
          "Evaluation criteria: cost, time-to-value, scalability, security/compliance, integrations, support.",
          "Quick verdict: 3–5 bullets with who-should-choose-what.",
          "Side-by-side comparison (table embedded in blog).",
          "Deep dives per option: strengths, tradeoffs, pitfalls.",
          "Decision checklist: must-haves vs nice-to-haves.",
          "Total cost & ROI considerations (simple example).",
          "Implementation notes & risks (and how to mitigate).",
          "FAQ: 5–7 buyer questions answered succinctly.",
          "CTA: next steps (trial, demo, migration playbook).",
          "Citations to standards and credible sources; add JSON-LD for key facts.",
        ],
        sections: [
          { heading: "Quick Verdict", bullets: ["Who should choose A/B/Us", "Top 3 tradeoffs to know"] },
          { heading: "Decision Criteria", bullets: ["Cost", "Time-to-value", "Scalability", "Security/Compliance", "Integrations", "Support"] },
          { heading: "Side-by-Side", bullets: ["Comparison table inline", "Pros/Cons, 'Best for', 'Not ideal for'"] },
          { heading: "ROI & Risk", bullets: ["Simple ROI example", "Key risks & mitigations"] },
          { heading: "FAQ", bullets: ["Budget fit?", "Migration effort?", "Vendor lock-in?", "Security posture?"] },
          { heading: "Citations & Schema", bullets: ["External standards", "JSON-LD for facts"] },
        ],
      };
    }

    case "identified_problem": {
      // Blog: How to fix/solve {problem} (troubleshooting blog)
      return {
        artifactType: "blog_post" as const,
        steps: [
          ...commonTop(`${
            promptText.startsWith("How ") || promptText.startsWith("Fix ") ? promptText : `How to solve: ${promptText}`
          }`),
          "Symptoms & diagnostics: what to check and how to confirm.",
          "Root causes: likely causes ranked by likelihood/impact.",
          "Remediation steps: numbered sequence with validation gates.",
          "Edge cases & rollback plan.",
          "Monitoring & prevention controls.",
          "Team ownership & escalation path.",
          "FAQ: practical snags and real-world nuances.",
          "Citations & JSON-LD for canonical facts.",
          "CTA: tool/scripts, template download, or contact path.",
        ],
        sections: [
          { heading: "Symptoms & Diagnostics", bullets: ["Observable signs", "Checks", "Expected results"] },
          { heading: "Root Causes", bullets: ["Cause 1 → Fix", "Cause 2 → Fix", "Prerequisites & caveats"] },
          { heading: "Step-by-Step Fix", bullets: ["Numbered steps", "Validation gates"] },
          { heading: "Prevention", bullets: ["Monitors", "Runbooks", "SLAs & ownership"] },
          { heading: "FAQ", bullets: ["What if X fails?", "How to roll back safely?"] },
        ],
      };
    }

    case "brainstorming": {
      // Blog: How to / frameworks (ideation blog)
      return {
        artifactType: "blog_post" as const,
        steps: [
          ...commonTop(`${
            promptText.startsWith("How ") ? promptText : `How to: ${promptText}`
          }`),
          "Approach patterns: 3–5 frameworks with pros/cons.",
          "Choose a recommended path (and why).",
          "Detailed walkthrough: numbered, copy-pastable steps.",
          "Examples & templates (inputs/outputs).",
          "Pitfalls, constraints, and guardrails.",
          "Advanced tips & extensions.",
          "FAQ: edge questions a practitioner might ask.",
          "Citations & JSON-LD where appropriate.",
          "CTA: template pack, checklist, or starter repo.",
        ],
        sections: [
          { heading: "Approach Patterns", bullets: ["Pattern A", "Pattern B", "Pattern C"] },
          { heading: "Recommended Path", bullets: ["Why this works", "Prerequisites"] },
          { heading: "Step-by-Step", bullets: ["Actionable steps 1..N"] },
          { heading: "Examples & Templates", bullets: ["Sample inputs/outputs", "Download links"] },
          { heading: "Pitfalls & Constraints", bullets: ["Common mistakes", "When not to use"] },
          { heading: "FAQ", bullets: ["Best practice for X?", "What about Y scale?"] },
        ],
      };
    }

    case "info_seeking":
    default: {
      // Blog: What is / best practices (definition + guidance blog)
      return {
        artifactType: "blog_post" as const,
        steps: [
          ...commonTop(`${
            promptText.toLowerCase().startsWith("what is") ? promptText : `What is ${promptText}?`
          }`),
          "Definition: precise, unambiguous 2–3 sentences.",
          "Why it matters: concrete outcomes and stakes.",
          "Key concepts & relationships (short sections).",
          "Standards, formats, or equations if relevant.",
          "Best practices & common mistakes.",
          "Mini-FAQ (5–7 practical Q&As).",
          "Citations; add JSON-LD (Thing/DefinedTerm) for facts.",
          "CTA: deeper guide, glossary hub, or tutorial path.",
        ],
        sections: [
          { heading: "Definition", bullets: ["Short, precise explanation", "Context in the stack"] },
          { heading: "Why It Matters", bullets: ["Outcomes", "Risks of ignoring"] },
          { heading: "Key Concepts", bullets: ["Concept A", "Concept B", "How they relate"] },
          { heading: "Standards & Formats", bullets: ["Standards A/B", "Interoperability notes"] },
          { heading: "Best Practices & Mistakes", bullets: ["Do's", "Don'ts"] },
          { heading: "FAQ", bullets: ["When to use?", "How to evaluate?"] },
        ],
      };
    }
  }
}

// ---------- Route ----------
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    // Load profile
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

    // Load prompts
    const promptsSnap = await get(child(profileRef, "prompts"));
    const promptsVal = promptsSnap.val() || {};

    // Flatten prompts
    const prompts: PromptItem[] = [];
    (["brainstorming", "identified_problem", "solution_comparing", "info_seeking"] as PromptCategory[]).forEach(
      (cat) => {
        const items = promptsVal?.[cat] || {};
        Object.entries(items).forEach(([k, v]: [string, any]) => {
          prompts.push({ id: `${cat}:${k}`, text: v?.text ?? "", category: cat });
        });
      }
    );

    // Read SERP results (already computed elsewhere)
    const resultSnap = await get(child(profileRef, "results"));
    const resultsVal = (resultSnap.exists() ? resultSnap.val() : {}) as Record<string, PromptResult>;

    // ---------- Compute metrics (numbers only, no LLM) ----------
    type Computed = {
      promptId: string;
      prompt: string;
      category: PromptCategory;
      googleHas: boolean;    // treated as Perplexity + Google AI Overview
      bingHas: boolean;      // treated as ChatGPT
      competitorDomains: string[];
      competitorHitsCount: number;
      presenceScore: number;           // 2*googleHas + 1.2*bingHas
      missingPresence: number;         // 2 - presenceScore (>=0)
      competitorPressure: number;      // min(1, competitorHits/4)
      categoryWeight: number;
      opportunityScore: number;        // Missing * (1 + 0.6*Pressure) * Weight
      channels: { chatgpt: boolean; perplexity: boolean; googleAIO: boolean };
    };

    const computed: Computed[] = [];

    for (const p of prompts) {
      const r = resultsVal?.[p.id] || {};
      const g = r.google || {};
      const b = r.bing || {};

      const googleHas = !!g.hasCompany;
      const bingHas = !!b.hasCompany;

      const gHits = Array.isArray(g.competitorsHit) ? g.competitorsHit : [];
      const bHits = Array.isArray(b.competitorsHit) ? b.competitorsHit : [];
      const competitorDomains = Array.from(new Set([...gHits, ...bHits]));
      const competitorHitsCount = competitorDomains.length;

      const presenceScore = (googleHas ? 2 : 0) + (bingHas ? 1.2 : 0);
      const missingPresence = Math.max(0, 2 - presenceScore);
      const competitorPressure = Math.min(1, competitorHitsCount / 4);
      const categoryWeight = CAT_WEIGHT[p.category];
      const opportunityScore = +(missingPresence * (1 + 0.6 * competitorPressure) * categoryWeight).toFixed(3);

      computed.push({
        promptId: p.id,
        prompt: p.text,
        category: p.category,
        googleHas,
        bingHas,
        competitorDomains,
        competitorHitsCount,
        presenceScore,
        missingPresence,
        competitorPressure,
        categoryWeight,
        opportunityScore,
        channels: {
          chatgpt: bingHas,                   // rename Bing -> ChatGPT
          perplexity: googleHas,              // our mapping: Google -> Perplexity
          googleAIO: googleHas,               // also show as Google AI Overview
        },
      });
    }

    const total = computed.length || 1;

    // Share of Voice: at least one channel present
    const sov = toPct(
      computed.filter(c => c.googleHas || c.bingHas).length,
      total
    );

    // Whitespace: nobody (you or competitors) appears
    const whiteSpacePct = toPct(
      computed.filter(c => !c.googleHas && !c.bingHas && c.competitorHitsCount === 0).length,
      total
    );

    // Competitor Pressure Index: avg competitorPressure across prompts
    const competitorPressureIdx =
      computed.reduce((s, c) => s + c.competitorPressure, 0) / total;

    // Top money prompts (highest opportunityScore)
    const topMoneyPrompts = [...computed]
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 5)
      .map(c => ({
        promptId: c.promptId,
        prompt: c.prompt,
        category: c.category,
        opportunityScore: c.opportunityScore,
      }));

    // Category summaries
    const categorySummaries: Record<
      PromptCategory,
      { presencePct: number; pressure: number; topGaps: string[] }
    > = {
      brainstorming: { presencePct: 0, pressure: 0, topGaps: [] },
      identified_problem: { presencePct: 0, pressure: 0, topGaps: [] },
      solution_comparing: { presencePct: 0, pressure: 0, topGaps: [] },
      info_seeking: { presencePct: 0, pressure: 0, topGaps: [] },
    };

    (["brainstorming", "identified_problem", "solution_comparing", "info_seeking"] as PromptCategory[])
      .forEach(cat => {
        const arr = computed.filter(c => c.category === cat);
        const denom = arr.length || 1;
        const presencePct = arr.filter(c => c.googleHas || c.bingHas).length / denom;
        const pressure = arr.reduce((s, c) => s + c.competitorPressure, 0) / denom;
        const topGaps = arr.sort((a, b) => b.opportunityScore - a.opportunityScore)
          .slice(0, 5)
          .map(c => c.promptId);
        categorySummaries[cat] = { presencePct, pressure, topGaps };
      });

    // Visual-data friendly shapes
    const heatmap = computed.map(c => ({
      promptId: c.promptId,
      prompt: c.prompt,
      category: c.category,
      channels: { ...c.channels },
      competitorCount: c.competitorHitsCount,
    }));

    const bubbleMatrix = computed.map(c => ({
      promptId: c.promptId,
      x_competitorPressure: +c.competitorPressure.toFixed(3),
      y_missingPresenceWeighted: +((c.missingPresence) * c.categoryWeight).toFixed(3),
      size: +c.opportunityScore.toFixed(3),
      label: shortLabel(c.prompt),
      category: c.category,
    }));

    const funnelSov = (["brainstorming", "identified_problem", "solution_comparing", "info_seeking"] as PromptCategory[])
      .map(cat => {
        const arr = computed.filter(c => c.category === cat);
        const denom = arr.length || 1;
        const present = arr.filter(c => c.googleHas || c.bingHas).length / denom;
        const competitorOnly = arr.filter(c => !c.googleHas && !c.bingHas && c.competitorHitsCount > 0).length / denom;
        const white = arr.filter(c => !c.googleHas && !c.bingHas && c.competitorHitsCount === 0).length / denom;
        return { category: cat, presentPct: present, competitorOnlyPct: competitorOnly, whiteSpacePct: white };
      });

    const radarCategory = (["brainstorming", "identified_problem", "solution_comparing", "info_seeking"] as PromptCategory[])
      .map(cat => {
        const arr = computed.filter(c => c.category === cat);
        const denom = arr.length || 1;
        const presence = arr.filter(c => c.googleHas || c.bingHas).length / denom;
        const pressure = arr.reduce((s, c) => s + c.competitorPressure, 0) / denom;
        return { category: cat, presence, pressure };
      });

    // ---------- Ask LLM ONLY for clustering & narrative (no numbers) ----------
    const llmInput = {
      company: { name: profile.companyName, website: profile.websiteUrl },
      competitors: (profile.competitorUrls || []),
      prompts: computed.map(c => ({
        id: c.promptId,
        text: c.prompt,
        category: c.category,
        channels: { chatgpt: c.channels.chatgpt, perplexity: c.channels.perplexity, googleAIO: c.channels.googleAIO },
        competitorDomains: c.competitorDomains,
        scores: {
          missingPresence: c.missingPresence,
          competitorPressure: c.competitorPressure,
          opportunityScore: c.opportunityScore,
        },
      })),
      rules: {
        wording: [
          "DO NOT mention 'Bing' anywhere. Say 'ChatGPT' instead.",
          "DO NOT mention 'Google Page 1' or 'page rank'. Say 'Google AI Overview' instead.",
          "Avoid the words 'SERP' or 'rank'. Use 'visible', 'present', or 'discovered via AI'.",
          "Use AI-centric lingo: channels are ChatGPT, Perplexity, Google AI Overview.",
        ],
        tasks: [
          "Create 5–8 topical clusters using the prompt texts; group by semantic theme and purchase intent.",
          "For each cluster: give a short title (3–5 words), pick an icon (building|shield|code|search|alert|file), and list the promptIds (use ids verbatim).",
          "Write insights: bullet Strengths & Weaknesses (short, objective), one Competitive narrative paragraph, and a 1–2 sentence narrative per category explaining why it matters for AI discovery.",
        ],
        constraints: [
          "Output strictly valid JSON only. No markdown fences. No extra commentary.",
          "Do not fabricate numeric values.",
          "Keep text concise, pitch-ready, no marketing fluff.",
        ],
      },
      outputShape: {
        clusters: [
          { title: "string", icon: "building|shield|code|search|alert|file", items: ["promptId", "..."] }
        ],
        insights: {
          strengths: ["string", "..."],
          weaknesses: ["string", "..."],
          competitiveNarrative: "string",
          categoryNarrative: {
            brainstorming: "string",
            identified_problem: "string",
            solution_comparing: "string",
            info_seeking: "string"
          }
        }
      }
    };

    const instructions =
      [
        "You are a GEO (Generative Engine Optimization) strategist.",
        "You will receive prompts, their categories, channel visibility booleans, competitor domains, and precomputed scores.",
        "Your job is to GROUP (clusters) and WRITE (insights narrative).",
        "DO NOT mention 'Bing', 'Google Page 1', 'rank', or 'SERP'.",
        "Use 'ChatGPT', 'Perplexity', and 'Google AI Overview' terminology.",
        "Return ONLY valid JSON matching the requested shape.",
      ].join("\n");

    let llmClusters: LlmClusters = [];
    let llmInsights: LlmInsights = { strengths: [], weaknesses: [] };

    try {
      const resp = await openai.responses.create({
        model: "gpt-4.1",
        instructions,
        input: JSON.stringify(llmInput),
        temperature: 0.5,
        max_output_tokens: 2200,
      });

      const raw =
        resp.output_text ||
        (Array.isArray((resp as any).output)
          ? (resp as any).output
              .map((o: any) => o?.content?.map((c: any) => c?.text?.value ?? "").join("") ?? "")
              .join("")
          : "");

      const parsed = safeParse<{
        clusters?: LlmClusters;
        insights?: LlmInsights;
      }>(raw || "{}");

      llmClusters = Array.isArray(parsed?.clusters) ? parsed.clusters : [];
      llmInsights = parsed?.insights || { strengths: [], weaknesses: [] };
    } catch {
      // Fallback: naive clusters by category if LLM fails
      const fallbackClusters: LlmClusters = (["brainstorming", "identified_problem", "solution_comparing", "info_seeking"] as PromptCategory[])
        .map((cat): { title: string; icon: any; items: string[] } => ({
          title: cat.replace("_", " ") + " — Core",
          icon: cat === "solution_comparing" ? "search" : cat === "identified_problem" ? "alert" : cat === "brainstorming" ? "building" : "file",
          items: computed.filter(c => c.category === cat).map(c => c.promptId),
        }));
      llmClusters = fallbackClusters;
      llmInsights = {
        strengths: ["Model fallback: basic presence in some categories."],
        weaknesses: ["Model fallback: refine cluster themes for sharper targeting."],
        competitiveNarrative: "Model fallback: competitors present in overlapping prompts; prioritize BOFU solution-comparing intents.",
        categoryNarrative: {
          brainstorming: "Awareness-stage prompts benefit from canonical 'how-to' structures.",
          identified_problem: "Problem-led intents want crisp troubleshooting and solution patterns.",
          solution_comparing: "High-intent buyers seek head-to-head comparisons and decision criteria.",
          info_seeking: "Educational primitives (definitions, standards) anchor AI-ready knowledge graphs.",
        }
      };
    }

    // Validate & normalize clusters and compute opportunitySum
    const scoreById = new Map<string, number>(computed.map(c => [c.promptId, c.opportunityScore]));
    const knownIds = new Set(computed.map(c => c.promptId));
    const clusters = (llmClusters || []).map(cl => {
      const validItems = (cl.items || []).filter(id => knownIds.has(id));
      const opportunitySum = validItems.reduce((s, id) => s + (scoreById.get(id) || 0), 0);
      return {
        title: cl.title || "Cluster",
        icon: cl.icon || "search",
        items: validItems,
        opportunitySum: +opportunitySum.toFixed(3),
      };
    });

    // Opportunities list (base)
    const opportunities = computed.map(c => ({
      promptId: c.promptId,
      prompt: c.prompt,
      category: c.category,
      opportunityScore: c.opportunityScore,
      competitorDomains: c.competitorDomains,
      missingPresence: c.missingPresence,
      competitorPressure: c.competitorPressure,
      channels: { ...c.channels },
    }));

    // ---------- Next 10 Actions (detailed) ----------
    const nextActions = [...computed]
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 10)
      .map((c, idx) => {
        const wReason = CAT_REASON[c.category];
        const outline = outlineFor(c.category, c.prompt);
        const targetChannels = [
          !c.channels.perplexity ? "Perplexity" : null,
          !c.channels.googleAIO ? "Google AI Overview" : null,
          !c.channels.chatgpt ? "ChatGPT" : null,
        ].filter(Boolean);

        return {
          rank: idx + 1,
          promptId: c.promptId,
          prompt: c.prompt,
          category: c.category,
          channels: { ...c.channels },
          opportunityScore: c.opportunityScore,
          scoreBreakdown: {
            formula: "opportunity = missingPresence × (1 + 0.6×competitorPressure) × categoryWeight",
            missingPresence: c.missingPresence,
            competitorPressure: c.competitorPressure,
            categoryWeight: c.categoryWeight,
            categoryWeightReason: wReason,
          },
          why: [
            c.missingPresence > 0
              ? `Currently not visible in ${targetChannels.join(", ") || "some channels"}`
              : "Already visible in at least one major channel",
            c.competitorHitsCount > 0
              ? `Competitors present (${c.competitorDomains.slice(0, 4).join(", ")}${c.competitorDomains.length > 4 ? "…" : ""})`
              : "Low competitor presence",
            `Category emphasizes ${c.category === "solution_comparing" ? "buying decisions" :
                                  c.category === "identified_problem" ? "problem resolution" :
                                  c.category === "brainstorming" ? "task frameworks" : "education"}`
          ],
          recommendedArtifactType: outline.artifactType, // "blog_post"
          outlineSteps: outline.steps,
          outlineSections: outline.sections,
          checklistLLMReady: [
            "Clear H1/H2 in task phrasing",
            "TL;DR answer at the top",
            "Pros/cons & decision criteria where applicable",
            "Citations to authoritative sources",
            "Comparison table if evaluating options",
            "JSON-LD/Schema for canonical facts",
            "‘When not to use’ notes (LLMs value nuance)"
          ],
        };
      });

    // Assemble final report object
    const report = {
      generatedAt: Date.now(),
      metrics: {
        sov, // 0..1
        whiteSpacePct, // 0..1
        competitorPressureIdx, // 0..1
        topMoneyPrompts,
      },
      categorySummaries,
      clusters,
      opportunities,
      // contentPlan removed; using nextActions instead:
      nextActions,
      visualData: {
        heatmap,
        bubbleMatrix,
        funnelSov,
        radarCategory,
      },
      _meta: {
        companyName: profile.companyName,
        websiteUrl: profile.websiteUrl,
        totalPrompts: computed.length,
      },
      insights: llmInsights,
    };

    // Persist at /reports/overall
    await set(child(profileRef, "reports/overall"), report);

    return NextResponse.json({ success: true, data: { report: "overall" } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
