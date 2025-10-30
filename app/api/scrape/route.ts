// app/api/scrape/route.ts
import { NextRequest, NextResponse } from "next/server";
import { scrapePage, scrapeSite } from "./_helpers";

// Firecrawl SDK is safest on Node runtime (Edge optional if your setup supports it)
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Hoist so we can use in the outer catch
  let url: string | undefined;
  let blogUrl: string | undefined;
  let mode: string | undefined;
  let onlyMarkdown: boolean | undefined;

  try {
    ({ url, blogUrl, mode, onlyMarkdown } = await req.json());

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

    // If we have enough context, return SAME-SHAPE success with fallback text
    if (url) {
      const fallback = `Please use your own knowledge about the page ${url}`;
      const isPage = onlyMarkdown || mode === "page" || !blogUrl;
      if (isPage) {
        return NextResponse.json({ success: true, data: { markdown: fallback } });
      }
      return NextResponse.json({
        success: true,
        data: { productMarkdown: fallback, blogTitles: [] },
      });
    }

    // If we couldn't even parse the request body, keep the 500
    return NextResponse.json(
      { success: false, error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
