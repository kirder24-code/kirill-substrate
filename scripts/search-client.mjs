/**
 * Universal Search Client
 * Tries providers in order: Brave → Google CSE → DuckDuckGo scrape
 * Whichever works — uses that. No single point of failure.
 */
import { env } from "./factory/orchestrator.mjs";

const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;
const GOOGLE_KEY = env.GOOGLE_CSE_API_KEY;
const GOOGLE_CX = env.GOOGLE_CSE_ID;

export async function webSearch(query, num = 5) {
  // 1. Try Brave Search (best: free 2000/month, no billing needed)
  if (BRAVE_KEY) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num}&country=CA&search_lang=en`;
      const res = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": BRAVE_KEY,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.web?.results || []).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.description || "",
        }));
      }
    } catch {}
  }

  // 2. Try Google CSE (needs billing enabled)
  if (GOOGLE_KEY && GOOGLE_CX) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=${num}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        return (data.items || []).map(i => ({
          title: i.title,
          url: i.link,
          snippet: i.snippet || "",
        }));
      }
    } catch {}
  }

  // 3. Fallback: DuckDuckGo instant answers (limited but free)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const results = [];
      if (data.AbstractURL) results.push({ title: data.Heading, url: data.AbstractURL, snippet: data.AbstractText });
      (data.RelatedTopics || []).slice(0, num).forEach(t => {
        if (t.FirstURL) results.push({ title: t.Text?.slice(0, 60), url: t.FirstURL, snippet: t.Text || "" });
      });
      return results;
    }
  } catch {}

  return [];
}

// Test
if (process.argv[1] === (await import("url")).fileURLToPath(import.meta.url)) {
  const results = await webSearch("Calgary accounting firm owner automation LinkedIn", 3);
  console.log(`Found ${results.length} results:`);
  results.forEach(r => console.log(`- ${r.title}\n  ${r.url}\n  ${r.snippet?.slice(0, 100)}\n`));
}
