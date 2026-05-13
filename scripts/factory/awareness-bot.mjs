/**
 * AWARENESS BOT - Self-Updating Knowledge Layer v1
 *
 * Principle: daily find only new knowledge that changes real system actions
 * and does not poison the system with junk.
 *
 * Pipeline: source -> prescreen -> truth filter (Claude) -> action map -> daily brief -> review -> auto-apply (high confidence only)
 * High-confidence ACCEPTED items with action_type auto-apply via Claude CLI subprocess.
 * Medium/low confidence items are flagged only - no auto-execution.
 *
 * Run: node scripts/factory/awareness-bot.mjs
 * Cron: daily 3 AM Calgary (09:00 UTC)
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../apps/api/.env");
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const AWARENESS_DIR = resolve(__dirname, "../../.data/awareness");
const HISTORY_DIR = resolve(AWARENESS_DIR, "history");
const LATEST_FILE = resolve(AWARENESS_DIR, "latest.md");
const SOURCE_TRUST_FILE = resolve(AWARENESS_DIR, "source-trust.json");
const SEEN_URLS_FILE = resolve(AWARENESS_DIR, "seen-urls.json");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;
const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

// ═══════════════════════════════════════════════════════════════════════════
// A. SOURCE MAP - narrow, defensive, tier-based
// ═══════════════════════════════════════════════════════════════════════════

const SOURCES = {
  // TIER 1: Primary sources - highest trust, official, changelogs, repos
  tier1: {
    anthropic_news: {
      url: "https://www.anthropic.com/news",
      type: "webfetch",
      trust: "primary",
      scan: "daily",
      purpose: "Claude model releases, features, API changes"
    },
    anthropic_engineering: {
      url: "https://www.anthropic.com/engineering",
      type: "webfetch",
      trust: "primary",
      scan: "weekly",
      purpose: "Official engineering patterns, best practices"
    },
    // openai_blog disabled: Cloudflare 403, needs browser automation
    google_deepmind: {
      url: "https://blog.google/technology/google-deepmind/",
      type: "webfetch",
      trust: "primary",
      scan: "weekly",
      purpose: "Google DeepMind model releases"
    },
    hf_papers: {
      url: "https://huggingface.co/papers",
      type: "webfetch",
      trust: "primary",
      scan: "daily",
      purpose: "Curated AI research papers with community votes"
    },
    langchain_releases: {
      url: "https://api.github.com/repos/langchain-ai/langchain/releases",
      type: "github_releases",
      trust: "primary",
      scan: "weekly",
      purpose: "Framework changes, deprecations"
    },
    langgraph_releases: {
      url: "https://api.github.com/repos/langchain-ai/langgraph/releases",
      type: "github_releases",
      trust: "primary",
      scan: "weekly",
      purpose: "Agent orchestration changes"
    },
    n8n_releases: {
      url: "https://api.github.com/repos/n8n-io/n8n/releases",
      type: "github_releases",
      trust: "primary",
      scan: "weekly",
      purpose: "n8n node/feature changes for our workflows"
    },
    crewai_releases: {
      url: "https://api.github.com/repos/joaomdmoura/crewAI/releases",
      type: "github_releases",
      trust: "primary",
      scan: "weekly",
      purpose: "Multi-agent framework changes"
    },
    mcp_releases: {
      url: "https://api.github.com/repos/modelcontextprotocol/servers/releases",
      type: "github_releases",
      trust: "primary",
      scan: "weekly",
      purpose: "MCP server updates"
    },
    // ─── 4 sources added April 6 2026 specifically for Claude/Anthropic tooling
    // that improves MY (Claude) own work. Approved as small low-risk infra exception.
    claude_code_releases: {
      url: "https://api.github.com/repos/anthropics/claude-code/releases",
      type: "github_releases",
      trust: "primary",
      scan: "daily",
      purpose: "Claude Code CLI new features, bug fixes, version changes"
    },
    anthropic_cookbook: {
      url: "https://github.com/anthropics/claude-cookbooks",
      type: "webfetch",
      trust: "primary",
      scan: "weekly",
      purpose: "New official Claude prompt patterns and code examples (no releases, watch repo index)"
    },
    anthropic_api_changelog: {
      url: "https://docs.anthropic.com/en/release-notes/api",
      type: "webfetch",
      trust: "primary",
      scan: "daily",
      purpose: "Anthropic API new params, new tool types, new modalities"
    },
    mcp_servers_registry: {
      url: "https://github.com/modelcontextprotocol/servers",
      type: "webfetch",
      trust: "primary",
      scan: "weekly",
      purpose: "New MCP servers added to the official registry index"
    }
  },

  // TIER 2: Strong secondary - signal surfaces, not truth
  tier2: {
    hn_top: {
      url: "https://hacker-news.firebaseio.com/v0/topstories.json",
      type: "hn_api",
      trust: "secondary",
      scan: "daily",
      purpose: "Build signal, new tools, technical discussions",
      max_items: 50
    },
    r_localllama: {
      url: "https://www.reddit.com/r/LocalLLaMA/top/.json?t=day&limit=25",
      type: "reddit_json",
      trust: "secondary",
      scan: "daily",
      purpose: "Local model development, practical AI"
    },
    r_claudeai: {
      url: "https://www.reddit.com/r/ClaudeAI/top/.json?t=day&limit=25",
      type: "reddit_json",
      trust: "secondary",
      scan: "daily",
      purpose: "Claude-specific patterns, issues, prompts"
    },
    r_aiengineer: {
      url: "https://www.reddit.com/r/AI_Agents/top/.json?t=day&limit=20",
      type: "reddit_json",
      trust: "secondary",
      scan: "daily",
      purpose: "Agent patterns, orchestration, memory systems"
    },
    r_saas: {
      url: "https://www.reddit.com/r/SaaS/top/.json?t=week&limit=15",
      type: "reddit_json",
      trust: "secondary",
      scan: "weekly",
      purpose: "Solo founder GTM, cold outreach, revenue tactics"
    },
    r_indiehackers: {
      url: "https://www.reddit.com/r/indiehackers/top/.json?t=week&limit=15",
      type: "reddit_json",
      trust: "secondary",
      scan: "weekly",
      purpose: "Indie operator revenue stories with proof"
    },
    // ─── 3 sources added April 7 2026 for Solo SaaS Founder archetype hunt ───
    // Validated via Sofistikat (LinkedIn) + College_Any (Reddit) within 24h.
    // Need more prospects of this archetype in pipeline.
    r_entrepreneur: {
      url: "https://www.reddit.com/r/Entrepreneur/top/.json?t=day&limit=25",
      type: "reddit_json",
      trust: "secondary",
      scan: "daily",
      purpose: "Solo founder pain at first 10 customers gap, marketing partner failures, sales struggle"
    },
    r_consulting: {
      url: "https://www.reddit.com/r/consulting/top/.json?t=week&limit=15",
      type: "reddit_json",
      trust: "secondary",
      scan: "weekly",
      purpose: "Solo consultant lead gen questions (College_Any source)"
    },
    indiehackers_forum: {
      url: "https://www.indiehackers.com/forum",
      type: "webfetch",
      trust: "primary",
      scan: "daily",
      purpose: "Solo SaaS founders openly discussing first 10 customers / sales struggles - canonical Sofistikat archetype habitat"
    }
  },

  // TIER 2B: Business & Economy intelligence (not just tech)
  tier2b: {
    r_smallbusiness: {
      url: "https://www.reddit.com/r/smallbusiness/top/.json?t=day&limit=20",
      type: "reddit_json",
      trust: "secondary",
      scan: "daily",
      purpose: "Small business owners discussing AI adoption, automation needs, operational pain"
    },
    r_canadabusiness: {
      url: "https://www.reddit.com/r/canadasmallbusiness/top/.json?t=week&limit=15",
      type: "reddit_json",
      trust: "secondary",
      scan: "weekly",
      purpose: "Canadian small business trends, tariff impact, local economy"
    },
    r_artificial: {
      url: "https://www.reddit.com/r/artificial/top/.json?t=day&limit=15",
      type: "reddit_json",
      trust: "secondary",
      scan: "daily",
      purpose: "AI industry news, major releases, business applications"
    },
    r_machinelearning: {
      url: "https://www.reddit.com/r/MachineLearning/top/.json?t=week&limit=10",
      type: "reddit_json",
      trust: "secondary",
      scan: "weekly",
      purpose: "Breakthrough models and techniques with business applications"
    },
    // ── GLOBAL MARKET INTELLIGENCE (added Apr 27 2026) ───────────────
    // Not just tech — economics, countries, investments, regulations
    openai_blog: {
      url: "https://openai.com/blog",
      type: "webfetch",
      trust: "primary",
      scan: "daily",
      purpose: "GPT releases, new products, API changes, partnerships"
    },
    techcrunch_ai: {
      url: "https://techcrunch.com/category/artificial-intelligence/",
      type: "webfetch",
      trust: "secondary",
      scan: "daily",
      purpose: "AI industry deals, funding rounds, company launches, market signals"
    },
    venturebeat_ai: {
      url: "https://venturebeat.com/ai/",
      type: "webfetch",
      trust: "secondary",
      scan: "daily",
      purpose: "Enterprise AI adoption, market reports, vendor analysis"
    },
    the_information_ai: {
      url: "https://www.reuters.com/technology/artificial-intelligence/",
      type: "webfetch",
      trust: "primary",
      scan: "daily",
      purpose: "Global AI policy, country investments, regulations, trade"
    },
    r_economics: {
      url: "https://www.reddit.com/r/economics/top/.json?t=day&limit=15",
      type: "reddit_json",
      trust: "secondary",
      scan: "daily",
      purpose: "Global economic trends, country spending, trade patterns"
    },
    r_technology: {
      url: "https://www.reddit.com/r/technology/top/.json?t=day&limit=15",
      type: "reddit_json",
      trust: "secondary",
      scan: "daily",
      purpose: "Major tech announcements, AI regulation, country tech policy"
    },
    // ── GEOGRAPHIC AI COVERAGE (added 2026-05-09) ────────────────
    // Existing sources are US/Western-centric. These three add visibility
    // into global AI moves: Latin America, Asia, Africa, Middle East, EU policy.
    rest_of_world: {
      url: "https://restofworld.org/topic/artificial-intelligence/",
      type: "webfetch",
      trust: "primary",
      scan: "weekly",
      purpose: "AI in Latin America, Africa, Southeast Asia, Middle East - non-Western markets and policy"
    },
    brookings_ai: {
      url: "https://www.brookings.edu/artificial-intelligence/",
      type: "webfetch",
      trust: "primary",
      scan: "weekly",
      purpose: "US/global AI policy analysis, country investment reports, regulatory direction"
    },
    r_wallstreetbets: {
      url: "https://www.reddit.com/r/wallstreetbets/top/.json?t=day&limit=10",
      type: "reddit_json",
      trust: "tertiary",
      scan: "daily",
      purpose: "AI stock sentiment - major moves often signal underlying corporate AI investment shifts"
    },
  },

  // TIER 3: Targeted search - tech, economy, business AI adoption
  tier3_searches: {
    scan: "daily",
    queries: [
      // Tech releases (what's new)
      "new AI agent framework released 2026",
      "claude code autonomous system 2026",
      "MCP server release 2026",
      "OpenAI new product release April 2026",
      "Anthropic Claude new features 2026",
      "Google AI new release 2026",
      // Business AI adoption (who's buying)
      "small business AI adoption 2026 case study",
      "which industries adopting AI fastest 2026",
      "AI automation ROI small business real results",
      "companies switching to AI workflow 2026",
      // Economy & market signals (where's the money)
      "Canada AI investment 2026",
      "AI startup funding 2026 seed round",
      "businesses struggling without AI automation 2026",
      "AI consulting demand growing 2026",
      // Solo founder signals (our buyers)
      "solo founder first 10 customers 2026",
      "bootstrapped SaaS founder no customers 2026",
      "vibe coding production scaling issues 2026",
      // Agent architecture doctrine (simpler beats more agents)
      "single agent better than multi-agent 2026",
      "multi-agent system failure context loss 2026",
      // Service opportunity signals
      "hiring AI consultant freelancer 2026",
      "need help implementing AI workflow business",
      "looking for AI automation expert small business",
      // Lead response bottleneck - validated pain pattern (Apr 2026: contractor $1M revenue, unread DMs)
      "contractor unread leads not following up",
      "business missing leads sitting on dms",
      // USA market
      "USA small business AI automation 2026",
      "US companies adopting AI workflow 2026",
      "American startup hiring AI freelancer 2026",
      // GLOBAL market intelligence — countries, investments, where to enter
      "countries investing most in AI 2026",
      "government AI spending by country 2026",
      "AI regulation Europe UK UAE Singapore 2026",
      "easiest countries to sell AI services 2026",
      "AI adoption rate by country 2026 report",
      "Middle East AI investment 2026 Saudi UAE",
      "Southeast Asia AI market growth 2026",
      "Africa AI startup ecosystem 2026",
      "Latin America AI adoption business 2026",
      "UK AI services market freelancer 2026",
      "Australia AI consulting demand 2026",
      // Portugal & EU - Kirill's potential relocation + parallel market
      "Portugal AI startup ecosystem Lisbon 2026",
      "Portugal digital nomad tech freelancer 2026",
      "EU AI Act impact small business services 2026",
      "European AI services market freelancer 2026",
      "Lisbon tech scene AI companies hiring 2026",
      "Portugal AI automation consultant rates pricing 2026",
      "Portugal D7 visa digital nomad visa requirements 2026",
      "European SMB automation demand n8n zapier 2026",
      "Portugal cost of living vs Canada freelancer 2026",
      // Chain/franchise business automation pain (Kirill insight Apr 28)
      "franchise owner automation multi-location operations 2026",
      "multi-location business software pain reporting Reddit",
      "franchise operations manual process coordination between locations",
      "chain business AI automation cross-location reporting",
      "Reddit franchise owner overwhelmed managing multiple locations",
      "EU AI consulting demand remote English speaking 2026",
      "Reddit r/digitalnomad Portugal AI freelancer",
      // Free platform lead search - chain/franchise businesses (Apr 28 2026)
      "site:upwork.com franchise automation multi-location",
      "site:upwork.com multi-location reporting dashboard",
      "site:facebook.com/groups Calgary franchise business owner",
      "site:alignable.com Calgary business automation",
      "site:quora.com franchise operations automation AI",
      "site:craigslist.org Calgary business automation help",
      "site:kijiji.ca Calgary business automation",
      "site:indeed.com Calgary operations coordinator franchise",
      "site:medium.com franchise automation multi-location challenges",
      // Global AI trends — what's changing
      "GPT-5 release impact business 2026",
      "AI agent production deployment failures 2026",
      "enterprise AI budget cuts or growth 2026",
      "AI services pricing trends 2026",
      "which AI services sell best 2026",
    ]
  }
};

// EXCLUDED domains (auto-reject)
const EXCLUDED_DOMAINS = [
  // AI-generated fluff farms
  "medium.com",         // default exclude, whitelist authors later
  "substack.com",        // default exclude, whitelist authors later
  "dev.to",
  // SEO spam
  "analyticsvidhya.com",
  "kdnuggets.com",
  "towardsdatascience.com",
  // Note: techcrunch, venturebeat, theverge REMOVED from exclusions April 23 2026
  // They carry real business/economy signals needed for market opportunity detection
];

// WHITELISTED authors (can override excluded domains)
const WHITELISTED_AUTHORS = {
  // Start empty. Add after proving signal quality over time.
};

// ═══════════════════════════════════════════════════════════════════════════
// B. TRUTH FILTER - hard scoring rules
// ═══════════════════════════════════════════════════════════════════════════

const TRUTH_CRITERIA = {
  source_distance: {
    weight: 3,
    scale: {
      0: "tertiary (summary of summary)",
      1: "secondary (reporting on primary)",
      2: "primary (official, first-hand, changelog, repo)"
    }
  },
  proof_density: {
    weight: 3,
    scale: {
      0: "zero proof (vague claims only)",
      1: "some proof (partial numbers or examples)",
      2: "heavy proof (code, metrics, demo, artifacts)"
    }
  },
  actionability: {
    weight: 2,
    scale: {
      0: "theoretical, future-looking, not actionable today",
      1: "context useful for future decisions",
      2: "can change our bot/prompt/workflow TODAY"
    }
  },
  ai_fluff_absence: {
    weight: 1,
    scale: {
      0: "heavy AI tells (em dashes, 'revolutionary', listicles)",
      1: "mixed (some real content, some polish)",
      2: "clearly human, specific, no GPT-ese"
    }
  },
  relevance_to_us: {
    weight: 1,
    scale: {
      0: "unrelated (academic, enterprise-only, other domain)",
      1: "adjacent (solo founder, GTM, generic AI)",
      2: "directly applicable to our stack (Claude, agents, memory, outreach)"
    }
  }
};
// Max possible score: 3*2 + 3*2 + 2*2 + 1*2 + 1*2 = 20
// ACCEPT threshold: 15/20 (75%)
// FLAG threshold: 11/20 (55%)
// REJECT: anything below 11

const RED_FLAG_PHRASES = [
  "revolutionary", "game-changer", "game changer", "10x your",
  "changed everything", "you need to try", "must-have",
  "will replace", "disruption", "next big thing",
  "unlock", "leverage", "supercharge", "transform your",
  "the future of", "mind-blowing", "insane", "crazy good"
];

// ═══════════════════════════════════════════════════════════════════════════
// C. FETCHERS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchHNShowHN(maxItems = 30) {
  // Show HN items with low upvotes (under 50) within last 48h = struggling solo founder
  // launching their product. Canonical Sofistikat archetype habitat.
  // Algolia HN API supports tag and date filters. Must URL-encode > and < in numericFilters.
  try {
    const since = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
    const numericFilters = encodeURIComponent(`created_at_i>${since},points<50`);
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=${numericFilters}&hitsPerPage=${maxItems}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      console.error(`[hn_show_hn_struggling] HTTP ${r.status}`);
      return [];
    }
    const data = await r.json();
    const items = (data.hits || []).map(h => ({
      source_id: "hn_show_hn_struggling",
      source_tier: "tier2",
      title: `Show HN (${h.points || 0} pts): ${h.title || ""}`,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      score: h.points || 0,
      comments: h.num_comments || 0,
      text: (h.story_text || "").slice(0, 600),
    }));
    return items;
  } catch (e) {
    console.error(`[hn_show_hn_struggling] failed:`, e.message);
    return [];
  }
}

async function fetchHN(maxItems = 50) {
  try {
    const topIds = await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json();
    const items = [];
    for (const id of topIds.slice(0, maxItems)) {
      const item = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json();
      if (!item || item.type !== "story") continue;
      items.push({
        source_id: "hn_top",
        source_tier: "tier2",
        title: item.title || "",
        url: item.url || `https://news.ycombinator.com/item?id=${id}`,
        score: item.score || 0,
        comments: item.descendants || 0,
        text: "",
      });
      if (items.length >= 30) break;
    }
    return items;
  } catch (e) {
    console.error("HN fetch failed:", e.message);
    return [];
  }
}

async function fetchReddit(sourceId, subreddit, timeframe = "day", limit = 25) {
  const url = `https://www.reddit.com/r/${subreddit}/top/.json?t=${timeframe}&limit=${limit}`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; awareness-bot/1.0; +research)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      console.error(`Reddit ${subreddit} HTTP ${r.status}`);
      return [];
    }
    const text = await r.text();
    let d;
    try {
      d = JSON.parse(text);
    } catch (e) {
      console.error(`Reddit ${subreddit} JSON parse failed, got: ${text.slice(0, 100)}`);
      return [];
    }
    const children = d?.data?.children;
    if (!Array.isArray(children)) {
      console.error(`Reddit ${subreddit} unexpected shape:`, JSON.stringify(d).slice(0, 200));
      return [];
    }
    return children.map(c => ({
      source_id: sourceId,
      source_tier: "tier2",
      title: c.data?.title || "",
      url: `https://reddit.com${c.data?.permalink || ""}`,
      external_url: c.data?.url || "",
      score: c.data?.ups || 0,
      comments: c.data?.num_comments || 0,
      text: (c.data?.selftext || "").slice(0, 800),
    }));
  } catch (e) {
    console.error(`Reddit ${subreddit} failed:`, e.message);
    return [];
  }
}

async function fetchGitHubReleases(sourceId, apiUrl) {
  try {
    const r = await fetch(apiUrl, {
      headers: { "Accept": "application/vnd.github+json", "User-Agent": "awareness-bot" }
    });
    if (!r.ok) return [];
    const releases = await r.json();
    return releases.slice(0, 5).map(rel => ({
      source_id: sourceId,
      source_tier: "tier1",
      title: `${sourceId}: ${rel.name || rel.tag_name}`,
      url: rel.html_url,
      published: rel.published_at,
      text: (rel.body || "").slice(0, 1500),
    }));
  } catch (e) {
    console.error(`GitHub ${sourceId} failed:`, e.message);
    return [];
  }
}

// URL patterns that indicate actual articles vs navigation
const ARTICLE_URL_PATTERNS = {
  anthropic_news: /anthropic\.com\/news\/[a-z0-9-]{10,}/i,
  anthropic_engineering: /anthropic\.com\/engineering\/[a-z0-9-]{10,}/i,
  google_deepmind: /blog\.google\/(technology|innovation)\/.*\/[a-z0-9-]{15,}/i,
  hf_papers: /huggingface\.co\/papers\/\d{4}\.\d{4,}/i,
};

async function fetchWebPage(sourceId, url, tier = "tier1") {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) {
      console.error(`WebFetch ${sourceId} HTTP ${r.status}`);
      return [];
    }
    const html = await r.text();

    // Extract article links with URL pattern filtering
    const urlPattern = ARTICLE_URL_PATTERNS[sourceId];
    const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set();
    const links = [];
    let match;

    while ((match = linkPattern.exec(html)) !== null) {
      let href = match[1];
      const innerText = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!href || !innerText || innerText.length < 15 || innerText.length > 200) continue;

      // Resolve relative URLs
      if (href.startsWith("/")) {
        try { href = new URL(href, url).toString(); } catch { continue; }
      }
      if (!href.startsWith("http")) continue;

      // Apply article URL pattern if defined
      if (urlPattern && !urlPattern.test(href)) continue;

      // Dedup by URL
      if (seen.has(href)) continue;
      seen.add(href);

      // Skip obvious navigation text
      if (/^(home|about|contact|careers|pricing|login|sign in|sign up|menu|search|products|api|docs|developers|enterprise|safety|research|company|news|blog)$/i.test(innerText)) continue;

      links.push({ url: href, text: innerText });
      if (links.length >= 20) break;
    }

    return links.map(l => ({
      source_id: sourceId,
      source_tier: tier,
      title: l.text,
      url: l.url,
      text: "",
    }));
  } catch (e) {
    console.error(`WebFetch ${sourceId} failed:`, e.message);
    return [];
  }
}

async function braveSearch(query, count = 8) {
  if (!BRAVE_KEY) return [];
  try {
    const r = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&freshness=pw`,
      { headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json" } }
    );
    if (!r.ok) return [];
    const d = await r.json();
    return (d.web?.results || []).map(res => ({
      source_id: "brave_search",
      source_tier: "tier3",
      title: res.title || "",
      url: res.url || "",
      text: (res.description || "").slice(0, 400),
      age: res.age || "",
    }));
  } catch (e) {
    console.error("Brave search failed:", e.message);
    return [];
  }
}

async function fetchAllSources() {
  const results = [];

  console.log("[Awareness] TIER 1: Primary sources (changelogs, releases, official)...");
  for (const [id, src] of Object.entries(SOURCES.tier1)) {
    if (src.type === "github_releases") {
      const items = await fetchGitHubReleases(id, src.url);
      results.push(...items);
      console.log(`  ${id}: ${items.length} releases`);
    } else if (src.type === "webfetch") {
      const items = await fetchWebPage(id, src.url, "tier1");
      results.push(...items);
      console.log(`  ${id}: ${items.length} links`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("[Awareness] TIER 2: Signal surfaces...");
  const hn = await fetchHN(50);
  results.push(...hn);
  console.log(`  hn_top: ${hn.length}`);

  // Show HN low-upvote = struggling solo founder, Sofistikat archetype hunt
  const hnShow = await fetchHNShowHN(30);
  results.push(...hnShow);
  console.log(`  hn_show_hn_struggling: ${hnShow.length}`);

  const subs = [
    ["r_localllama", "LocalLLaMA", "day", 25],
    ["r_claudeai", "ClaudeAI", "day", 25],
    ["r_aiengineer", "AI_Agents", "day", 20],
    ["r_saas", "SaaS", "week", 15],
    ["r_indiehackers", "indiehackers", "week", 15],
    // Added April 7 2026: Solo SaaS founder archetype hunt (validated by Sofistikat + College_Any)
    ["r_entrepreneur", "Entrepreneur", "day", 25],
    ["r_consulting", "consulting", "week", 15],
  ];
  for (const [id, sub, t, lim] of subs) {
    const items = await fetchReddit(id, sub, t, lim);
    results.push(...items);
    console.log(`  ${id}: ${items.length}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  // IndieHackers forum (webfetch on the forum index page)
  // Different from r/indiehackers subreddit - this is the canonical solo founder community
  try {
    const ihItems = await fetchWebPage("indiehackers_forum", "https://www.indiehackers.com/forum", "tier2");
    results.push(...ihItems);
    console.log(`  indiehackers_forum: ${ihItems.length}`);
  } catch (e) {
    console.error("  indiehackers_forum failed:", e.message);
  }

  console.log("[Awareness] TIER 2B: Business & Economy intelligence...");
  for (const [id, src] of Object.entries(SOURCES.tier2b)) {
    if (src.type === "reddit_json") {
      // Extract subreddit name, timeframe, and limit from the URL
      const subMatch = src.url.match(/\/r\/([^/]+)\/top\/\.json\?t=(\w+)&limit=(\d+)/);
      if (subMatch) {
        const items = await fetchReddit(id, subMatch[1], subMatch[2], parseInt(subMatch[3]));
        results.push(...items);
        console.log(`  ${id}: ${items.length}`);
      }
    } else if (src.type === "webfetch") {
      const items = await fetchWebPage(id, src.url, "tier2");
      results.push(...items);
      console.log(`  ${id}: ${items.length}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("[Awareness] TIER 3: Targeted searches...");
  for (const q of SOURCES.tier3_searches.queries) {
    const items = await braveSearch(q, 6);
    results.push(...items);
    console.log(`  "${q.slice(0, 40)}...": ${items.length}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// SAFETY: poison check
// ═══════════════════════════════════════════════════════════════════════════

function isPoisoned(item) {
  const text = `${item.title || ""} ${item.text || ""}`.toLowerCase();

  // Red flag phrases
  for (const phrase of RED_FLAG_PHRASES) {
    if (text.includes(phrase.toLowerCase())) return { poisoned: true, reason: `red_flag: ${phrase}` };
  }

  // Excluded domains
  try {
    const domain = new URL(item.url).hostname.replace(/^www\./, "");
    for (const excluded of EXCLUDED_DOMAINS) {
      if (domain.includes(excluded)) {
        // Check whitelist
        if (WHITELISTED_AUTHORS[item.url] || WHITELISTED_AUTHORS[domain]) {
          return { poisoned: false };
        }
        return { poisoned: true, reason: `excluded_domain: ${domain}` };
      }
    }
  } catch {}

  return { poisoned: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESCREEN: cheap keyword relevance
// ═══════════════════════════════════════════════════════════════════════════

const RELEVANCE_TERMS = [
  // AI / models
  "claude", "sonnet", "opus", "haiku", "gpt-", "openai", "anthropic", "llm",
  "gemini", "google ai", "deepmind", "meta ai", "llama",
  // Agents / orchestration
  "agent", "agentic", "orchestrat", "mcp", "model context protocol",
  "langgraph", "langchain", "crewai", "autogen",
  // Memory / RAG
  "memory", "rag", "vector", "embedding", "context window",
  // Automation
  "n8n", "workflow", "automation", "autonomous", "tool use", "function call",
  // Solo founder / GTM
  "solo founder", "indie hacker", "cold email", "outreach", "revenue",
  "first customer", "product hunt", "saas", "pricing",
  // Sales / first customers
  "getting clients", "cold outreach", "lead generation",
  "sales pipeline", "vibe code", "code audit", "scalability",
  // Lead response bottleneck (validated: r/Entrepreneur "sitting on 100k" post Apr 2026)
  // Contractor w/ $1M revenue + Meta ad leads but unread DMs = exact pain Kirill sells against
  "unread dms", "unread messages", "missed leads", "lead response",
  "missed calls", "not following up", "leads not responded", "sitting on leads",
  // Business & Economy signals (added April 23 2026)
  "ai adoption", "digital transformation", "ai investment", "ai spending",
  "ai budget", "ai consultant", "ai freelancer", "hiring ai",
  "implement ai", "ai integration", "ai strategy",
  "small business ai", "ai for business", "business automation",
  // Multi-agent failure taxonomy + production reliability (added 2026-05-09 from awareness apply)
  "error compounding", "conformity bias", "monoculture", "context rot",
  "lost in the middle", "stale shared state", "communication overhead",
  "single agent", "single-agent", "schema validation", "correlation id",
  "semantic cache", "checkpoint state", "agent reliability",
  // Rate limit / capacity as production failure mode
  "rate limit", "rate-limit", "rate limiting", "capacity failure",
  "exponential backoff", "retry logic", "circuit breaker", "throttling",
  // System self-validation / silent failures
  "silent failure", "circular validation", "false positive health",
  "fail loud", "ground truth check", "end-to-end validation",
  // Industry AI adoption
  "real estate ai", "healthcare ai", "legal ai", "construction ai",
  "retail ai", "restaurant ai", "logistics ai", "manufacturing ai",
  "insurance ai", "accounting ai", "marketing ai",
  // Canada specific
  "canada ai", "canadian business", "alberta", "calgary", "tariff",
  // USA market (bigger opportunity)
  "usa ai", "us small business", "american business ai",
  "silicon valley", "new york ai", "texas ai", "florida business",
  "us startup", "american entrepreneur", "sba", "us tariff",
  // Market & funding signals
  "seed round", "series a", "ai startup", "ai funding",
  "ai market", "ai revenue", "ai growth", "ai demand",
  // Competitive intelligence
  "ai agency", "ai consulting", "ai services", "ai freelance",
  "ai automation agency", "ai implementation",
  // Prompt caching / cost reduction (validated Apr 2026: 87% cost cut, sub-3s latency via warm-cache harness)
  "prompt caching", "prompt cache", "cache hit", "warm cache", "token cost", "cache hit rate",
  "anthropic caching", "context caching", "cost reduction", "latency reduction", "persistent agent",
  // Evaluation
  "evaluation", "eval", "prompt", "fine-tune", "rlhf",
  // Lead enrichment simplification (validated May 2026: Claude custom skill replaced 5-tool chain)
  "lead enrichment", "enrichment pipeline", "custom skill", "replace apollo", "replace pdl",
  "apollo clay zapier", "enrichment chain", "enrich workflow", "single tool enrichment",
  // Agent architecture simplicity signals (doctrine: simpler beats more agents)
  // Externally validated Apr 2026: VentureBeat experiments confirm single-agent > multi-agent swarms
  "single agent", "over-engineer", "agent complexity", "fewer agents",
  "simplify agent", "multi-agent failure", "agent overhead", "monolithic agent",
  "expensive loop", "context loss", "agent hype", "agents are just", "most ai agents",
  "agentic hype", "bad ux from agent", "agents fail in practice", "agent latency",
  "swarm tax", "coordination overhead", "multi-agent accuracy", "agent swarm",
  // Single-pass multimodal beats two-step pipeline (validated May 2026: Gemini 2.5 Flash receipt parsing at scale)
  "single-pass", "single pass", "two-step pipeline", "vision pipeline", "multimodal ocr",
  "receipt parsing", "document extraction", "invoice parsing", "parse receipts",
  "image extraction", "single model extraction", "two step vision",
  // Structure-first beats automation-first (validated Apr 2026: agency owner, 30+ automations)
  "automate chaos", "structured process", "should not have been automation",
  "process before automation", "operating system", "structure first",
  "automation fails", "broken process", "automating the wrong",
  // Professional services AI adoption (validated Apr 2026: 30+ projects across law/accounting/recruiting)
  "professional services", "law firm", "accounting firm", "recruiting firm",
  "consultancy automation", "same 5 tasks", "predictable workflow", "recurring tasks",
];

function prescreen(item) {
  const text = `${item.title || ""} ${item.text || ""}`.toLowerCase();
  const hits = RELEVANCE_TERMS.filter(t => text.includes(t));
  return { relevant: hits.length > 0, hits: hits.slice(0, 5) };
}

// ═══════════════════════════════════════════════════════════════════════════
// TRUTH FILTER via Claude CLI (main intelligence)
// ═══════════════════════════════════════════════════════════════════════════

async function scoreWithClaudeCLI(items) {
  // Batch evaluate through Claude CLI with strict doctrine
  const batchInput = items.map((item, i) => ({
    idx: i,
    source_id: item.source_id,
    source_tier: item.source_tier,
    title: item.title,
    url: item.url,
    text: (item.text || "").slice(0, 400)
  }));

  const prompt = `<role>Truth Filter for an autonomous AI bot system. Reject aggressively. Most items should be REJECT. Two real signals beat twenty fake ones.</role>

<scoring max="20">
source_distance: primary=6, secondary=3, tertiary=0
proof_density: code/metrics/demo=6, some=3, none=0
actionability: changes a bot today=4, future=2, theory=0
ai_fluff_absence: clearly human=2, mixed=1, fluff=0
relevance: direct=2, adjacent=1, unrelated=0
</scoring>

<verdicts>
ACCEPT >= 15
FLAG 11-14
REJECT < 11
</verdicts>

<auto_reject>
- title contains "revolutionary" / "10x" / "game-changer"
- tier3 source with no proof in text
- fewer than 2 relevance keywords and not a release
- dev.to / medium / substack with no verifiable author
</auto_reject>

<doctrine_bonus>
Practitioner posts showing MEASURABLE PROMPT CACHING results (cost reduction %, latency numbers, cache hit rate, open-source harness code) get +2 score bonus. Reason: our system pays full token cost on every Claude CLI subprocess call with zero caching - 87% cost reduction was demonstrated by an open-source warm-cache harness (Reddit r/artificial Apr 2026, sub-3s latency). Tag category as "technique", action_type="prompt_update" targeting awareness-bot.mjs. set why_matters to "direct cost reduction: our Claude CLI subprocess agents run with no prompt caching, paying full token cost per call - validated open-source pattern can cut API spend 70-90%, freeing budget for higher outreach volume".

Posts from practitioners arguing that FEWER agents, simpler orchestration, or single-agent patterns outperform complex multi-agent systems get +2 score bonus. Reason: direct validation of our internal principle (stability over features) and valuable as client-facing justification for simpler architectures. VALIDATED EXTERNALLY: VentureBeat (Apr 2026) confirmed via experiments that single-agent is the strongest default for multi-hop reasoning - higher accuracy, fewer tokens than multi-agent swarms. This is now cited evidence, not just doctrine. Tag category as "technique" and set action_type="prompt_update" pointing to awareness-bot.mjs if the argument is specific and evidence-backed. Specific failure modes that trigger this bonus: "expensive loops", "context loss between agents", "bad UX from multi-agent latency", "agents re-doing each other's work", "hard to debug multi-agent chains", "swarm tax", "coordination overhead". These are the concrete objections Kirill uses when clients ask why not to buy full autonomous multi-agent systems from competitors. why_matters should reference: "client objection ammo: experiments confirm single-agent beats multi-agent swarms on accuracy and token cost - cite VentureBeat Apr 2026 when positioning simpler workflow packages against AI agency competitors promising 'fully autonomous' systems. ADDITIONAL EVIDENCE Apr 2026 (r/AI_Agents): practitioner tracking agent research papers finds reliability rising overall BUT tool-use, planning, and multi-agent coordination specifically all declining - field hit a reliability wall. Paper-backed evidence that more agents = less reliable, not more. Cite alongside VentureBeat Apr 2026 when prospects ask why not to buy complex multi-agent system from a competitor".

Practitioner posts showing a SINGLE Claude custom skill or single-tool replacing a multi-step enrichment pipeline (Apollo+PDL+verify+CRM chains) get +2 score bonus. Reason: direct validation that single-tool orchestration beats multi-vendor enrichment stacks. VALIDATED May 2026 (r/ClaudeAI): practitioner collapsed 5-tool chain (Apollo+PDL+second enrichment+email verify+HubSpot) into one Claude custom skill - broken chain eliminated, same output. Tag category as "technique" and set action_type="prompt_update" pointing to awareness-bot.mjs. why_matters should reference: "client objection ammo when prospects ask why not to buy a complex multi-tool enrichment stack: single Claude skill collapses 5-step chain, removes failure points, faster iteration. Direct positioning against agencies selling Apollo+Clay+Zapier enrichment stacks. Applies to our outreach pipeline and lead response package positioning."

Real business owner stories about LEAD RESPONSE BOTTLENECK get +2 score bonus: contractor/owner with real revenue but unread DMs, missed calls, or leads piling up unanswered. Pattern validated Apr 2026 (r/Entrepreneur: $1M contractor, Meta ad leads, zero follow-up = direct pain Kirill's Lead Response System solves). Tag category as "case_study", action_type="none" (outreach copy inspiration, not a bot change), set why_matters to "comment hook and case study angle for outreach".

Practitioner posts arguing STRUCTURE-FIRST BEATS AUTOMATION-FIRST get +2 score bonus: real operators (agency owners, consultants, builders with 10+ shipped projects) concluding that automating broken/chaotic processes fails, and structured operating systems must come before automation. Validated Apr 2026 (r/AI_Agents: agency owner, 30+ automations, most should not have been automations). Differentiates Kirill's 'AI-assisted operating system' positioning from generic automation vendors. Tag category as "case_study", action_type="none", set why_matters to "comment hook: we automate chaos and wonder why it fails - operator mindset differentiator for outreach and LinkedIn content". ADDITIONAL EVIDENCE Apr 2026 (r/AI_Agents): practitioner with 30+ shipped automations across law firms, accounting, recruiting, and consultancies finds the same 5 tasks repeat in every engagement and NONE require AI agents - structured workflow wins. Direct ICP validation: professional services buyers have predictable, repeatable workflow pain. The 5 recurring tasks map directly to Kirill's 7 workflow packages (lead response, follow-up, coordination, reporting, intake triage). Posts from practitioners in professional services (law, accounting, recruiting, consulting) describing repetitive workflow pain are high-value comment hooks - operator-level pattern recognition establishes credibility fast with this exact buyer segment.

Practitioner posts showing SINGLE-PASS multimodal beats TWO-STEP vision+LLM pipelines get +2 score bonus: real builders processing production data (receipts, invoices, documents, images at scale) who find that a single model extraction pass outperforms chained vision+parsing architectures on both accuracy and cost. VALIDATED May 2026 (r/artificial): practitioner used Gemini 2.5 Flash to parse thousands of real receipts, found single-pass extraction beats two-step pipeline. This is a concrete production example of simpler architecture outperforming chained agents - directly mirrors our single-agent > multi-agent doctrine. Tag category as "technique", action_type="prompt_update" targeting awareness-bot.mjs. why_matters should reference: "client objection ammo: single-pass beats two-step is a concrete production example of simpler architecture outperforming chained agents - cite alongside VentureBeat Apr 2026 when prospects ask why not buy a full autonomous AI system. Applies to multimodal extraction, document processing, and any pipeline where competitors sell complexity."

Posts naming SPECIFIC NAMED FAILURE MODES of multi-agent LLM systems get +2 score bonus. Reference taxonomy from Redis engineering (May 2026): error compounding across stages, conformity bias and monoculture (same model for plan + verify), context rot in middle content (lost-in-the-middle), stale shared state (concurrent reads of superseded data), communication overhead exceeding benefit. When a post names ANY of these patterns explicitly with examples, tag category="technique", action_type="prompt_update" targeting awareness-bot.mjs, and set why_matters to: "client objection ammo with named taxonomy - cite Redis engineering blog May 2026 alongside VentureBeat for prospects asking why we don't sell fully-autonomous multi-agent systems". Counter-patterns from same source (use these as positive evidence): single-agent default, schema-validated boundaries, durable checkpoints, observability with correlation IDs, semantic caching (cited 15x speedup, 73% cost reduction).

Posts about RATE LIMITS being the dominant production LLM failure mode get +2 score bonus: any practitioner or vendor data showing that capacity (not model quality) is now the top operational risk in production LLM stacks. Pattern: 60% of LLM call errors are rate limits (Datadog telemetry Feb 2026, dropping to 30% in March as overall error rate fell). Direct relevance to our orchestrator-loop and sonnet-bots-daemon which currently have minimal retry/backoff logic. Tag category="technique", action_type="rule_update" targeting scripts/factory/orchestrator-loop.mjs. why_matters: "concrete justification for adding exponential-backoff retry rules to our LLM call wrappers - silent capacity failures are the most likely undiagnosed source of bot degradation".

Posts about systems SILENTLY LYING about their own state get +2 score bonus: practitioner accounts of validation chains where the system confirms itself using its own outputs (circular validation), bots reporting health without proving the full chain, or sub-component "ok" status while end-to-end is broken. Our memory rules feedback_fail_loud_never_fake and feedback_never_claim_works exist precisely because we hit this pattern (false "works" claims, surface health checks). Tag category="technique", action_type="prompt_update" targeting scripts/factory/orchestrator.mjs. why_matters: "system design reinforcement - any validation pattern reading own outputs to confirm own outputs is fundamentally broken; require independent ground-truth check at every health-status assertion".
</doctrine_bonus>

<example>
input: {"idx":0,"source_id":"anthropic_engineering","source_tier":1,"title":"Effective context engineering","url":"https://anthropic.com/...","text":"Right altitude in system prompts. XML structure. Just-in-time retrieval..."}
output: {"idx":0,"score":17,"verdict":"ACCEPT","category":"technique","summary":"Anthropic guidance on structuring agent prompts: right altitude, XML, just-in-time context.","why_matters":"Direct rules for our 10 bot prompts, can apply to awareness-bot first.","action_target":"scripts/factory/awareness-bot.mjs prompt","action_type":"prompt_update","confidence":"high","red_flags":[]}
</example>

<output_schema>
{"results":[{"idx":N,"url":"...","title":"...","score":0-20,"verdict":"ACCEPT|FLAG|REJECT","category":"model_release|framework_update|technique|case_study|gtm_tactic|tool|market_opportunity|country_investment|regulation|economic_trend|competitor_move|other","summary":"one sentence","why_matters":"specific impact on our business, market entry, or system OR N/A","action_target":"bot/file/market or none","action_type":"prompt_update|rule_update|new_tool|workflow_change|test_needed|market_analysis|strategy_update|none","confidence":"high|medium|low","red_flags":[]}]}
</output_schema>

<format_rules>Short hyphens only, never em dashes. Straight quotes. Return ONLY the JSON object, no preamble.</format_rules>

<items>${JSON.stringify(batchInput)}</items>
be brief.`;

  try {
    // Write prompt for logging
    const tmpFile = resolve(AWARENESS_DIR, ".tmp-prompt.txt");
    writeFileSync(tmpFile, prompt);

    // Use GPT API via callAI (migrated from Claude CLI April 15)
    const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");
    const output = await callAI(prompt, "Evaluate these items now. Return ONLY the JSON object. Be brief.", MODEL_STRONG, true);
    if (!output) {
      console.error("[Awareness] GPT returned empty response");
      return null;
    }

    const outputStr = typeof output === "string" ? output : JSON.stringify(output);
    const jsonMatch = outputStr.match(/\{[\s\S]*"results"[\s\S]*\}/);
    if (!jsonMatch) {
      // callAI with json=true may have returned parsed object directly
      if (output && output.results) return output.results;
      console.error("[Awareness] No JSON in GPT response, first 500 chars:", outputStr.slice(0, 500));
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.results || [];
  } catch (e) {
    console.error("[Awareness] GPT evaluate failed:", e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEDUP: don't re-show items from previous days
// ═══════════════════════════════════════════════════════════════════════════

function loadSeenUrls() {
  try {
    if (existsSync(SEEN_URLS_FILE)) {
      const data = JSON.parse(readFileSync(SEEN_URLS_FILE, "utf-8"));
      // Only keep last 14 days of seen URLs
      const cutoff = Date.now() - 14 * 86400000;
      return Object.fromEntries(
        Object.entries(data).filter(([url, ts]) => ts > cutoff)
      );
    }
  } catch {}
  return {};
}

function saveSeenUrls(seen) {
  try {
    writeFileSync(SEEN_URLS_FILE, JSON.stringify(seen, null, 2));
  } catch (e) {
    console.error("Failed to save seen URLs:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY BRIEF FORMAT
// ═══════════════════════════════════════════════════════════════════════════

function formatBrief(date, stats, accepted, flagged) {
  let md = `# Awareness Brief - ${date}\n\n`;
  md += `## Summary\n`;
  md += `- Fetched: ${stats.fetched}\n`;
  md += `- Poisoned (auto-rejected): ${stats.poisoned}\n`;
  md += `- Passed relevance prescreen: ${stats.prescreened}\n`;
  md += `- Already seen (deduped): ${stats.deduped}\n`;
  md += `- Evaluated by Claude: ${stats.evaluated}\n`;
  md += `- ACCEPTED: ${accepted.length}\n`;
  md += `- FLAGGED: ${flagged.length}\n`;
  md += `- REJECTED: ${stats.rejected}\n\n`;

  if (accepted.length === 0 && flagged.length === 0) {
    md += `## VERDICT: Nothing actionable today.\n\n`;
    md += `All sources scanned. No signals passed the truth filter.\n`;
    md += `Continue current execution. Check again tomorrow.\n\n`;
    return md;
  }

  if (accepted.length > 0) {
    md += `## ACCEPTED (actionable)\n\n`;
    accepted.forEach((item, i) => {
      md += `### ${i + 1}. [${item.score}/20] ${item.title}\n`;
      md += `- **Category:** ${item.category}\n`;
      md += `- **Summary:** ${item.summary}\n`;
      md += `- **Why matters:** ${item.why_matters}\n`;
      md += `- **Action target:** ${item.action_target}\n`;
      md += `- **Action type:** ${item.action_type}\n`;
      md += `- **Confidence:** ${item.confidence}\n`;
      md += `- **URL:** ${item.url}\n`;
      if (item.red_flags?.length) md += `- **Red flags:** ${item.red_flags.join(", ")}\n`;
      md += `\n`;
    });
  }

  if (flagged.length > 0) {
    md += `## FLAGGED (manual review)\n\n`;
    flagged.forEach((item, i) => {
      md += `${i + 1}. [${item.score}/20] ${item.title} - ${item.summary} (${item.url})\n`;
    });
    md += `\n`;
  }

  md += `\n---\n_Generated ${new Date().toISOString()} by awareness-bot v1_\n`;
  return md;
}

// ═══════════════════════════════════════════════════════════════════════════
// TELEGRAM NOTIFICATION (only if actionable)
// ═══════════════════════════════════════════════════════════════════════════

async function notifyKirill(date, accepted, flagged) {
  if (!TG_TOKEN || !CHAT_ID) return;
  if (accepted.length === 0 && flagged.length === 0) return;

  let msg = `<b>🧠 Awareness Brief - ${date}</b>\n\n`;
  msg += `ACCEPTED: ${accepted.length}\n`;
  msg += `FLAGGED: ${flagged.length}\n\n`;

  if (accepted.length > 0) {
    msg += `<b>Signals:</b>\n`;
    for (const item of accepted.slice(0, 5)) {
      const title = (item.title || "untitled").slice(0, 70);
      msg += `- [${item.score}/20] ${title}\n`;
      msg += `  ${(item.summary || "").slice(0, 120)}\n`;
      if (item.action_target !== "none") {
        msg += `  -> ${item.action_target}\n`;
      }
      msg += `\n`;
    }
  }

  msg += `\nFull brief: .data/awareness/latest.md`;

  try {
    const { safeSend } = await import("../lib/safe-send.mjs");
    const guard = await safeSend({ channel: "telegram", text: msg, meta: { source: "awareness-bot:digest" } });
    if (!guard.ok) {
      console.error(`[awareness-bot] BLOCKED by egress-guard: ${guard.egress_reason || guard.reason}`);
      return;
    }
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: "HTML" })
    });
  } catch (e) {
    console.error("TG notify failed:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function run() {
  const date = new Date().toISOString().slice(0, 10);
  console.log(`[Awareness] Starting daily run for ${date}`);

  if (!existsSync(AWARENESS_DIR)) mkdirSync(AWARENESS_DIR, { recursive: true });
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });

  const stats = { fetched: 0, poisoned: 0, prescreened: 0, deduped: 0, evaluated: 0, rejected: 0 };

  // 1. FETCH
  const raw = await fetchAllSources();
  stats.fetched = raw.length;

  // 2. DEDUP URLs across days
  const seenUrls = loadSeenUrls();
  const unique = raw.filter(item => {
    if (!item.url || seenUrls[item.url]) {
      if (seenUrls[item.url]) stats.deduped++;
      return false;
    }
    return true;
  });
  console.log(`[Awareness] ${stats.fetched} fetched, ${stats.deduped} already seen, ${unique.length} new`);

  // 3. SAFETY
  const safe = unique.filter(item => {
    const check = isPoisoned(item);
    if (check.poisoned) {
      stats.poisoned++;
      return false;
    }
    return true;
  });
  console.log(`[Awareness] ${stats.poisoned} poisoned removed, ${safe.length} safe`);

  // 4. PRESCREEN (keyword-based, cheap)
  const relevant = safe.filter(item => prescreen(item).relevant);
  stats.prescreened = relevant.length;
  console.log(`[Awareness] ${relevant.length} passed relevance prescreen`);

  if (relevant.length === 0) {
    const brief = formatBrief(date, stats, [], []);
    writeFileSync(LATEST_FILE, brief);
    writeFileSync(resolve(HISTORY_DIR, `${date}.md`), brief);
    // Mark fetched URLs as seen to avoid re-processing tomorrow
    const now = Date.now();
    for (const item of raw) if (item.url) seenUrls[item.url] = now;
    saveSeenUrls(seenUrls);
    console.log("[Awareness] Nothing relevant. Brief written.");
    return;
  }

  // 5. TRUTH FILTER via Claude CLI
  // Process in batches of 10 to keep context manageable and avoid rate limits
  const batchSize = 10;
  const allResults = [];
  const batches = [];
  for (let i = 0; i < relevant.length; i += batchSize) {
    batches.push(relevant.slice(i, i + batchSize));
  }
  console.log(`[Awareness] Running Claude truth filter on ${relevant.length} items in ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i++) {
    console.log(`  Batch ${i + 1}/${batches.length}...`);
    const results = await scoreWithClaudeCLI(batches[i]);
    if (results) {
      // Merge original item data with Claude's evaluation
      for (const r of results) {
        const original = batches[i][r.idx];
        if (original) {
          allResults.push({
            ...r,
            source_id: original.source_id,
            source_tier: original.source_tier,
          });
        }
      }
    } else {
      console.log(`  Batch ${i + 1} failed, skipping`);
    }
    // Rate limit between batches
    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  stats.evaluated = allResults.length;

  // 6. SPLIT by verdict
  const accepted = allResults
    .filter(r => r.verdict === "ACCEPT")
    .sort((a, b) => b.score - a.score);
  const flagged = allResults
    .filter(r => r.verdict === "FLAG")
    .sort((a, b) => b.score - a.score);
  stats.rejected = allResults.filter(r => r.verdict === "REJECT").length;

  console.log(`[Awareness] ACCEPT: ${accepted.length}, FLAG: ${flagged.length}, REJECT: ${stats.rejected}`);

  // 7. WRITE BRIEF
  const brief = formatBrief(date, stats, accepted, flagged);
  writeFileSync(LATEST_FILE, brief);
  writeFileSync(resolve(HISTORY_DIR, `${date}.md`), brief);

  // 8. UPDATE SEEN URLs
  const now = Date.now();
  for (const item of raw) if (item.url) seenUrls[item.url] = now;
  saveSeenUrls(seenUrls);

  // 9. DB LOG (run stats + individual items)
  try {
    const db = new Database(DB_PATH);
    db.prepare(`CREATE TABLE IF NOT EXISTS awareness_runs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      fetched INTEGER, prescreened INTEGER, evaluated INTEGER,
      accepted INTEGER, flagged INTEGER, rejected INTEGER,
      created_at TEXT NOT NULL
    )`).run();
    db.prepare(`INSERT OR REPLACE INTO awareness_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      date, date,
      stats.fetched, stats.prescreened, stats.evaluated,
      accepted.length, flagged.length, stats.rejected,
      new Date().toISOString()
    );

    // Persist individual ACCEPT + FLAG items so the auto-research petля
    // (research_apply_now hourly cron) has something to work with.
    // Without this, awareness_items table stays empty and the entire
    // find -> research -> apply loop is dead. Discovered April 7 2026
    // when Kirill asked "почему тишина" - bot was running but DB-disconnected.
    const nowIso = new Date().toISOString();
    const upsertItem = db.prepare(`
      INSERT INTO awareness_items
        (id, date, score, title, category, summary, why_matters, action_target, action_type, confidence, url, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        score = excluded.score,
        summary = excluded.summary,
        why_matters = excluded.why_matters,
        action_target = excluded.action_target,
        action_type = excluded.action_type,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `);
    let inserted = 0;
    for (const item of [...accepted, ...flagged]) {
      if (!item.url) continue;
      try {
        upsertItem.run(
          randomUUID(),
          date,
          item.score || 0,
          (item.title || "").slice(0, 500),
          item.category || "other",
          (item.summary || "").slice(0, 1000),
          (item.why_matters || "").slice(0, 1000),
          (item.action_target || "none").slice(0, 500),
          item.action_type || "none",
          item.confidence || "low",
          item.url,
          nowIso,
          nowIso
        );
        inserted++;
      } catch (e) {
        // Likely duplicate URL on existing schema variant - skip silently
      }
    }
    console.log(`[Awareness] DB persisted ${inserted} items (accepted+flagged)`);
    db.close();
  } catch (e) {
    console.error("DB log failed:", e.message);
  }

  // 10. NOTIFY KIRILL (only if actionable)
  await notifyKirill(date, accepted, flagged);

  // 11. AUTO-APPLY high-confidence accepted items via Claude CLI
  await applyAwarenessActions(accepted);

  // 12. AUTO-QUEUE Reddit comments for accepted items with score >= 17 and action_type=none
  try {
    const { autoQueueRedditComments } = await import("./awareness-apply.mjs");
    const redditResult = await autoQueueRedditComments();
    if (redditResult.queued > 0) {
      console.log(`[Awareness] Reddit comments queued: ${redditResult.queued}`);
    }
  } catch (e) {
    console.error(`[Awareness] Reddit comment auto-queue failed: ${e.message}`);
  }

  // 13. SEND comment drafts for workflow_change/gtm_tactic items to Telegram
  try {
    const { autoSendCommentDrafts } = await import("./awareness-apply.mjs");
    const draftResult = await autoSendCommentDrafts();
    if (draftResult.sent > 0) {
      console.log(`[Awareness] Comment drafts sent to Telegram: ${draftResult.sent}`);
    }
  } catch (e) {
    console.error(`[Awareness] Comment draft send failed: ${e.message}`);
  }

  // 14. AUTO-DISPATCH Reddit pain signals (score >= 13, case_study or pain_signal) to Telegram
  try {
    await dispatchRedditPainSignals([...accepted, ...flagged]);
  } catch (e) {
    console.error(`[Awareness] Reddit pain signal dispatch failed: ${e.message}`);
  }

  console.log(`[Awareness] Complete. Brief: ${LATEST_FILE}`);
  console.log(`[Awareness] Summary: ${accepted.length} accepted, ${flagged.length} flagged, ${stats.rejected} rejected`);
}

// ═══════════════════════════════════════════════════════════════════════════
// DIRECTED RESEARCH MODE
// system-brain or any bot can call:
//   node awareness-bot.mjs research "how to connect Twilio SMS to n8n for auto follow-up"
//
// Flow: Brave search → GPT evaluates → writes findings to wiki → notifies Telegram
// ═══════════════════════════════════════════════════════════════════════════

async function directedResearch(query) {
  console.log(`[Awareness] DIRECTED RESEARCH: "${query}"`);

  if (!BRAVE_KEY) {
    console.error("[Awareness] No BRAVE_SEARCH_API_KEY, cannot research");
    return null;
  }

  // 1. Search Brave for the topic
  const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  const searchResp = await fetch(searchUrl, {
    headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": BRAVE_KEY }
  });
  const searchData = await searchResp.json();
  const results = (searchData.web?.results || []).slice(0, 8).map(r => ({
    title: r.title, url: r.url, description: r.description
  }));

  if (results.length === 0) {
    console.log("[Awareness] No search results found");
    return null;
  }

  // 2. ACTUALLY FETCH page content from top results (not just snippets)
  console.log(`[Awareness] Fetching content from ${Math.min(results.length, 5)} pages...`);
  const pageContents = [];
  for (const r of results.slice(0, 5)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const pageResp = await fetch(r.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LaunchSoloAI-Research/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timeout);

      if (pageResp.ok) {
        const html = await pageResp.text();
        // Strip HTML tags, scripts, styles - extract text only
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[\s\S]*?<\/nav>/gi, "")
          .replace(/<footer[\s\S]*?<\/footer>/gi, "")
          .replace(/<header[\s\S]*?<\/header>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000); // Max 3000 chars per page

        if (text.length > 200) {
          pageContents.push({ url: r.url, title: r.title, content: text });
          console.log(`[Awareness] Fetched ${r.url} (${text.length} chars)`);
        } else {
          console.log(`[Awareness] Skipped ${r.url} (too short: ${text.length} chars)`);
        }
      }
    } catch (e) {
      console.log(`[Awareness] Failed to fetch ${r.url}: ${e.message}`);
    }
  }

  console.log(`[Awareness] Got content from ${pageContents.length} pages`);

  // 3. GPT synthesizes REAL page content into actionable knowledge
  const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");

  // Build context from real page content + search snippets for unfetched pages
  const fetchedContext = pageContents.map((p, i) =>
    `SOURCE ${i + 1}: ${p.title}\nURL: ${p.url}\nCONTENT:\n${p.content}`
  ).join("\n\n---\n\n");

  const unfetchedContext = results
    .filter(r => !pageContents.some(p => p.url === r.url))
    .map((r, i) => `UNFETCHED ${i + 1}: ${r.title}\n  URL: ${r.url}\n  Snippet: ${r.description}`)
    .join("\n");

  const synthesisPrompt = `Be brief.
You are the Awareness Bot doing directed research for an autonomous business system.

RESEARCH QUERY: "${query}"

ACTUAL PAGE CONTENT (extracted from real web pages):
${fetchedContext || "No pages could be fetched."}

${unfetchedContext ? `\nADDITIONAL SEARCH RESULTS (snippets only, NOT fetched):\n${unfetchedContext}` : ""}

CRITICAL RULES:
- ONLY use information that appears in the ACTUAL PAGE CONTENT above
- DO NOT invent data, statistics, or product names that are not in the sources
- If the pages don't contain what was asked for, say "Data not found in sources"
- Quote specific numbers, names, and facts from the content
- Cite which source each fact comes from

YOUR JOB:
1. Synthesize the search results into a clear, actionable answer
2. Focus on PRACTICAL implementation - what tools, what steps, what code patterns
3. Note any costs, limitations, or gotchas
4. Suggest how this could be integrated into an n8n workflow or Node.js bot

OUTPUT FORMAT (JSON):
{
  "query": "the original query",
  "answer": "2-4 paragraph practical answer with specific steps",
  "tools_mentioned": ["tool1", "tool2"],
  "implementation_steps": ["step 1", "step 2", "step 3"],
  "estimated_effort": "hours or days",
  "cost": "free / paid with pricing",
  "best_source": "URL of the most useful result",
  "confidence": "high|medium|low",
  "wiki_page_suggestion": "suggested wiki page name to save this knowledge"
}
be brief.`;

  const result = await callAI(synthesisPrompt, "Research and synthesize now. Be brief.", MODEL_STRONG, true);
  if (!result) {
    console.error("[Awareness] GPT synthesis failed");
    return null;
  }

  // 3. Parse result
  let findings;
  try {
    findings = typeof result === "string" ? JSON.parse(result.match(/\{[\s\S]*\}/)[0]) : result;
  } catch (e) {
    console.error("[Awareness] Failed to parse research result:", e.message);
    return null;
  }

  // 4. Write to wiki
  const wikiDir = resolve(__dirname, "../../wiki/market");
  const pageName = (findings.wiki_page_suggestion || "research-" + Date.now())
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  const wikiPath = resolve(wikiDir, `${pageName}.md`);

  const wikiContent = `# Research: ${query}

Last updated: ${new Date().toISOString().slice(0, 19)}Z
Source: awareness-bot directed research
Confidence: ${findings.confidence}

## Answer
${findings.answer}

## Implementation Steps
${(findings.implementation_steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Tools
${(findings.tools_mentioned || []).map(t => `- ${t}`).join("\n")}

## Cost
${findings.cost || "Unknown"}

## Effort
${findings.estimated_effort || "Unknown"}

## Best Source
${findings.best_source || "N/A"}
`;

  writeFileSync(wikiPath, wikiContent);
  console.log(`[Awareness] Research saved to wiki: ${wikiPath}`);

  // 5. Save silently to wiki - NO Telegram spam for routine research
  // Only notify if confidence is HIGH and findings are actionable
  if (TG_TOKEN && CHAT_ID && findings.confidence === "high") {
    const msg = `🔬 <b>Research (high confidence)</b>\n\n${query}\n\n${(findings.answer || "").slice(0, 600)}\n\nWiki: wiki/market/${pageName}.md`;

    try {
      const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: msg.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true })
      });
      const data = await r.json();
      if (!data.ok) console.error(`[Awareness] TG notification failed: ${JSON.stringify(data).slice(0, 200)}`);
    } catch (e) {
      console.error(`[Awareness] TG fetch error: ${e.message}`);
    }
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-APPLY: execute high-confidence ACCEPTED items via Claude CLI
// Only items with confidence "high" and a real action_type get auto-applied.
// Medium/low confidence items are flagged only (no auto-execution).
// ═══════════════════════════════════════════════════════════════════════════

async function applyAwarenessActions(accepted) {
  const { spawnSync } = await import("child_process");
  const { tgSendToKirill } = await import("./orchestrator.mjs");

  const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
  const PROJECT = "$CLAUDE_PROJECT_DIR";
  const PROMPT_FILE = resolve(PROJECT, ".data/awareness-action-prompt.md");
  const LOG_FILE = resolve(PROJECT, ".data/awareness-apply-log.json");

  // Filter: only high confidence with a real action_type
  const autoApplyItems = accepted.filter(item =>
    item.confidence === "high" &&
    item.action_type &&
    item.action_type !== "none" &&
    item.action_target &&
    item.action_target !== "none"
  );

  if (autoApplyItems.length === 0) {
    console.log("[Awareness] No high-confidence items to auto-apply");
    return;
  }

  console.log(`[Awareness] Auto-applying ${autoApplyItems.length} high-confidence items...`);

  // Load existing log
  let applyLog = [];
  try {
    if (existsSync(LOG_FILE)) {
      applyLog = JSON.parse(readFileSync(LOG_FILE, "utf-8"));
    }
  } catch {}

  const applied = [];
  const failed = [];

  for (const item of autoApplyItems) {
    const itemTitle = (item.title || "untitled").slice(0, 100);
    console.log(`[Awareness] Applying: ${itemTitle}`);
    console.log(`  action_type: ${item.action_type}, target: ${item.action_target}`);

    const taskPrompt = `Apply this awareness insight to the project at ${PROJECT}:

Title: ${itemTitle}
Summary: ${item.summary || "N/A"}
Action target: ${item.action_target}
Action type: ${item.action_type}
Why it matters: ${item.why_matters || "N/A"}
URL: ${item.url || "N/A"}

Rules:
- Make minimal, safe changes only
- If action_type is "rule_update", update the relevant config or prompt
- If action_type is "prompt_update", update the relevant prompt in the target file
- If action_type is "workflow_change", update the relevant script
- If action_type is "new_tool" or "test_needed", only create a TODO comment in the target file
- Do NOT delete existing functionality
- Do NOT change database schemas
- Do NOT modify .env files
- Report what you changed in 2-3 sentences`;

    try {
      writeFileSync(PROMPT_FILE, taskPrompt);

      const r = spawnSync("bash", ["-c",
        `cat "${PROMPT_FILE}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 5 --output-format text --allowedTools "Read,Edit,Grep,Glob" 2>&1`
      ], { cwd: PROJECT, encoding: "utf-8", timeout: 120000, maxBuffer: 5 * 1024 * 1024 });

      const output = (r.stdout || "").trim();
      const exitCode = r.status;

      if (exitCode === 0 && output.length > 10) {
        console.log(`[Awareness] Applied successfully: ${itemTitle}`);
        console.log(`  Result: ${output.slice(0, 200)}`);
        applied.push({
          title: itemTitle,
          action_type: item.action_type,
          action_target: item.action_target,
          result: output.slice(0, 500),
          timestamp: new Date().toISOString(),
        });
      } else {
        const stderr = (r.stderr || "").slice(0, 300);
        console.error(`[Awareness] Apply failed (exit ${exitCode}): ${itemTitle}`);
        console.error(`  stderr: ${stderr}`);
        failed.push({
          title: itemTitle,
          action_type: item.action_type,
          error: stderr || output.slice(0, 300) || "empty output",
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error(`[Awareness] Apply error: ${e.message}`);
      failed.push({
        title: itemTitle,
        action_type: item.action_type,
        error: e.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Persist log
  applyLog.push({
    date: new Date().toISOString().slice(0, 10),
    applied: applied.length,
    failed: failed.length,
    items: [...applied, ...failed.map(f => ({ ...f, status: "failed" }))],
  });
  // Keep last 30 entries
  if (applyLog.length > 30) applyLog = applyLog.slice(-30);
  try {
    writeFileSync(LOG_FILE, JSON.stringify(applyLog, null, 2));
  } catch (e) {
    console.error(`[Awareness] Failed to write apply log: ${e.message}`);
  }

  // Notify Kirill via Telegram
  if (applied.length > 0 || failed.length > 0) {
    let msg = `<b>Awareness Auto-Apply</b>\n\n`;
    msg += `Applied: ${applied.length}, Failed: ${failed.length}\n\n`;

    for (const a of applied.slice(0, 5)) {
      msg += `<b>${a.action_type}</b> -> ${a.action_target}\n`;
      msg += `${a.result.slice(0, 150)}\n\n`;
    }

    for (const f of failed.slice(0, 3)) {
      msg += `FAILED: ${f.title}\n`;
      msg += `${f.error.slice(0, 100)}\n\n`;
    }

    try {
      await tgSendToKirill(msg.slice(0, 4000));
    } catch (e) {
      console.error(`[Awareness] TG auto-apply notify failed: ${e.message}`);
    }
  }

  console.log(`[Awareness] Auto-apply complete: ${applied.length} applied, ${failed.length} failed`);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-DISPATCH: Reddit pain signals score >= 13 to Telegram for one-tap approval
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchRedditPainSignals(allScored) {
  const candidates = allScored.filter(item =>
    item.score >= 13 &&
    item.url && item.url.includes("reddit.com") &&
    (item.category === "case_study" || item.category === "pain_signal")
  );

  if (candidates.length === 0) {
    console.log("[Awareness] No Reddit pain signals qualify for dispatch (score<13 or non-Reddit or wrong category)");
    return;
  }

  console.log(`[Awareness] Generating reply drafts for ${candidates.length} Reddit pain signals...`);

  const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");
  const toDispatch = [];

  for (const item of candidates) {
    try {
      const subredditMatch = item.url.match(/reddit\.com\/r\/([^/]+)\//);
      const sub = subredditMatch ? subredditMatch[1] : "reddit";

      const draftPrompt = `You are writing a Reddit comment on behalf of a solo AI workflow consultant based in Calgary.

Post title: ${item.title}
Summary: ${item.summary || "N/A"}

Write a SHORT Reddit reply (3-6 sentences max) that:
- Acknowledges the specific pain described
- Offers one concrete actionable tip from a practitioner
- Does NOT mention any company or services
- Reads as a genuine helpful comment, not marketing
- Plain language, no em dashes, no hype words

Return ONLY the reply text.`;

      const draft = await callAI(draftPrompt, "Write the Reddit reply now. Plain text only.", MODEL_STRONG, false);
      if (!draft || typeof draft !== "string" || draft.trim().length < 20) {
        console.log(`[Awareness] Draft skipped for: ${(item.title || "").slice(0, 50)}`);
        continue;
      }

      toDispatch.push({
        url: item.url,
        title: item.title,
        sub,
        body: draft.trim(),
        score: item.score,
        category: item.category,
        summary: item.summary,
      });
    } catch (e) {
      console.error(`[Awareness] Draft gen error for ${item.url}: ${e.message}`);
    }
  }

  if (toDispatch.length === 0) {
    console.log("[Awareness] No awareness drafts generated");
    return;
  }

  try {
    const { dispatchFromAwareness } = await import("./dispatch-reddit-drafts.mjs");
    await dispatchFromAwareness(toDispatch);
    console.log(`[Awareness] Dispatched ${toDispatch.length} pain signal drafts to Telegram`);
  } catch (e) {
    console.error(`[Awareness] dispatchFromAwareness failed: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

const cmd = process.argv[2] || "daily";
if (cmd === "research") {
  const query = process.argv.slice(3).join(" ");
  if (!query) {
    console.error("Usage: node awareness-bot.mjs research \"your question here\"");
    process.exit(1);
  }
  directedResearch(query).catch(e => {
    console.error("[Awareness] RESEARCH FATAL:", e);
    process.exit(1);
  });
} else {
  run().catch(e => {
    console.error("[Awareness] FATAL:", e);
    process.exit(1);
  });
}
