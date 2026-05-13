/**
 * scripts/tolik/web-tools.mjs
 *
 * Web/news/weather hands for Tolik. These exist so Tolik NEVER has to say
 * "I do not know the news" - he always has a way to find out.
 *
 * Tools:
 *   web_read({url})         - fetch URL, return main text (and title)
 *   news_top({source, n})   - top headlines from Hacker News, Reddit
 *                              world/tech/AI subs, BBC RSS, or TechCrunch
 *   weather({city})         - current weather via open-meteo.com (no key)
 *
 * All sources are free, no key required. weather goes to open-meteo which
 * returns clean JSON. News goes to public Reddit JSON, HN Firebase, and
 * RSS feeds.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function htmlToText(html) {
  // Cheap readability: strip scripts/styles, then tags, then collapse whitespace.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function web_read({ url, max_chars = 4000 }) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, reason: "bad_url" };
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,*/*" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, reason: "http_" + r.status, url };
    const ct = r.headers.get("content-type") || "";
    const html = await r.text();
    let title = "";
    const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (tm) title = tm[1].trim();
    const text = ct.includes("html") ? htmlToText(html) : html;
    return {
      ok: true,
      url,
      title,
      content_type: ct,
      text: text.slice(0, max_chars),
      truncated: text.length > max_chars,
      bytes: html.length,
    };
  } catch (e) { return { ok: false, reason: "fetch_failed", error: e.message, url }; }
}

const NEWS_SOURCES = {
  hackernews: async (n) => {
    const ids = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json", { signal: AbortSignal.timeout(10_000) }).then(r => r.json());
    const top = ids.slice(0, n);
    const items = await Promise.all(top.map(async id => {
      try {
        const j = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json());
        return { title: j.title, url: j.url, score: j.score, by: j.by, comments: j.descendants, hn: `https://news.ycombinator.com/item?id=${id}` };
      } catch { return null; }
    }));
    return items.filter(Boolean);
  },
  world: async (n) => fetchReddit("worldnews", n),
  tech: async (n) => fetchReddit("technology", n),
  ai: async (n) => fetchReddit("artificial+OpenAI+singularity+LocalLLaMA", n),
  programming: async (n) => fetchReddit("programming", n),
  startups: async (n) => fetchReddit("startups+SaaS+Entrepreneur", n),
  canada: async (n) => fetchReddit("canada+CanadianInvestor+PersonalFinanceCanada", n),
  calgary: async (n) => fetchReddit("Calgary+CalgaryFlames", n),
  bbc: async (n) => fetchRSS("https://feeds.bbci.co.uk/news/rss.xml", n),
  techcrunch: async (n) => fetchRSS("https://techcrunch.com/feed/", n),
  theverge: async (n) => fetchRSS("https://www.theverge.com/rss/index.xml", n),
};

async function fetchReddit(sub, n) {
  const r = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=${n}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error("reddit_" + r.status);
  const j = await r.json();
  return (j.data?.children || []).map(c => ({
    title: c.data.title,
    url: c.data.url,
    score: c.data.score,
    sub: c.data.subreddit,
    comments: c.data.num_comments,
    permalink: `https://reddit.com${c.data.permalink}`,
  }));
}

async function fetchRSS(url, n) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml,*/*" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error("rss_" + r.status);
  const xml = await r.text();
  const items = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < n) {
    const block = m[0];
    const get = (tag) => {
      const x = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      if (!x) return null;
      return x[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    };
    items.push({
      title: get("title"),
      url: get("link"),
      date: get("pubDate"),
      summary: (get("description") || "").replace(/<[^>]+>/g, "").slice(0, 200),
    });
  }
  return items;
}

export async function news_top({ source = "hackernews", n = 10 }) {
  const fn = NEWS_SOURCES[source];
  if (!fn) return { ok: false, reason: "unknown_source", available: Object.keys(NEWS_SOURCES) };
  try {
    const items = await fn(Math.min(20, Math.max(1, n)));
    return { ok: true, source, count: items.length, items };
  } catch (e) { return { ok: false, reason: "fetch_failed", error: e.message, source }; }
}

const CITY_COORDS = {
  calgary:   { lat: 51.0447, lon: -114.0719, tz: "America/Edmonton" },
  toronto:   { lat: 43.6532, lon: -79.3832, tz: "America/Toronto" },
  vancouver: { lat: 49.2827, lon: -123.1207, tz: "America/Vancouver" },
  lisbon:    { lat: 38.7223, lon: -9.1393, tz: "Europe/Lisbon" },
  porto:     { lat: 41.1579, lon: -8.6291, tz: "Europe/Lisbon" },
  london:    { lat: 51.5072, lon: -0.1276, tz: "Europe/London" },
  "hong kong": { lat: 22.3193, lon: 114.1694, tz: "Asia/Hong_Kong" },
  hongkong:  { lat: 22.3193, lon: 114.1694, tz: "Asia/Hong_Kong" },
  mumbai:    { lat: 19.0760, lon: 72.8777, tz: "Asia/Kolkata" },
  manila:    { lat: 14.5995, lon: 120.9842, tz: "Asia/Manila" },
  athens:    { lat: 37.9838, lon: 23.7275, tz: "Europe/Athens" },
};

export async function weather({ city = "calgary" }) {
  const key = city.toLowerCase().trim();
  let coords = CITY_COORDS[key];
  if (!coords) {
    // Geocode via open-meteo geocoding (also free)
    try {
      const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`, { signal: AbortSignal.timeout(8_000) }).then(r => r.json());
      if (g.results?.[0]) {
        const r0 = g.results[0];
        coords = { lat: r0.latitude, lon: r0.longitude, tz: r0.timezone || "auto", name: r0.name };
      }
    } catch {}
    if (!coords) return { ok: false, reason: "unknown_city", hint: "I have Calgary, Toronto, Vancouver, Lisbon, London, Hong Kong, Mumbai, Manila, Athens hard-coded" };
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${encodeURIComponent(coords.tz)}&forecast_days=2`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { ok: false, reason: "weather_http_" + r.status };
    const j = await r.json();
    return {
      ok: true,
      city: coords.name || city,
      now: {
        temp_c: j.current?.temperature_2m,
        humidity: j.current?.relative_humidity_2m,
        wind_kmh: j.current?.wind_speed_10m,
        code: j.current?.weather_code,
        condition: weatherCodeToText(j.current?.weather_code),
        time: j.current?.time,
      },
      today: {
        max_c: j.daily?.temperature_2m_max?.[0],
        min_c: j.daily?.temperature_2m_min?.[0],
        rain_chance_pct: j.daily?.precipitation_probability_max?.[0],
      },
      tomorrow: {
        max_c: j.daily?.temperature_2m_max?.[1],
        min_c: j.daily?.temperature_2m_min?.[1],
        rain_chance_pct: j.daily?.precipitation_probability_max?.[1],
      },
    };
  } catch (e) { return { ok: false, reason: "weather_threw", error: e.message }; }
}

function weatherCodeToText(c) {
  if (c === 0) return "clear";
  if (c === 1 || c === 2) return "partly cloudy";
  if (c === 3) return "overcast";
  if (c >= 45 && c <= 48) return "fog";
  if (c >= 51 && c <= 57) return "drizzle";
  if (c >= 61 && c <= 67) return "rain";
  if (c >= 71 && c <= 77) return "snow";
  if (c >= 80 && c <= 82) return "rain showers";
  if (c >= 85 && c <= 86) return "snow showers";
  if (c >= 95) return "thunderstorm";
  return "unknown";
}
