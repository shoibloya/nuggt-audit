// lib/serp-runner.ts

import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, get, set, update, serverTimestamp, child } from "firebase/database";
import {
  analyzeTop10,
  hostnameFromUrl,
  serpTop10,
  serpSearchRaw,
  extractOrganicTop10,
  extractShoppingSellerHosts,
  fetchImmersiveStoresAndBrands,
  analyzePresence,
  analyzeImmersiveByBrand,
  SerpRegionKey,
} from "./serp";

// Firebase init (client SDK via env)
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

type PromptItem = { id: string; text: string; category: string };

async function asyncPool<T>(limit: number, array: T[], worker: (item: T, i: number) => Promise<void>) {
  const ret: Promise<void>[] = [];
  const executing: Promise<void>[] = [];
  for (let i = 0; i < array.length; i++) {
    const p = Promise.resolve().then(() => worker(array[i], i));
    ret.push(p);
    if (limit <= array.length) {
      const e: Promise<void> = p.then(() => {
        const idx = executing.indexOf(e);
        if (idx >= 0) executing.splice(idx, 1);
      });
      executing.push(e);
      if (executing.length >= limit) await Promise.race(executing);
    }
  }
  await Promise.all(ret);
}

export async function runSerpChecksForProfile(profileId: string) {
  const profileRef = ref(db, `profiles/${profileId}`);
  const snap = await get(profileRef);
  if (!snap.exists()) throw new Error("Profile not found");

  const profile = snap.val() as {
    websiteUrl: string;
    competitorUrls?: string[];
    region?: SerpRegionKey;
  };

  const companyDomain = hostnameFromUrl(profile.websiteUrl);
  const competitorDomains = (profile.competitorUrls || []).map(hostnameFromUrl);
  const region: SerpRegionKey = profile.region || "sg";

  // gather prompts
  const promptsSnap = await get(child(profileRef, "prompts"));
  const promptsVal = promptsSnap.val() || {};
  const prompts: PromptItem[] = [];
  for (const cat of ["brainstorming", "identified_problem", "solution_comparing", "info_seeking"]) {
    const items = promptsVal[cat] || {};
    for (const [key, v] of Object.entries(items)) {
      const text = (v as any)?.text as string;
      prompts.push({ id: `${cat}:${key}`, text, category: cat });
    }
  }

  // status → serp_check
  await update(profileRef, {
    status: "serp_check",
    progress: 72,
    updatedAt: serverTimestamp(),
  });

  // mark each prompt's engines as checking (drives the spinner in the UI)
  for (const p of prompts) {
    await update(child(profileRef, `results/${p.id}`), {
      google: { status: "checking" },
      bing: { status: "checking" },
    });
  }

  let done = 0;
  const total = Math.max(1, prompts.length);

  // Run with small concurrency
  await asyncPool(4, prompts, async (p) => {
    try {
      // GOOGLE (enhanced: organic + shopping + immersive)
      try {
        // 1) Full SERP JSON (region-aware)
        const gData = await serpSearchRaw(p.text, region);

        // 2) Organic (legacy fields) — store ALL URLs (top10)
        const gTop10 = extractOrganicTop10(gData);
        const organic = analyzeTop10(gTop10, companyDomain, competitorDomains);

        // Log search URLs & matched count (unchanged logic)
        try {
          console.log("[SERP][search][urls]", gTop10);
          const searchMatches = gTop10.filter((u) => {
            const h = hostnameFromUrl(u);
            return h === companyDomain || h.endsWith("." + companyDomain);
          }).length;
          console.log("[SERP][search][matched-count]", { promptId: p.id, matchedCount: searchMatches });
        } catch {}

        // 3) Shopping sellers on main SERP (host-based, informational)
        const shoppingHosts = extractShoppingSellerHosts(gData);
        const shopping = analyzePresence([...shoppingHosts], companyDomain, competitorDomains);

        // 4) Immersive Products → follow & collect (hosts + brands)
        const { hosts: immersiveHosts, brands: immersiveBrands } = await fetchImmersiveStoresAndBrands(gData, region);

        // Log all brands & matched count (brand→domain)
        try {
          const brandsArr = Array.from(immersiveBrands);
          console.log("[SERP][immersive][brands][prompt]", { promptId: p.id, brands: brandsArr });
          const brandMatchedCount = brandsArr.filter((b) => {
            const normB = b && b.trim();
            return normB ? companyDomain.toLowerCase().includes(
              normB.toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "")
            ) : false;
          }).length;
          console.log("[SERP][immersive][brands-matched-count]", { promptId: p.id, matchedCount: brandMatchedCount });
        } catch {}

        // Immersive presence **by brand** (this drives the UI tick for immersive)
        const immersive = analyzeImmersiveByBrand([...immersiveBrands], companyDomain, competitorDomains);

        await set(child(profileRef, `results/${p.id}/google`), {
          status: "done",
          // legacy fields (organic-only) — UI shows ALL URLs
          top10: gTop10,
          hasCompany: organic.hasCompany,
          competitorsHit: organic.competitorsHit,
          // new, additive blocks
          shopping: {
            sellers: [...shoppingHosts],
            hasCompany: shopping.hasCompany,
            competitorsHit: shopping.competitorsHit,
          },
          immersive: {
            // keep sellers for visibility (not used for matching)
            sellers: [...immersiveHosts],
            // store brands and brand-based matching result
            brands: Array.from(immersiveBrands),
            hasCompany: immersive.hasCompany,           // BRAND-BASED (brand in company domain)
            competitorsHit: immersive.competitorsHit,   // BRAND-BASED (brand in competitor domain)
          },
          updatedAt: Date.now(),
        });
      } catch (e: any) {
        await set(child(profileRef, `results/${p.id}/google`), {
          status: "error",
          error: String(e?.message ?? e),
          updatedAt: Date.now(),
        });
      }

      // BING (unchanged)
      try {
        const bTop10 = await serpTop10(p.text, "bing", region);
        const b = analyzeTop10(bTop10, companyDomain, competitorDomains);
        await set(child(profileRef, `results/${p.id}/bing`), {
          status: "done",
          top10: bTop10,
          hasCompany: b.hasCompany,
          competitorsHit: b.competitorsHit,
          updatedAt: Date.now(),
        });
      } catch (e: any) {
        await set(child(profileRef, `results/${p.id}/bing`), {
          status: "error",
          error: String(e?.message ?? e),
          updatedAt: Date.now(),
        });
      }
    } finally {
      done += 1;
      const pct = 72 + Math.round((done / total) * 25); // 72→97
      await update(profileRef, { progress: Math.min(97, pct), updatedAt: serverTimestamp() });
    }
  });

  await update(profileRef, {
    progress: 100,
    status: "done",
    updatedAt: serverTimestamp(),
  });

  return { total: prompts.length };
}

/** Run SERP for a single prompt key "category:key" */
export async function runSerpForPrompt(profileId: string, promptId: string) {
  const profileRef = ref(db, `profiles/${profileId}`);
  const snap = await get(profileRef);
  if (!snap.exists()) throw new Error("Profile not found");

  const profile = snap.val() as {
    websiteUrl: string;
    competitorUrls?: string[];
    region?: SerpRegionKey;
  };

  const companyDomain = hostnameFromUrl(profile.websiteUrl);
  const competitorDomains = (profile.competitorUrls || []).map(hostnameFromUrl);
  const region: SerpRegionKey = profile.region || "sg";

  // lookup prompt text
  const [category, key] = promptId.split(":");
  const promptSnap = await get(child(profileRef, `prompts/${category}/${key}`));
  if (!promptSnap.exists()) throw new Error("Prompt not found");
  const text = (promptSnap.val() as any)?.text as string;

  // set checking status
  await update(child(profileRef, `results/${promptId}`), {
    google: { status: "checking" },
    bing: { status: "checking" },
  });

  // GOOGLE (enhanced)
  try {
    const gData = await serpSearchRaw(text, region);

    const gTop10 = extractOrganicTop10(gData);
    const organic = analyzeTop10(gTop10, companyDomain, competitorDomains);

    // Log search URLs & matched count (unchanged logic)
    try {
      console.log("[SERP][search][urls]", gTop10);
      const searchMatches = gTop10.filter((u) => {
        const h = hostnameFromUrl(u);
        return h === companyDomain || h.endsWith("." + companyDomain);
      }).length;
      console.log("[SERP][search][matched-count]", { promptId, matchedCount: searchMatches });
    } catch {}

    const shoppingHosts = extractShoppingSellerHosts(gData);
    const shopping = analyzePresence([...shoppingHosts], companyDomain, competitorDomains);

    const { hosts: immersiveHosts, brands: immersiveBrands } = await fetchImmersiveStoresAndBrands(gData, region);

    // Log all brands & matched count (brand→domain)
    try {
      const brandsArr = Array.from(immersiveBrands);
      console.log("[SERP][immersive][brands][prompt]", { promptId, brands: brandsArr });
      const brandMatchedCount = brandsArr.filter((b) => {
        const normB = b && b.trim();
        return normB ? companyDomain.toLowerCase().includes(
          normB.toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "")
        ) : false;
      }).length;
      console.log("[SERP][immersive][brands-matched-count]", { promptId, matchedCount: brandMatchedCount });
    } catch {}

    const immersive = analyzeImmersiveByBrand([...immersiveBrands], companyDomain, competitorDomains);

    await set(child(profileRef, `results/${promptId}/google`), {
      status: "done",
      top10: gTop10, // legacy (ALL URLs for search)
      hasCompany: organic.hasCompany,
      competitorsHit: organic.competitorsHit,
      shopping: {
        sellers: [...shoppingHosts],
        hasCompany: shopping.hasCompany,
        competitorsHit: shopping.competitorsHit,
      },
      immersive: {
        sellers: [...immersiveHosts],             // informational
        brands: Array.from(immersiveBrands),      // authoritative for matching (UI shows ALL brands)
        hasCompany: immersive.hasCompany,         // BRAND-BASED
        competitorsHit: immersive.competitorsHit, // BRAND-BASED
      },
      updatedAt: Date.now(),
    });
  } catch (e: any) {
    await set(child(profileRef, `results/${promptId}/google`), {
      status: "error",
      error: String(e?.message ?? e),
      updatedAt: Date.now(),
    });
  }

  // BING (unchanged)
  try {
    const bTop10 = await serpTop10(text, "bing", region);
    const b = analyzeTop10(bTop10, companyDomain, competitorDomains);
    await set(child(profileRef, `results/${promptId}/bing`), {
      status: "done",
      top10: bTop10,
      hasCompany: b.hasCompany,
      competitorsHit: b.competitorsHit,
      updatedAt: Date.now(),
    });
  } catch (e: any) {
    await set(child(profileRef, `results/${promptId}/bing`), {
      status: "error",
      error: String(e?.message ?? e),
      updatedAt: Date.now(),
    });
  }

  return { promptId };
}
