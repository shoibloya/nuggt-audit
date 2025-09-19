// lib/serp.ts

const BASE = "https://serpapi.com/search.json";

// Region config (default remains SG for backward-compat)
export type SerpRegionKey = "sg" | "us";
export const REGION: Record<SerpRegionKey, { location: string; hl: string; gl: string; google_domain: string }> = {
  sg: { location: "Singapore",     hl: "en", gl: "sg", google_domain: "google.com.sg" },
  us: { location: "United States", hl: "en", gl: "us", google_domain: "google.com"    },
};

// Accept either SERP_API_KEY or SERPAPI_KEY
function getKey() {
  return process.env.SERP_API_KEY || process.env.SERPAPI_KEY;
}

export function hostnameFromUrl(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    const cleaned = u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    return cleaned.split("/")[0];
  }
}

function hostFromResultUrl(u: string): string | null {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domain: string) {
  if (!host || !domain) return false;
  if (host === domain) return true;
  return host.endsWith("." + domain);
}

// ------------------------
// EXISTING: Top-10 organic
// ------------------------
export async function serpTop10(
  query: string,
  engine?: "bing",
  region: SerpRegionKey = "sg" // optional region, defaults to SG
): Promise<string[]> {
  const apiKey = getKey();
  if (!apiKey) throw new Error("Missing SERP_API_KEY (or SERPAPI_KEY)");

  const r = REGION[region] || REGION.sg;

  const params = new URLSearchParams({
    q: query,
    location: r.location,
    hl: r.hl,
    gl: r.gl,
    google_domain: r.google_domain,
    api_key: apiKey,
  });
  if (engine) params.set("engine", engine);

  const res = await fetch(`${BASE}?${params.toString()}`, { method: "GET" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`SerpAPI ${engine ?? "google"} failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  const organic = Array.isArray(data?.organic_results) ? data.organic_results : [];
  const links = organic
    .map((r: any) => r?.link)
    .filter((u: any) => typeof u === "string")
    .slice(0, 10);
  return links;
}

/** Return whether company appears and which competitor domains appear (exact host match or subdomain). */
export function analyzeTop10(
  top10: string[],
  companyDomain: string,
  competitorDomains: string[]
) {
  const hosts = top10
    .map((u) => hostFromResultUrl(u))
    .filter(Boolean) as string[];

  const hasCompany = hosts.some((h) => matchesDomain(h, companyDomain));
  const competitorsHit = Array.from(
    new Set(
      competitorDomains.filter((cd) => hosts.some((h) => matchesDomain(h, cd)))
    )
  );

  return { hasCompany, competitorsHit };
}

// =====================================
// E-comm aware helpers (additive)
// =====================================

/** Get the full Google Search JSON (engine=google). */
export async function serpSearchRaw(
  query: string,
  region: SerpRegionKey = "sg"
): Promise<any> {
  const apiKey = getKey();
  if (!apiKey) throw new Error("Missing SERP_API_KEY (or SERPAPI_KEY)");
  const r = REGION[region] || REGION.sg;

  const params = new URLSearchParams({
    q: query,
    location: r.location,
    hl: r.hl,
    gl: r.gl,
    google_domain: r.google_domain,
    api_key: apiKey,
  });

  const res = await fetch(`${BASE}?${params.toString()}`, { method: "GET" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`SerpAPI google failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  return json;
}

/** Organic top-10 extractor from a raw search.json payload (keeps existing behavior). */
export function extractOrganicTop10(data: any): string[] {
  const organic = Array.isArray(data?.organic_results) ? data.organic_results : [];
  const links = organic
    .map((r: any) => r?.link)
    .filter((u: any) => typeof u === "string")
    .slice(0, 10);
  return links;
}

/**
 * Extract seller hostnames from inline shopping/shopping_results on the main SERP.
 * Strategy:
 *  - Prefer product_link → hostname
 *  - Else use link → hostname
 *  - Else try source_icon → hostname
 */
export function extractShoppingSellerHosts(data: any): Set<string> {
  const out = new Set<string>();

  const arr = Array.isArray(data?.shopping_results) ? data.shopping_results : [];
  for (const item of arr) {
    const link: string | undefined = item?.product_link || item?.link;
    const icon: string | undefined = item?.source_icon;

    if (typeof link === "string") {
      const h = hostFromResultUrl(link);
      if (h) out.add(h);
      continue;
    }

    if (typeof icon === "string") {
      const h = hostFromResultUrl(icon);
      if (h) out.add(h);
    }
  }

  return out;
}

/** Normalizes a brand string for contains() checks. */
export function normalizeBrand(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")     // collapse punctuation
    .trim();
}

/** brand-in-domain test (immersive only). */
export function brandMatchesDomain(brand: string, domain: string): boolean {
  if (!brand || !domain) return false;
  const b = normalizeBrand(brand).replace(/\s+/g, ""); // "vera bradley" -> "verabradley"
  const d = String(domain || "").toLowerCase();
  return b.length > 1 && d.includes(b);
}

/** brand-in-URL-hostname test (helps the UI highlight URL↔brand relationships). */
export function urlHostnameContainsBrand(url: string, brand: string): boolean {
  const host = hostFromResultUrl(url) || "";
  if (!host) return false;
  const b = normalizeBrand(brand).replace(/\s+/g, "");
  return b.length > 1 && host.includes(b);
}

/**
 * From the main SERP JSON, follow each immersive_products item to the Immersive Product API
 * and collect:
 *   - seller hostnames (best-effort)
 *   - product brands (authoritative for matching)
 *
 * Correct method: start from the **Google Search API** response (results[:immersive_products]),
 * then follow each item's serpapi link or page_token with engine=google_immersive_product.
 */
export async function fetchImmersiveStoresAndBrands(
  data: any,
  region: SerpRegionKey = "sg"
): Promise<{ hosts: Set<string>; brands: Set<string> }> {
  const apiKey = getKey();
  if (!apiKey) throw new Error("Missing SERP_API_KEY (or SERPAPI_KEY)");
  const r = REGION[region] || REGION.sg;

  const items = Array.isArray(data?.immersive_products) ? data.immersive_products : [];
  const hosts = new Set<string>();
  const brands = new Set<string>();

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];

    // Build follow URL (prefer serpapi_immersive_product_api or serpapi_link; else page_token)
    let followUrl: string | null = null;
    const direct =
      (typeof item?.serpapi_immersive_product_api === "string" && item.serpapi_immersive_product_api) ||
      (typeof item?.serpapi_link === "string" && item.serpapi_link) ||
      null;

    if (direct) {
      const u = new URL(direct);
      if (!u.searchParams.get("api_key")) u.searchParams.set("api_key", apiKey);
      if (!u.searchParams.get("hl")) u.searchParams.set("hl", r.hl);
      if (!u.searchParams.get("gl")) u.searchParams.set("gl", r.gl);
      followUrl = u.toString();
    } else if (typeof item?.immersive_product_page_token === "string") {
      const params = new URLSearchParams({
        engine: "google_immersive_product",
        page_token: item.immersive_product_page_token,
        api_key: apiKey,
        hl: r.hl,
        gl: r.gl,
      });
      followUrl = `${BASE}?${params.toString()}`;
    }

    if (!followUrl) continue;

    // Log every immersive serpapi URL we call
    try {
      console.log("[SERP][immersive][follow-url]", { index: idx, url: followUrl });
    } catch {}

    const resp = await fetch(followUrl, { method: "GET" });
    if (!resp.ok) {
      try {
        console.log("[SERP][immersive][detail-nonok]", { index: idx, status: resp.status });
      } catch {}
      continue;
    }
    const imm = await resp.json();

    // Log the response payload root for this follow
    try {
      console.log("[SERP][immersive][follow-response]", { index: idx, url: followUrl, json: imm });
    } catch {}

    // Collect brand (authoritative)
    const brand = imm?.product_results?.brand;
    if (typeof brand === "string" && brand.trim()) {
      brands.add(brand.trim());
    }

    // Best-effort host scraping from common arrays (still useful to display, but NOT used for match)
    const candidateArrays: any[] = [];
    const pushIfArray = (x: any) => { if (Array.isArray(x)) candidateArrays.push(x); };

    pushIfArray(imm?.product_results?.stores);
    pushIfArray(imm?.product_results?.more_options);
    pushIfArray(imm?.product_results?.variants);
    pushIfArray(imm?.stores);
    pushIfArray(imm?.sellers);
    pushIfArray(imm?.buying_options);
    pushIfArray(imm?.purchase_options);
    pushIfArray(imm?.shopping_results);
    pushIfArray(imm?.offers);

    for (const arr of candidateArrays) {
      for (const row of arr) {
        const link: string | undefined =
          (typeof row?.link === "string" && row.link) ||
          (typeof row?.product_link === "string" && row.product_link) ||
          (typeof row?.seller_link === "string" && row.seller_link) ||
          (typeof row?.url === "string" && row.url);
        if (typeof link === "string") {
          const h = hostFromResultUrl(link);
          if (h) hosts.add(h);
        }
      }
    }
  }

  // Log ALL immersive hosts and ALL brands we collected for this query
  try {
    console.log("[SERP][immersive][hosts]", Array.from(hosts));
    console.log("[SERP][immersive][brands]", Array.from(brands));
  } catch {}

  return { hosts, brands };
}

/** brand-set → hasCompany / competitorsHit for immersive only (brand→domain contains). */
export function analyzeImmersiveByBrand(
  brands: string[],
  companyDomain: string,
  competitorDomains: string[]
) {
  const hasCompany = brands.some((b) => brandMatchesDomain(b, companyDomain));
  const competitorsHit = Array.from(
    new Set(
      competitorDomains.filter((cd) => brands.some((b) => brandMatchesDomain(b, cd)))
    )
  );
  return { hasCompany, competitorsHit };
}

/** Reuse host-based domain rule for other host lists (shopping, organic). */
export function analyzePresence(
  hosts: string[],
  companyDomain: string,
  competitorDomains: string[]
) {
  const hasCompany = hosts.some((h) => matchesDomain(h, companyDomain));
  const competitorsHit = Array.from(
    new Set(
      competitorDomains.filter((cd) => hosts.some((h) => matchesDomain(h, cd)))
    )
  );
  return { hasCompany, competitorsHit };
}
