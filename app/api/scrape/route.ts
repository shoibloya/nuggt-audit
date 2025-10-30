// app/api/scrape/route.ts
import { NextRequest, NextResponse } from "next/server";
import { scrapePage, scrapeSite } from "./_helpers";

// Firecrawl SDK is safest on Node runtime (Edge optional if your setup supports it)
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { url, blogUrl, mode, onlyMarkdown } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ success: false, error: "Missing URL" }, { status: 400 });
    }

    // Single page scrape (or when blogUrl not provided)
    if (onlyMarkdown || mode === "page" || !blogUrl) {
      try {
        const markdown = await scrapePage(url);
        // Log the markdown to server console
        console.log("──── Firecrawl Markdown (page) ────\n", markdown);
        return NextResponse.json({ success: true, data: { markdown } });
      } catch (_err) {
        const fallback = `Please use your own knowledge about the page ${url}`;
        console.log("──── Firecrawl Markdown (page FALLBACK) ────\n", fallback);
        return NextResponse.json({ success: true, data: { markdown: fallback } });
      }
    }

    // Product + blog scrape
    try {
      const scraped = await scrapeSite(url, blogUrl);
      console.log("──── Firecrawl Markdown (product) ────\n", scraped.productMarkdown);
      return NextResponse.json({
        success: true,
        data: { productMarkdown: scraped.productMarkdown, blogTitles: scraped.blogTitles },
      });
    } catch (_err) {
      const fallback = `Please use your own knowledge about the page ${url}`;
      console.log("──── Firecrawl Markdown (product FALLBACK) ────\n", fallback);
      return NextResponse.json({
        success: true,
        data: { productMarkdown: fallback, blogTitles: [] },
      });
    }
  } catch (err: any) {
    console.error("Scrape error:", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
