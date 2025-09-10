// lib/serp.ts
const BASE = "https://serpapi.com/search.json";

// Accept either SERP_API_KEY or SERPAPI_KEY
function getKey() {
  return process.env.SERP_API_KEY || process.env.SERPAPI_KEY;
}

export function hostnameFromUrl(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return u.toLowerCase().replace(/^www\./, "");
  }
}

export async function serpTop10(query: string, engine?: "bing"): Promise<string[]> {
  const apiKey = getKey();
  if (!apiKey) throw new Error("Missing SERP_API_KEY (or SERPAPI_KEY)");

  const params = new URLSearchParams({
    q: query,
    location: "Singapore",
    hl: "en",
    gl: "sg",
    google_domain: "google.com.sg",
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

export function analyzeTop10(
  top10: string[],
  companyDomain: string,
  competitorDomains: string[]
) {
  const hitCompany = top10.some((u) => u.toLowerCase().includes(companyDomain));
  const competitorsHit = Array.from(
    new Set(
      competitorDomains.filter((cd) => top10.some((u) => u.toLowerCase().includes(cd)))
    )
  );
  return { hasCompany: hitCompany, competitorsHit };
}
