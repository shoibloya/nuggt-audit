// app/api/scrape/_helpers.ts
import FirecrawlApp from "@mendable/firecrawl-js";

const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });

/** Scrape a single page (markdown only). Throws on failure. */
export async function scrapePage(url: string): Promise<string> {
  const res = await app.scrapeUrl(url, { formats: ["markdown"], timeout: 60_000 });
  if (!res?.success) throw new Error(res?.error ?? "Firecrawl scrape failed");
  return res.markdown ?? "";
}

/** Crawl up to 100 pages; collect product-like pages + blog titles. */
export async function crawlSite(url: string) {
  const res = await app.crawlUrl(url, {
    limit: 100,
    scrapeOptions: { formats: ["markdown", "html"] },
  });
  if (!res.success) throw new Error(res.error ?? "Unknown Firecrawl error");

  const productPages: string[] = [];
  const blogTitles: string[] = [];

  for (const page of res.data) {
    const source = page.metadata?.sourceURL ?? url;
    const path = new URL(source).pathname || "/";
    if (
      /(about|home|index|pricing|features?|solutions?)/i.test(path) ||
      path === "/" ||
      path === ""
    ) {
      if (page.markdown) productPages.push(page.markdown);
    } else if (/\/blog\//i.test(path)) {
      if (page.metadata?.title) blogTitles.push(page.metadata.title);
    }
  }

  return {
    productPagesMarkdown: productPages.join("\n\n"),
    blogTitles: Array.from(new Set(blogTitles)),
  };
}

/**
 * Scrapes the main product URL (required) and optional blog URL.
 * Returns { productMarkdown, blogTitles[] }.
 */
export async function scrapeSite(url: string, blogUrl?: string) {
  const productMarkdown = await scrapePage(url);

  let blogTitles: string[] = [];
  if (blogUrl) {
    const blogMarkdown = await scrapePage(blogUrl);

    // naive extraction – any markdown link that contains "/blog/"
    const linkRegex = /\[([^\]]+?)\]\(([^)]+?\/blog\/[^)]+?)\)/gi;
    const titles: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(blogMarkdown))) titles.push(m[1].trim());
    blogTitles = [...new Set(titles)];
  }

  return { productMarkdown, blogTitles };
}
