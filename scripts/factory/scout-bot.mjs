/**
 * SCOUT BOT v3 - @LBO_Scout_bot
 * Охотник за РЕАЛЬНЫМИ клиентами. Северная Америка. 24/7.
 *
 * Источники:
 * 1. LinkedIn - бизнес-посты с болями (Apify)
 * 2. Threads - бизнес-сигналы (Apify)
 * 3. Reddit - бизнес-сабреддиты
 * 4. HackerNews - Ask HN от основателей
 * 5. Reddit r/forhire + r/hiring - активные покупатели
 */

import { randomUUID } from "crypto";
import { appendFileSync } from "fs";
import { getDb, BOTS, CHAT_ID, callAI, MODEL_MINI, tgSend, claimTasks, completeTask, heartbeat, createTask, emitEvent, sendMessage, setIntelligence, getIntelligenceKey, logActivity, env, reportKPIs, reportError, clearError, preflight } from "./orchestrator.mjs";

const BOT_TOKEN = BOTS.scout.token;
const BOT_ID = "scout";
const APIFY_KEY = env.APIFY_API_KEY;
const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;

// -- Brave Search - главный источник когда Apify/Twitter недоступны ----
async function scanBrave() {
  if (!BRAVE_KEY) return [];
  const queries = [
    // Calgary SMBs with workflow pain (PRIMARY MARKET)
    "Calgary small business automate workflow",
    "Calgary business manual process wasting time",
    "Calgary contractor scheduling automation",
    "Calgary cleaning company software workflow",
    "Calgary construction scheduling follow-up",
    // Canadian SMBs looking for automation help
    "site:reddit.com Calgary business automation help",
    "site:reddit.com Alberta small business automate",
    "Canadian small business workflow automation",
    // Direct buyer intent - people actively looking for automation services
    "site:reddit.com \"looking for someone to automate\" OR \"need help automating\"",
    "site:reddit.com smallbusiness \"automate\" \"manual\" OR \"hours\"",
    // Calgary local businesses with pain signals
    "Calgary property management company scheduling software",
    "Calgary dental clinic appointment booking automation",
    "Calgary restaurant owner operations management software",
    "Calgary plumber electrician HVAC contractor scheduling dispatch",
    // Calgary buyer-intent - AI tool selection/implementation (not generic automation)
    "site:reddit.com Calgary small business AI help",
    "site:linkedin.com/posts Calgary business owner AI implementation",
    "site:facebook.com/groups Calgary entrepreneurs automate admin",
    "site:reddit.com Alberta small business ChatGPT workflow",
    "site:linkedin.com/posts Calgary dental AI automation",
    // Calgary franchise/chain-business owners - ICP pivot
    "Calgary franchise owner automation workflow",
    "Calgary franchise operations software management",
    "site:reddit.com Calgary franchise \"multi-location\" automation",
    "site:reddit.com Alberta franchise owner automate operations",
    // Canadian SMB owners explicitly asking for n8n/Zapier/Make setup help - near-term implementation intent
    "site:reddit.com n8n setup small business",
    "site:reddit.com Zapier stuck small business owner",
    "site:linkedin.com/posts Make.com automation help business owner",
    "site:facebook.com/groups Zapier consultant Canada",
    "site:reddit.com looking for someone to build automation business",
    // High-intent hiring cluster - Canadian SMB owners actively seeking to buy implementation help
    "site:reddit.com automation freelancer small business",
    "site:reddit.com looking for zapier expert business",
    "site:reddit.com need someone to build make.com workflow",
    "site:linkedin.com/posts small business owner automation consultant",
    "site:facebook.com/groups looking for zapier expert canada",
    // Canada hiring-help-now cluster - SMB owners explicitly asking for automation freelancer/contractor/agency
    "site:reddit.com looking for zapier expert canada",
    "site:reddit.com need automation freelancer small business",
    "site:indiehackers.com automation consultant",
    "site:facebook.com/groups looking for make.com expert",
    "site:linkedin.com/posts hiring ai automation consultant small business",
    // Canada receptionist/phone-system-to-workflow-automation switching cluster
    "site:reddit.com Grasshopper missed calls small business",
    "site:reddit.com after hours voicemail small business help",
    "site:reddit.com receptionist too expensive small business canada",
    "site:facebook.com/groups Grasshopper small business help",
    "site:linkedin.com/posts small business owner missed calls admin overload",
    // Australia fiscal-year sprint (FY26 ends June 30 - budget-flush window)
    "australia saas founder workflow",
    "australian startup automation",
    "aus tech founder operations",
    "site:reddit.com australia \"automate\" small business",
    "site:reddit.com australian founder workflow pain",
    // Canada dental and physiotherapy clinic vertical - front-desk/admin pain cluster
    "site:reddit.com dental office front desk overwhelmed",
    "site:reddit.com physiotherapy clinic admin overwhelmed",
    "site:facebook.com/groups dental office manager scheduling help",
    "site:linkedin.com/posts clinic manager intake process manual",
    "\"Calgary\" (dental clinic OR physio clinic) (automation OR admin OR scheduling)",
    "site:reddit.com dental office no-show appointment",
    "site:reddit.com physiotherapy no-shows manual booking",
    "site:reddit.com dental receptionist overloaded intake forms",
    "site:reddit.com physio clinic front desk bottleneck",
    "site:linkedin.com/posts dental office manager automate follow-up",
  ];
  const results = [];
  for (const q of queries) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5&freshness=pw`;
      const res = await fetch(url, {
        headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": BRAVE_KEY },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) { console.log(`[ScoutBot] Brave ${res.status} for: ${q.slice(0,40)}`); continue; }
      const data = await res.json();
      for (const r of (data.web?.results || [])) {
        results.push({
          title: r.title || "",
          body: (r.description || "").slice(0, 400),
          url: r.url,
          platform: "brave_search",
          author: r.url?.match(/reddit\.com\/r\/\w+\/comments\/\w+\/([^/]+)/)?.[1] || r.extra_snippets?.[0] || "web",
          score: 0,
          postedAt: r.page_age || new Date().toISOString(),
        });
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`[ScoutBot] Brave error: ${err.message}`);
    }
  }
  console.log(`[ScoutBot] Brave: ${results.length} results`);
  return results;
}

// -- ФИЛЬТР 1: Источники ----------------------------------------------
// Только бизнес-сабреддиты. Никаких технических/хобби.
const BUSINESS_SUBREDDITS = [
  // Владельцы бизнеса
  "smallbusiness", "entrepreneur", "startups", "business",
  // Операции и продуктивность
  "operations", "productivity", "remotework",
  // Конкретные индустрии (клиенты Кирилла)
  "legaltech", "healthtech", "realestateinvesting",
  "accounting", "consulting", "agencyland",
  // Автоматизация глазами бизнеса (не разработчиков)
  "nocode", "automation",
  // Высокомаржинальные B2B сегменты (добавлено)
  "msp",            // Managed Service Providers - IT-компании с реальными бюджетами
  "ecommerce",      // e-commerce бизнесы часто ищут автоматизацию
  "ITManagers",     // IT-менеджеры с бюджетом на решения
  "salesforce",     // Salesforce пользователи → интеграции, автоматизация
  "hubspot",        // HubSpot пользователи → CRM автоматизация
  // Franchise/chain-business ICP - higher budget, 10x automation pain vs solo
  "Franchises",
  "FranchisedBusiness",
  // Calgary / Canada local business
  "Calgary",        // r/Calgary - local business owners
  "alberta",        // r/alberta - provincial SMBs
  "canadasmallbusiness" // Canadian SMBs
];

// -- ФИЛЬТР 2: Обязательные бизнес-сигналы ---------------------------
// Хотя бы один из этих сигналов ОБЯЗАН присутствовать
const MUST_HAVE_SIGNALS = [
  // Деньги и затраты
  "zapier", "make.com", "per month", "monthly cost", "subscription",
  "paying for", "bill", "invoice", "pricing",
  // Роль/компания
  "my business", "our company", "my team", "my clients", "our clients",
  "my agency", "my firm", "my practice", "employees", "my staff",
  // Намерение купить
  "looking for", "need help", "hire", "consultant", "agency",
  "recommend", "suggestion", "who can", "looking to outsource",
  "freelancer", "contractor help",
  // Compliance/безопасность (высокомаржинальный сегмент)
  "pipeda", "hipaa", "gdpr", "compliance", "data privacy",
  "confidential", "nda", "on-premise", "self-hosted", "local ai",
  // Боль операций - расширено для SMB языка
  "manual process", "copying", "data entry", "repetitive",
  "hours a day", "hours per week", "wasting time", "bottleneck",
  "we spend", "it takes", "too much time", "costing us",
  "struggling with", "can't keep up", "falling behind",
  "this process", "our workflow", "our operation",
  // MSP/Enterprise контекст
  "our clients", "our msp", "client base", "ticket velocity",
  "n8n", "workflow automation", "agentic", "ai workflow", "ai agent",
  "rmm", "psa", "managed service", "service desk",
  // E-commerce контекст
  "shopify", "woocommerce", "order fulfillment", "inventory",
  "product listing", "store automation",
  // Calgary/Alberta local context
  "calgary", "alberta", "edmonton", "yyc",
];

// -- ФИЛЬТР 3: Автоматический стоп-лист ------------------------------
// Если любое из этих слов есть → выброс без AI-проверки
const INSTANT_REJECT = [
  "i'm learning", "im learning", "just started", "beginner",
  "student", "university", "college", "course", "tutorial",
  "how do i", "how to learn", "what is", "explain to me",
  "side project", "hobby", "fun project", "personal project",
  "for myself", "just curious", "hypothetically",
  "open source", "contributing", "github", "pull request",
  "job posting", "looking for work", "looking for a job",
  "hiring me", "portfolio", "resume", "interview",
  // Job seeker signals - NOT buyers
  "apply now", "apply here", "submit resume", "send cv",
  "full-time position", "salary range", "w2", "job description",
  "qualifications required", "years of experience required",
];

// -- ФИЛЬТР 4: Индустрии с высоким чеком -----------------------------
const HIGH_VALUE_INDUSTRIES = [
  "law", "legal", "attorney", "lawyer", "firm",
  "medical", "clinic", "dental", "healthcare", "hospital",
  "oil", "gas", "energy", "mining",
  "financial", "finance", "accounting", "cpa", "tax",
  "real estate", "mortgage", "insurance",
  "consulting", "agency", "marketing agency",
  "saas", "software company", "tech company",
  // Calgary local service businesses (Kirill's best-fit verticals)
  "cleaning service", "cleaning company", "property management",
  "contractor", "electrician", "plumber", "hvac",
  "home service", "field service", "landscaping",
  "roofing", "renovation", "construction",
];

// -- LinkedIn Pain Phrase Scanner -------------------------------------
const LINKEDIN_PAIN_PHRASES = [
  "spending hours",
  "manually",
  "overwhelmed",
  "can't keep up",
  "need to automate"
];

const LINKEDIN_POST_COMMENT_PHRASES = [
  "doing everything manually",
  "can't keep up",
  "built a pilot but",
  "spending hours on outreach",
  "looking for AI help"
];

const PAIN_WORKFLOW_MAP = {
  "spending hours":    { workflow: "reporting or data entry",  related: "staffing capacity" },
  "manually":         { workflow: "process automation",        related: "tool integration" },
  "overwhelmed":      { workflow: "task management",           related: "team bandwidth" },
  "can't keep up":    { workflow: "operations scaling",        related: "workflow bottleneck" },
  "need to automate": { workflow: "workflow setup",            related: "tool selection" }
};

function draftLinkedInPainReply(matchedPhrase) {
  const map = PAIN_WORKFLOW_MAP[matchedPhrase] || { workflow: "workflow automation", related: "tool integration" };
  return `"${matchedPhrase}" - is this a ${map.workflow} problem or more of a ${map.related} gap?`.slice(0, 200);
}

async function generateLinkedInCommentDraft(post) {
  return callAI(
    `You are Kirill D., an AI automation consultant in Calgary. Write a 1-2 sentence LinkedIn comment for the post below.
Rules:
- Reference a specific detail from the post content
- Ask one clarifying question OR offer one concrete insight
- Sound like a practitioner, not a vendor
- Max 200 characters
- No em dashes, no salesy language, no guarantees
Return only the comment text, nothing else.`,
    `Post author: ${post.author}\nPost: ${post.body || post.title}`
  );
}

// -- Scanner: Reddit --------------------------------------------------
async function scanReddit(subreddits, limit = 20) {
  const candidates = [];

  for (const sub of subreddits) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/new.json?limit=${limit}`,
        { headers: { "User-Agent": "LBO-ScoutBot/2.0" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const items = data?.data?.children || [];

      for (const item of items) {
        const p = item.data;
        const fullText = `${p.title} ${p.selftext || ""}`.toLowerCase();

        // ФИЛЬТР: стоп-лист - мгновенный отказ
        if (INSTANT_REJECT.some(w => fullText.includes(w))) continue;

        // ФИЛЬТР: должен быть хотя бы 1 бизнес-сигнал
        const hasBusinessSignal = MUST_HAVE_SIGNALS.some(s => fullText.includes(s));
        if (!hasBusinessSignal) continue;

        // Бонус за высокомаржинальную индустрию
        const industryBonus = HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i));

        candidates.push({
          id: p.id,
          platform: "reddit",
          subreddit: sub,
          title: p.title,
          body: (p.selftext || "").slice(0, 600),
          url: `https://reddit.com${p.permalink}`,
          author: p.author,
          redditScore: p.score,
          industryBonus,
          createdAt: new Date(p.created_utc * 1000).toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] Reddit r/${sub}: ${err.message}`);
    }
  }

  return candidates;
}

// -- Scanner: Reddit Keyword Search - ищем КОНКРЕТНЫЕ боли ------------
// В отличие от scanReddit (просматривает топ постов),
// этот сканер ищет по ключевым словам → находит другие посты
async function scanRedditKeywordSearch() {
  const candidates = [];

  // Пары: [subreddit, keyword] - целевые комбинации с высокой конверсией
  const searches = [
    ["smallbusiness",        "automate"],
    ["smallbusiness",        "manual process"],
    ["entrepreneur",         "automation workflow"],
    ["accounting",           "automate"],
    ["realestateinvesting",  "automate"],
    ["consulting",           "automation"],
    ["agencyland",           "automate"],
    ["operations",           "automate workflow"],
    ["nocode",               "need help"],
    ["automation",           "looking for help consultant"],
    // Новые высокоцелевые комбинации
    ["msp",                  "automate"],
    ["msp",                  "n8n OR zapier OR make.com"],
    ["ecommerce",            "automate order"],
    ["ecommerce",            "manual process"],
    ["ITManagers",           "automation workflow"],
    ["salesforce",           "automation consultant"],
    ["hubspot",              "automate"],
    ["smallbusiness",        "n8n"],
    ["smallbusiness",        "zapier alternative"],
    ["legaltech",            "automate documents"],
    // Franchise/chain ICP
    ["Franchises",           "automation OR workflow OR manual"],
    ["Franchises",           "franchise operations OR franchise software"],
    ["FranchisedBusiness",   "automate OR workflow OR manual process"],
    ["Entrepreneur",         "franchise operations OR multi-location management"],
    ["smallbusiness",        "franchise OR multi-location OR chain automation"],
    // Canadian SMB implementation-intent cluster - n8n/Zapier/Make setup requests
    ["smallbusiness",        "n8n setup OR n8n help OR n8n stuck"],
    ["smallbusiness",        "zapier setup OR zapier help OR zapier stuck"],
    ["smallbusiness",        "make.com setup OR make.com help"],
    ["entrepreneur",         "n8n OR zapier OR make.com setup help"],
    ["nocode",               "looking for someone to build OR need freelancer"],
    ["automation",           "n8n stuck OR zapier stuck OR make stuck"],
    ["Canada",               "automation consultant OR zapier consultant OR n8n freelancer"],
    ["smallbusiness",        "looking for someone to build automation"],
  ];

  for (const [sub, query] of searches) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&t=month&limit=8`,
        { headers: { "User-Agent": "LBO-ScoutBot/3.0 by KirillBot" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const items = data?.data?.children || [];

      for (const item of items) {
        const p = item.data;
        const fullText = `${p.title} ${p.selftext || ""}`.toLowerCase();

        if (INSTANT_REJECT.some(w => fullText.includes(w))) continue;
        const hasSignal = MUST_HAVE_SIGNALS.some(s => fullText.includes(s));
        if (!hasSignal) continue;

        const industryBonus = HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i));
        candidates.push({
          id: `rs-${p.id}`, // prefix to distinguish from regular reddit scan
          platform: "reddit",
          subreddit: sub,
          title: p.title,
          body: (p.selftext || "").slice(0, 600),
          url: `https://reddit.com${p.permalink}`,
          author: p.author,
          redditScore: p.score + 10, // slight boost - keyword match = higher intent
          industryBonus,
          createdAt: new Date(p.created_utc * 1000).toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] Reddit search r/${sub}: ${err.message}`);
    }
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- Scanner: HN "Who is hiring?" monthly thread ---------------------
// Companies post "SEEKING FREELANCER" in the monthly thread with real budgets.
// Different from scanHN() - this specifically targets the hiring thread comments.
async function scanHNHiring() {
  const candidates = [];
  const automationKeywords = [
    "automat", "workflow", "n8n", "zapier", "make.com", "notion",
    "integration", "crm", "ai workflow", "process automat", "rpa",
    "data pipeline", "business process", "operations"
  ];

  // Search for recent SEEKING FREELANCER comments with automation context
  const queries = [
    '"SEEKING FREELANCER" automation workflow',
    '"SEEKING FREELANCER" n8n OR zapier OR "make.com"',
    '"SEEKING FREELANCER" "business process" OR "operations"',
  ];

  for (const q of queries) {
    try {
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=comment&hitsPerPage=8`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const hit of (data.hits || [])) {
        const text = (hit.comment_text || "").replace(/<[^>]+>/g, "").trim();
        if (!text || text.length < 80) continue;
        if (!automationKeywords.some(k => text.toLowerCase().includes(k))) continue;
        if (INSTANT_REJECT.some(w => text.toLowerCase().includes(w))) continue;

        // Skip posts older than 45 days - HN hiring threads are monthly, old ones are irrelevant
        const ageDays = (Date.now() - new Date(hit.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 45) continue;

        const url = `https://news.ycombinator.com/item?id=${hit.objectID}`;
        const title = text.slice(0, 120).replace(/\n+/g, " ");

        candidates.push({
          id: `hn-hire-${hit.objectID}`,
          platform: "hackernews",
          title,
          body: text.slice(0, 600),
          url,
          author: hit.author || "HN User",
          redditScore: 80, // High priority - company with budget actively seeking
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => text.toLowerCase().includes(i)),
          createdAt: hit.created_at || new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] HN Hiring: ${err.message}`);
    }
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- Scanner: HackerNews ----------------------------------------------
async function scanHN() {
  const candidates = [];
  // Only "Ask HN" - founders asking for solutions, not developers showing off
  const queries = [
    "Ask HN automate business",
    "Ask HN workflow automation",
    "Ask HN Zapier alternative",
    "Ask HN local AI",
    "Ask HN data compliance"
  ];

  for (const q of queries) {
    try {
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=ask_hn&hitsPerPage=10`
      );
      const data = await res.json();

      for (const hit of (data.hits || [])) {
        const fullText = `${hit.title} ${hit.story_text || ""}`.toLowerCase();
        if (INSTANT_REJECT.some(w => fullText.includes(w))) continue;
        const hasBusinessSignal = MUST_HAVE_SIGNALS.some(s => fullText.includes(s));
        if (!hasBusinessSignal) continue;

        // Skip posts older than 30 days - Ask HN questions go stale quickly
        const ageDays = (Date.now() - new Date(hit.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 30) continue;

        candidates.push({
          id: hit.objectID,
          platform: "hackernews",
          title: hit.title,
          body: (hit.story_text || "").slice(0, 600),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          author: hit.author,
          redditScore: hit.points || 0,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: hit.created_at
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] HN: ${err.message}`);
    }
  }
  return candidates;
}

// -- Scanner: Indeed RSS (job postings = buyers with budget) ----------
// -- Scanner: Craigslist Calgary - прямые заказы на автоматизацию -----
async function scanCraigslist() {
  const candidates = [];
  const searches = [
    { url: "https://calgary.craigslist.org/search/cpg?query=automate&sort=date", label: "CL Calgary computer gigs" },
    { url: "https://calgary.craigslist.org/search/cpg?query=automation&sort=date", label: "CL Calgary automation" },
    { url: "https://calgary.craigslist.org/search/cpg?query=workflow&sort=date", label: "CL Calgary workflow" },
    { url: "https://calgary.craigslist.org/search/cpg?query=zapier&sort=date", label: "CL Calgary zapier" },
    { url: "https://calgary.craigslist.org/search/cpg?query=n8n&sort=date", label: "CL Calgary n8n" },
    { url: "https://calgary.craigslist.org/search/biz?query=automation+consultant&sort=date", label: "CL Calgary biz" },
    // Pan-Canadian + US major cities
    { url: "https://toronto.craigslist.org/search/cpg?query=automation+consultant&sort=date", label: "CL Toronto" },
    { url: "https://vancouver.craigslist.org/search/cpg?query=workflow+automation&sort=date", label: "CL Vancouver" },
    { url: "https://sfbay.craigslist.org/search/cpg?query=n8n+OR+zapier+automation&sort=date", label: "CL SF" },
  ];

  for (const { url, label } of searches) {
    try {
      const html = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 Chrome/120" },
        signal: AbortSignal.timeout(10000)
      }).then(r => r.ok ? r.text() : "");
      if (!html) continue;

      // Parse Craigslist search results
      const items = html.match(/<li class="cl-search-result[^"]*"[\s\S]*?<\/li>/g) || [];
      for (const item of items) {
        const titleMatch = item.match(/class="titlestring"[^>]*>([^<]+)<\/span>/);
        const linkMatch = item.match(/href="([^"]+\/[a-z0-9]+\.html)"/);
        const dateMatch = item.match(/datetime="([^"]+)"/);
        const title = titleMatch?.[1]?.trim();
        const link = linkMatch?.[1];
        if (!title || !link) continue;

        const fullLink = link.startsWith("http") ? link : `https://calgary.craigslist.org${link}`;
        const id = `cl-${fullLink.split("/").pop()?.replace(".html", "")}`;
        const fullText = title.toLowerCase();
        if (INSTANT_REJECT.some(w => fullText.includes(w))) continue;

        candidates.push({
          id,
          platform: "craigslist",
          title,
          body: title,
          url: fullLink,
          author: "Craigslist Poster",
          redditScore: 80,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: dateMatch?.[1] ? new Date(dateMatch[1]).toISOString() : new Date().toISOString()
        });
      }
      if (candidates.length) console.log(`[ScoutBot] ${label}: ${candidates.length} listings`);
    } catch (err) {
      console.warn(`[ScoutBot] Craigslist "${label}": ${err.message}`);
    }
  }
  return candidates;
}

async function scanIndeed() {
  const candidates = [];
  const searches = [
    "n8n automation developer",
    "zapier automation expert",
    "workflow automation consultant",
    "AI automation business",
    "business process automation",
    "notion consultant",
    "operations automation",
    "local AI server"
  ];

  for (const q of searches) {
    try {
      const res = await fetch(
        `https://www.indeed.com/rss?q=${encodeURIComponent(q)}&l=United+States&sort=date&limit=10`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" } }
      );
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<item>")) continue;

      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      for (const item of items) {
        const title = item.match(/<title>(.*?)<\/title>/s)?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
        const desc = item.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.replace(/<[^>]+>/g, "").slice(0, 600).trim() || "";
        const link = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || "";
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";

        if (!title || !link) continue;
        const fullText = `${title} ${desc}`.toLowerCase();
        if (INSTANT_REJECT.some(w => fullText.includes(w))) continue;

        candidates.push({
          id: `indeed-${Buffer.from(link).toString("base64").slice(-20)}`,
          platform: "indeed",
          title,
          body: desc,
          url: link,
          author: "Company (Indeed)",
          redditScore: 90,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] Indeed "${q}": ${err.message}`);
    }
  }
  return candidates;
}

// -- Scanner: Reddit r/forhire + r/hiring (immediate buyers) ----------
async function scanJobPosts() {
  const candidates = [];
  const jobSubs = ["forhire", "hiring"];

  for (const sub of jobSubs) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/new.json?limit=25`,
        { headers: { "User-Agent": "LBO-ScoutBot/2.0" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const items = data?.data?.children || [];

      for (const item of items) {
        const p = item.data;
        // Only HIRING posts (not "for hire")
        if (p.title.toLowerCase().startsWith("[for hire]")) continue;
        const fullText = `${p.title} ${p.selftext || ""}`.toLowerCase();

        const automationKeywords = ["automat", "workflow", "zapier", "n8n", "notion", "ai", "crm", "integration"];
        if (!automationKeywords.some(k => fullText.includes(k))) continue;
        if (INSTANT_REJECT.some(w => fullText.includes(w))) continue;

        candidates.push({
          id: p.id,
          platform: "reddit_jobs",
          subreddit: sub,
          title: p.title,
          body: (p.selftext || "").slice(0, 600),
          url: `https://reddit.com${p.permalink}`,
          author: p.author,
          redditScore: 85,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: new Date(p.created_utc * 1000).toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] r/${sub}: ${err.message}`);
    }
  }
  return candidates;
}

// -- Scanner: Upwork via Apify - немедленные покупатели с бюджетом ----
// Лучший источник: люди которые УЖЕ платят за проект
async function scanUpwork() {
  if (!APIFY_KEY) return [];
  const candidates = [];

  const searches = [
    "n8n workflow setup",
    "zapier migration n8n",
    "business automation consultant setup",
    "AI workflow automation",
    "make.com automation workflow"
  ];

  for (const query of searches.slice(0, 2)) { // 2 queries to save credits
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/neatrat~upwork-job-scraper/run-sync-get-dataset-items?token=${APIFY_KEY}&timeout=90&memory=512`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchQuery: query, maxResults: 10 })
        }
      );
      if (!res.ok) {
        console.warn(`[ScoutBot] Upwork Apify "${query}": ${res.status}`);
        continue;
      }
      const jobs = await res.json();

      for (const job of (Array.isArray(jobs) ? jobs : [])) {
        const title = job.title || "";
        const desc = (job.description || "").slice(0, 800);
        const link = job.url || "";
        const budget = job.budget || "";
        // Prefer North America but allow any paying client
        const location = job.clientLocation || "";

        if (!title || !link) continue;
        // Upwork = company job posts, skip INSTANT_REJECT (it was for Reddit hobbyists)

        const author = `${job.clientName || "Upwork Client"}${location ? ` (${location})` : ""}`;
        const upworkFullText = `${title} ${desc}`.toLowerCase();
        candidates.push({
          id: `uw-${Buffer.from(link).toString("base64").slice(-20)}`,
          platform: "upwork",
          title: title.trim(),
          body: [
            budget && budget !== "N/A" ? `Budget: ${budget}` : null,
            job.jobType ? `Type: ${job.jobType}` : null,
            job.clientTotalSpent > 0 ? `Client spent: $${Math.round(job.clientTotalSpent).toLocaleString()} on Upwork` : null,
            "",
            desc
          ].filter(Boolean).join("\n"),
          url: link,
          author,
          redditScore: 95,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => upworkFullText.includes(i)),
          createdAt: job.absoluteDate || new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] Upwork Apify "${query}": ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Dedup by URL
  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}


// -- Scanner: RemoteOK - контракты с зарплатами, публичный API ---------
// JSON API без авторизации. Теги: automation, workflow, ai, n8n, zapier
async function scanRemoteOK() {
  const candidates = [];
  const tags = ["automation", "workflow", "ai-tools", "n8n", "zapier", "no-code"];

  const EMPLOYMENT_SIGNALS = [
    "full-time", "full time", "salary", "annual salary", "per year", "/year",
    "health insurance", "dental", "401k", "rrsp", "paid time off", "equity", "stock options"
  ];

  for (const tag of tags) {
    try {
      const res = await fetch(
        `https://remoteok.com/api?tag=${encodeURIComponent(tag)}`,
        { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const jobs = (Array.isArray(data) ? data : []).filter(j => j.position && j.url);

      for (const job of jobs) {
        const title = job.position || "";
        const company = job.company || "Company";
        const desc = (job.description || "").replace(/<[^>]+>/g, "").slice(0, 700);
        const salary = job.salary || "";
        const fullText = `${title} ${desc} ${salary}`.toLowerCase();

        if (EMPLOYMENT_SIGNALS.some(s => fullText.includes(s))) continue;

        // Keep only consulting/contract/freelance relevant roles
        const relevant = ["automat", "workflow", "n8n", "zapier", "integrat", "ai ", "llm", "notio", "consultant", "freelan", "contract"];
        if (!relevant.some(k => fullText.includes(k))) continue;

        candidates.push({
          id: `rok-${job.id || Buffer.from(job.url).toString("base64").slice(-16)}`,
          platform: "remoteok",
          title: title.trim(),
          body: salary ? `Salary: ${salary}\n\n${desc}` : desc,
          url: job.url,
          author: company,
          redditScore: 88,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: job.date ? new Date(job.date * 1000).toISOString() : new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] RemoteOK tag "${tag}": ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- Scanner: WorkingNomads - контракты для удалённых специалистов -----
// JSON API без авторизации. Фокус на North America + remote.
async function scanWorkingNomads() {
  const candidates = [];
  const tags = ["automation", "ai", "no-code", "saas"];

  const EMPLOYMENT_SIGNALS = [
    "full-time", "full time", "salary", "annual salary", "per year",
    "health insurance", "dental", "401k", "paid time off", "equity"
  ];

  for (const tag of tags) {
    try {
      const res = await fetch(
        `https://www.workingnomads.com/api/exposed_jobs/?tag=${encodeURIComponent(tag)}`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; LBO-ScoutBot/3.0)" } }
      );
      if (!res.ok) continue;
      const jobs = await res.json();

      for (const job of (Array.isArray(jobs) ? jobs : [])) {
        const title = job.title || "";
        const company = job.company_name || "Company";
        const desc = (job.description || "").replace(/<[^>]+>/g, "").slice(0, 700);
        const fullText = `${title} ${desc}`.toLowerCase();

        if (EMPLOYMENT_SIGNALS.some(s => fullText.includes(s))) continue;

        const relevant = ["automat", "workflow", "n8n", "zapier", "integrat", "ai ", "llm", "notio", "consultant", "freelan"];
        if (!relevant.some(k => fullText.includes(k))) continue;

        candidates.push({
          id: `wn-${Buffer.from(job.url || title).toString("base64").slice(-16)}`,
          platform: "workingnomads",
          title: title.trim(),
          body: desc,
          url: job.url || `https://www.workingnomads.com`,
          author: company,
          redditScore: 85,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: job.pub_date ? new Date(job.pub_date).toISOString() : new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] WorkingNomads tag "${tag}": ${err.message}`);
    }
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- Scanner: Twitter/X - люди которые УЖЕ просят помощи -------------
// Ищем INTENT сигналы: "looking for", "need help", "anyone recommend"
// Требует TWITTER_BEARER_TOKEN в .env
async function scanTwitter() {
  const token = env.TWITTER_BEARER_TOKEN;
  if (!token) {
    console.log("[ScoutBot] Twitter: нет TWITTER_BEARER_TOKEN в .env - пропускаем");
    return [];
  }

  const candidates = [];
  const queries = [
    '("looking for" OR "need help" OR "anyone recommend" OR "who can help") (n8n OR zapier OR "automation consultant" OR "workflow automation") -is:retweet lang:en',
    '("zapier too expensive" OR "zapier alternative" OR "switched from zapier") -is:retweet lang:en',
    '("manual process" OR "doing it manually" OR "waste time") ("automate" OR "automation" OR "consultant") -is:retweet lang:en',
    '("looking for someone" OR "hire someone") ("automation" OR "n8n" OR "make.com" OR "ai workflow") -is:retweet lang:en',
  ];

  for (const q of queries) {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=10&tweet.fields=created_at,author_id,text&expansions=author_id&user.fields=name,username,description,public_metrics`;
      const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) {
        console.warn(`[ScoutBot] Twitter API ${res.status}: ${await res.text().then(t => t.slice(0,100))}`);
        continue;
      }
      const data = await res.json();
      const tweets = data.data || [];
      const users = {};
      (data.includes?.users || []).forEach(u => { users[u.id] = u; });

      for (const tweet of tweets) {
        const user = users[tweet.author_id] || {};
        const text = tweet.text || "";
        if (INSTANT_REJECT.some(w => text.toLowerCase().includes(w))) continue;

        candidates.push({
          id: `tw-${tweet.id}`,
          platform: "twitter",
          title: text.slice(0, 120),
          body: text,
          url: `https://twitter.com/${user.username || "i"}/status/${tweet.id}`,
          author: user.name || user.username || "Twitter User",
          authorUsername: user.username || "",
          authorBio: user.description || "",
          redditScore: (user.public_metrics?.followers_count || 0) > 500 ? 20 : 10,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => `${text} ${user.description || ""}`.toLowerCase().includes(i)),
          createdAt: tweet.created_at || new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] Twitter scan: ${err.message}`);
    }
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- Scanner: Quora - люди которые задают вопросы и ищут рекомендации -
// Публичный, без API. Ищем вопросы где люди просят помочь с автоматизацией.
async function scanQuora() {
  const candidates = [];
  const searches = [
    "best n8n consultant",
    "hire zapier expert automation",
    "automate business workflow consultant",
    "n8n vs zapier which better",
    "how to automate business processes consultant",
    "looking for automation expert recommendation"
  ];

  for (const q of searches) {
    try {
      const res = await fetch(
        `https://www.quora.com/search?q=${encodeURIComponent(q)}&type=question`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "text/html"
          },
          signal: AbortSignal.timeout(8000)
        }
      );
      if (!res.ok) continue;
      const html = await res.text();

      // Extract question titles from Quora HTML
      const questionRegex = /"questionText"\s*:\s*"([^"]{20,200})"/g;
      const urlRegex = /"questionUrl"\s*:\s*"(\/[^"]+)"/g;
      const questions = [];
      let m;
      while ((m = questionRegex.exec(html)) !== null) {
        questions.push(m[1].replace(/\\u[\dA-F]{4}/gi, c =>
          String.fromCharCode(parseInt(c.replace(/\\u/i, ''), 16))
        ));
      }
      const urls = [];
      while ((m = urlRegex.exec(html)) !== null) urls.push(m[1]);

      for (let i = 0; i < Math.min(questions.length, 5); i++) {
        const title = questions[i];
        const url = `https://quora.com${urls[i] || "/search?q=" + encodeURIComponent(q)}`;
        const fullText = title.toLowerCase();
        if (INSTANT_REJECT.some(w => fullText.includes(w))) continue;

        candidates.push({
          id: `qr-${Buffer.from(url).toString("base64").slice(-20)}`,
          platform: "quora",
          title,
          body: `Question asked on Quora: "${title}"`,
          url,
          author: "Quora User",
          redditScore: 15,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] Quora "${q}": ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- Scanner: LinkedIn через Google Custom Search API -----------------
// Официальный CSE API - не блокируется, 100 запросов/день бесплатно.
// Ищем публичные LinkedIn посты где люди ПРОСЯТ ПОМОЩИ с автоматизацией.
async function scanLinkedInViaGoogle() {
  const apiKey = env.GOOGLE_CSE_API_KEY;
  const cseId = env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) {
    console.log("[ScoutBot] LinkedIn/Google CSE: нет GOOGLE_CSE_API_KEY или GOOGLE_CSE_ID в .env");
    return [];
  }

  const candidates = [];
  // Ищем людей которые ПРЯМО СЕЙЧАС просят помощи с автоматизацией
  const queries = [
    `site:linkedin.com "looking for" "automation consultant"`,
    `site:linkedin.com "need help" "n8n" OR "zapier" OR "workflow automation"`,
    `site:linkedin.com "anyone recommend" "automation" "business"`,
    `site:linkedin.com "zapier too expensive" OR "cancel zapier" OR "zapier alternative"`,
    `site:linkedin.com "manual process" "automate" "consultant" OR "help"`,
    `site:linkedin.com "looking for someone" "workflow" "automate"`,
  ];

  for (const q of queries) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(q)}&num=5&lr=lang_en`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!res.ok) {
        const err = await res.text();
        console.warn(`[ScoutBot] LinkedIn CSE "${q.slice(0,40)}": ${res.status} - ${err.slice(0,100)}`);
        continue;
      }

      const data = await res.json();
      const items = data.items || [];

      for (const item of items) {
        const title = (item.title || "").replace(/ \| LinkedIn$/, "").trim();
        const snippet = (item.snippet || "").trim();
        const link = item.link || "";

        if (!title || !link) continue;
        if (!link.includes("linkedin.com")) continue;

        const fullText = `${title} ${snippet}`.toLowerCase();
        if (INSTANT_REJECT.some(w => fullText.includes(w))) continue;

        // Extract author from URL or title (linkedin.com/in/username or linkedin.com/posts/username...)
        const authorMatch = link.match(/linkedin\.com\/(?:in|posts)\/([^/?]+)/);
        const author = authorMatch
          ? authorMatch[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
          : "LinkedIn User";

        candidates.push({
          id: `lig-${Buffer.from(link).toString("base64").slice(-20)}`,
          platform: "linkedin_google",
          title,
          body: snippet,
          url: link,
          author,
          redditScore: 35, // High - CSE confirms real LinkedIn post with search intent
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] LinkedIn CSE "${q.slice(0,40)}": ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 200)); // CSE rate limit
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- Scanner: Remote Job Boards - активные покупатели ------------------
// Remotive + Jobicy: remote jobs with actual budgets
async function scanRemoteJobs() {
  const candidates = [];
  const sources = [
    {
      url: "https://remotive.com/remote-jobs/feed?search=automation+workflow",
      platform: "remotive"
    },
    {
      url: "https://remotive.com/remote-jobs/feed?search=n8n+zapier",
      platform: "remotive"
    },
    {
      url: "https://jobicy.com/feed/?search=automation+workflow&location=usa",
      platform: "jobicy"
    },
    {
      url: "https://jobicy.com/feed/?search=AI+automation+business",
      platform: "jobicy"
    }
  ];

  for (const source of sources) {
    try {
      const res = await fetch(source.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LBO-ScoutBot/3.0)" }
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

      for (const item of items) {
        const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
          || item.match(/<title>(.*?)<\/title>/)?.[1] || "").replace(/<[^>]+>/g, "").trim();
        const desc = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
          || item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "")
          .replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").slice(0, 700).trim();
        const link = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim()
          || item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim() || "";
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";

        if (!title || !link) continue;
        const fullText = `${title} ${desc}`.toLowerCase();
        // Skip people looking for work (not clients)
        if (fullText.includes("looking for work") || fullText.includes("for hire")) continue;
        // Skip employment/salaried positions - Kirill is a consultant, not a job seeker
        // These are companies posting full-time roles, not looking to hire a consultant
        const EMPLOYMENT_SIGNALS = [
          "full-time", "full time", "salary", "annual salary", "per year", "/year",
          "health insurance", "dental", "vision plan", "401k", "rrsp",
          "paid time off", "pto", "vacation days", "parental leave",
          "equity", "stock options", "benefits package",
          "we offer benefits", "competitive benefits", "total compensation",
          "w-2", "t4 slip", "employment contract"
        ];
        if (EMPLOYMENT_SIGNALS.some(sig => fullText.includes(sig))) continue;

        candidates.push({
          id: `rj-${Buffer.from(link).toString("base64").slice(-20)}`,
          platform: source.platform,
          title: title.trim(),
          body: desc,
          url: link,
          author: "Remote Employer",
          redditScore: 20, // Low priority - employment filter may miss some, AI scores them 0 anyway

          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => fullText.includes(i)),
          createdAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] Remote Jobs ${source.platform}: ${err.message}`);
    }
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- Scanner: LinkedIn via Apify --------------------------------------
// NOTE: Requires LinkedIn session cookies - disabled until cookies configured
async function scanLinkedIn() {
  // Auto-enabled when LINKEDIN_LI_AT is set in .env (by linkedin-account-creator.mjs)
  if (!env.LINKEDIN_LI_AT) return [];
  console.log("[ScoutBot] LinkedIn Apify: cookie found - scanning...");
  const candidates = [];

  // Запросы, которые ловят посты типа "мы это делаем руками каждый день"
  const queries = [
    "manually every day takes too much time",
    "looking for automation solution workflow",
    "zapier too expensive alternative",
    "still using spreadsheets manually",
    "AI automation business process"
  ];

  for (const query of queries.slice(0, 2)) { // 2 запроса за раз = экономим кредиты
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/curious_coder~linkedin-post-search-scraper/run-sync-get-dataset-items?token=${APIFY_KEY}&timeout=60&memory=512`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchQueries: [query], maxResults: 8, cookie: env.LINKEDIN_LI_AT })
        }
      );
      if (!res.ok) { console.warn(`[ScoutBot] LinkedIn Apify ${res.status}`); continue; }
      const posts = await res.json();

      for (const p of (Array.isArray(posts) ? posts : [])) {
        const text = `${p.text || p.content || ""}`.toLowerCase();
        if (!text || text.length < 50) continue;
        if (INSTANT_REJECT.some(w => text.includes(w))) continue;

        const url = p.postUrl || p.url || `https://linkedin.com/feed/update/${p.id || ""}`;
        candidates.push({
          id: `li-${p.id || randomUUID().slice(0, 12)}`,
          platform: "linkedin",
          title: (p.text || "").slice(0, 120),
          body: (p.text || "").slice(0, 600),
          url,
          author: p.authorName || p.author?.fullName || "LinkedIn User",
          authorTitle: p.authorHeadline || p.author?.headline || "",
          redditScore: (p.likesCount || 0) + (p.commentsCount || 0) * 5,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => text.includes(i)),
          createdAt: p.postedAt || p.publishedAt || new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] LinkedIn scan: ${err.message}`);
    }
  }

  return candidates;
}

// -- Scanner: LinkedIn Pain Posts (targeted reply drafts) -------------
// Scans for founders describing operational pain, drafts a 200-char reply observation.
// Uses Google CSE (always) + Apify (if LINKEDIN_LI_AT set).
async function scanLinkedInPainPosts() {
  const candidates = [];
  const apiKey = env.GOOGLE_CSE_API_KEY;
  const cseId = env.GOOGLE_CSE_ID;

  if (apiKey && cseId) {
    for (const phrase of LINKEDIN_PAIN_PHRASES) {
      try {
        const q = `site:linkedin.com/posts "${phrase}"`;
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(q)}&num=3&lr=lang_en&dateRestrict=w2`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const data = await res.json();

        for (const item of (data.items || [])) {
          const title = (item.title || "").replace(/ \| LinkedIn$/, "").trim();
          const snippet = (item.snippet || "").trim();
          const link = item.link || "";
          if (!link.includes("linkedin.com")) continue;
          if (!`${title} ${snippet}`.toLowerCase().includes(phrase)) continue;

          const authorMatch = link.match(/linkedin\.com\/(?:in|posts)\/([^/?]+)/);
          const author = authorMatch
            ? authorMatch[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
            : "LinkedIn User";

          candidates.push({
            id: `lpp-${Buffer.from(link).toString("base64").slice(-20)}`,
            matchedPhrase: phrase,
            title,
            body: snippet,
            url: link,
            author,
            reply: draftLinkedInPainReply(phrase)
          });
        }
        await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        console.warn(`[ScoutBot] LinkedIn pain CSE "${phrase}": ${err.message}`);
      }
    }
  }

  if (env.LINKEDIN_LI_AT && APIFY_KEY) {
    for (const phrase of LINKEDIN_PAIN_PHRASES.slice(0, 2)) {
      try {
        const res = await fetch(
          `https://api.apify.com/v2/acts/curious_coder~linkedin-post-search-scraper/run-sync-get-dataset-items?token=${APIFY_KEY}&timeout=60&memory=512`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQueries: [`"${phrase}" founder`], maxResults: 5, cookie: env.LINKEDIN_LI_AT })
          }
        );
        if (!res.ok) continue;
        const posts = await res.json();

        for (const p of (Array.isArray(posts) ? posts : [])) {
          const text = `${p.text || p.content || ""}`;
          if (text.length < 50 || !text.toLowerCase().includes(phrase)) continue;
          const followerCount = p.authorFollowerCount || p.author?.followersCount;
          if (followerCount && followerCount > 500) continue;

          const postUrl = p.postUrl || p.url || `https://linkedin.com/feed/update/${p.id || ""}`;
          candidates.push({
            id: `lpp-ap-${p.id || randomUUID().slice(0, 12)}`,
            matchedPhrase: phrase,
            title: text.slice(0, 120),
            body: text.slice(0, 600),
            url: postUrl,
            author: p.authorName || p.author?.fullName || "LinkedIn User",
            reply: draftLinkedInPainReply(phrase)
          });
        }
      } catch (err) {
        console.warn(`[ScoutBot] LinkedIn pain Apify "${phrase}": ${err.message}`);
      }
    }
  }

  const seen = new Set();
  const deduped = candidates.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
  console.log(`[ScoutBot] LinkedIn pain posts found: ${deduped.length}`);
  return deduped;
}

// -- Scanner: LinkedIn Posts for Comment Drafts -----------------------
// Finds posts with specific pain phrases, generates AI comment drafts for Kirill.
// 'Comment first not DM' rule - comment on post, not connection request.
async function scanLinkedInPostsForComments() {
  const candidates = [];
  const apiKey = env.GOOGLE_CSE_API_KEY;
  const cseId = env.GOOGLE_CSE_ID;

  if (apiKey && cseId) {
    for (const phrase of LINKEDIN_POST_COMMENT_PHRASES) {
      try {
        const q = `site:linkedin.com/posts "${phrase}"`;
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(q)}&num=3&lr=lang_en&dateRestrict=w2`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const data = await res.json();

        for (const item of (data.items || [])) {
          const title = (item.title || "").replace(/ \| LinkedIn$/, "").trim();
          const snippet = (item.snippet || "").trim();
          const link = item.link || "";
          if (!link.includes("linkedin.com")) continue;
          const authorMatch = link.match(/linkedin\.com\/(?:in|posts)\/([^/?]+)/);
          const author = authorMatch
            ? authorMatch[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
            : "LinkedIn User";

          candidates.push({
            id: `lpc-${Buffer.from(link).toString("base64").slice(-20)}`,
            matchedPhrase: phrase,
            title,
            body: snippet,
            url: link,
            author
          });
        }
        await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        console.warn(`[ScoutBot] LinkedIn post-comment CSE "${phrase}": ${err.message}`);
      }
    }
  }

  if (env.LINKEDIN_LI_AT && APIFY_KEY) {
    for (const phrase of LINKEDIN_POST_COMMENT_PHRASES.slice(0, 2)) {
      try {
        const res = await fetch(
          `https://api.apify.com/v2/acts/curious_coder~linkedin-post-search-scraper/run-sync-get-dataset-items?token=${APIFY_KEY}&timeout=60&memory=512`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQueries: [`"${phrase}"`], maxResults: 5, cookie: env.LINKEDIN_LI_AT })
          }
        );
        if (!res.ok) continue;
        const posts = await res.json();

        for (const p of (Array.isArray(posts) ? posts : [])) {
          const text = `${p.text || p.content || ""}`;
          if (text.length < 50 || !text.toLowerCase().includes(phrase)) continue;
          const postUrl = p.postUrl || p.url || `https://linkedin.com/feed/update/${p.id || ""}`;
          candidates.push({
            id: `lpc-ap-${p.id || randomUUID().slice(0, 12)}`,
            matchedPhrase: phrase,
            title: text.slice(0, 120),
            body: text.slice(0, 600),
            url: postUrl,
            author: p.authorName || p.author?.fullName || "LinkedIn User"
          });
        }
      } catch (err) {
        console.warn(`[ScoutBot] LinkedIn post-comment Apify "${phrase}": ${err.message}`);
      }
    }
  }

  const seen = new Set();
  const deduped = candidates.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
  console.log(`[ScoutBot] LinkedIn post-comment candidates: ${deduped.length}`);
  return deduped;
}

// -- Scanner: Threads via Apify ----------------------------------------
// Actor: FP43CZrdHtiSNn4SY (Threads Search Scraper) - verified working 2026-03-26
async function scanThreads() {
  const candidates = [];
  const queries = [
    "automation workflow business",
    "zapier n8n too expensive",
    "manual process taking too long",
    "looking for automation consultant",
    "AI tools for business"
  ];

  for (const query of queries.slice(0, 3)) {
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/FP43CZrdHtiSNn4SY/run-sync-get-dataset-items?token=${APIFY_KEY}&timeout=45&memory=256`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchQuery: query, maxItems: 15 })
        }
      );
      if (!res.ok) { console.warn(`[ScoutBot] Threads ${res.status} for "${query}"`); continue; }
      const posts = await res.json();

      for (const p of (Array.isArray(posts) ? posts : [])) {
        const text = `${p.captionText || ""}`.toLowerCase();
        if (!text || text.length < 40) continue;
        if (INSTANT_REJECT.some(w => text.includes(w))) continue;
        const hasSignal = MUST_HAVE_SIGNALS.some(s => text.includes(s));
        if (!hasSignal) continue;

        const postId = p.postId || p.postCode || randomUUID().slice(0, 12);
        candidates.push({
          id: `th-${Buffer.from(postId).toString("base64").slice(-20)}`,
          platform: "threads",
          title: (p.captionText || "").slice(0, 120),
          body: (p.captionText || "").slice(0, 600),
          url: p.postUrl || `https://threads.net/@${p.username}`,
          author: p.username || "Threads User",
          redditScore: (p.likeCount || 0) + (p.directReplyCount || 0) * 3,
          industryBonus: HIGH_VALUE_INDUSTRIES.some(i => text.includes(i)),
          createdAt: p.takenAtISO || new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`[ScoutBot] Threads scan: ${err.message}`);
    }
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// -- AI Scorer - жёсткая квалификация --------------------------------
// Load Kirill's lead rejection reasons from intelligence DB
function loadLeadRejectionReasons(db) {
  try {
    const { getIntelligence } = require; // ESM - imported at top
    const reasons = getIntelligenceKey(db, "lead_feedback", "rejections", "reasons");
    if (!Array.isArray(reasons) || reasons.length === 0) return "";
    const recent = reasons.slice(-15);
    return `\n\nKirill has REJECTED these types of leads - treat as AUTOMATIC DISQUALIFY:\n` +
      recent.map(r => `❌ "${r.reason}" (was: ${r.platform || "?"}, score was ${r.score || "?"})`).join("\n");
  } catch {
    return "";
  }
}

async function scoreLead(post, db) {
  const rejectionContext = db ? (() => {
    const parts = [];
    try {
      const reasons = getIntelligenceKey(db, "lead_feedback", "rejections", "reasons");
      if (Array.isArray(reasons) && reasons.length > 0) {
        parts.push(`Kirill REJECTED similar leads before - AUTOMATIC DISQUALIFY:\n` +
          reasons.slice(-15).map(r => `❌ "${r.reason}"`).join("\n"));
      }
    } catch {}
    // LearnBot generated rules - evolve with every rejection/approval
    try {
      const learned = getIntelligenceKey(db, "learn-bot", "learned_rules", "lead_scoring");
      if (learned) {
        if (learned.hard_reject_patterns?.length) {
          parts.push(`LEARNED hard-reject patterns: ${learned.hard_reject_patterns.join(", ")}`);
        }
        if (learned.score_threshold_by_platform) {
          const thresholds = Object.entries(learned.score_threshold_by_platform)
            .map(([p, t]) => `${p}≥${t}`).join(", ");
          parts.push(`Platform score thresholds: ${thresholds}`);
        }
        if (learned.icp_refinement) {
          parts.push(`Updated ICP: ${learned.icp_refinement}`);
        }
      }
    } catch {}
    // Outcome-based learning - platform reply rates from real data
    try {
      const replyRates = getIntelligenceKey(db, "orchestrator", "outcomes", "platform_reply_rates");
      if (replyRates) {
        const rateStr = Object.entries(replyRates).map(([p, d]) => `${p}: ${d.replyRate}% (${d.replies}/${d.total})`).join(", ");
        parts.push(`REAL REPLY RATES by platform: ${rateStr}. Prioritize platforms with higher reply rates.`);
      }
      const calibration = getIntelligenceKey(db, "orchestrator", "outcomes", "score_calibration");
      if (calibration?.insight) {
        parts.push(`SCORE CALIBRATION: ${calibration.insight}`);
      }
    } catch {}
    // EvolutionBot evolved strategy
    try {
      const evolved = getIntelligenceKey(db, "scout", "strategy", "current");
      if (evolved?.description) {
        parts.push(`EVOLVED STRATEGY (from EvolutionBot): ${evolved.description.slice(0, 200)}`);
        if (evolved.scoring_adjustments) parts.push(`Scoring adjustments: ${JSON.stringify(evolved.scoring_adjustments).slice(0, 200)}`);
      }
    } catch {}
    return parts.length > 0 ? `\n\n${parts.join("\n")}` : "";
  })() : "";

  return callAI(
    `You are a lead qualification AI for Kirill D., an AI automation consultant based in Calgary, Canada.${rejectionContext}
He builds AI workflows and automation systems for SMBs, service businesses, and franchise/chain operators. Primary markets: Canada (SR&ED credits raise client WTP), Australia (FY26 ends June 30 - budget-flush window), Hong Kong (BUD Fund up to HKD 1M). Any English-speaking market is valid.

FORMATTING RULE: Never use em dashes in any output field. Use hyphens (-) only. This applies to every field in the JSON response.

CURRENT SERVICES (use exact names in service_match):
- Vibe Code Audit: 1-day review of existing AI/automation setup, finds gaps and quick wins. Best for: founders who already started but feel stuck or aren't seeing results.
- First 10 Customers: done-for-you outbound pipeline (lead scouting, scoring, outreach drafts) to land the first 10 paying clients. Best for: solo founders pre-revenue or under 10 clients.
- AI Workflow Sprint: 1-2 week focused build - one broken workflow replaced with AI-powered automation (intake, follow-up, reporting, scheduling). Best for: ops pain with a named bottleneck.
- Full Pipeline Build: full end-to-end system (lead gen + outreach + CRM + follow-up automation). Best for: established business ready to scale, $5K+ budget.

SCORING METHOD: Count how many of the 5 PAIN SIGNALS below apply to the post. A signal counts if the meaning is present - exact wording is not required. Read for intent and operational context, not just keywords. Qualify any post where a human describes a specific operational pain they are actively trying to solve.

POSITIVE EXAMPLES - these posts QUALIFY (use as calibration):
- "we're looking to hire someone to build our CRM integration" = SIGNAL 4, score 40+
- "our automation broke last week and we lost 3 days of data" = SIGNAL 4, score 40+
- "I need someone to build a zapier workflow for our team" = SIGNAL 4, score 45+
- "ready to pay for a good solution, can't find a developer who knows n8n" = SIGNAL 4 + SIGNAL 1, score 55+
- "our manual data entry is killing us, spending 4 hours a day on it" = SIGNAL 1 + SIGNAL 3, score 55+
- "workflow is killing us, need this automated ASAP" = SIGNAL 1 + SIGNAL 3, score 60+
- "we can't keep up with orders, our current process doesn't scale" = SIGNAL 1 + SIGNAL 2, score 60+
- "looking for someone who can automate our client onboarding" = SIGNAL 4, score 45+

PAIN SIGNALS:

SIGNAL 1 - TIME PRESSURE:
Post describes a deadline, urgency, or time-consuming manual process. Examples: hours spent manually, working nights/weekends, can't keep up with volume, behind schedule, customers waiting too long, ASAP, "need this done by", process takes too long, doing it manually every day, overwhelmed by volume.

SIGNAL 2 - MONEY LOSS:
Post describes revenue impact, cost overrun, or financial pressure. Examples: losing clients, missed revenue, refunding customers, too expensive to hire staff, can't afford current solution, revenue is down, losing deals, costing us money, budget is limited, financial pressure from ops.

SIGNAL 3 - STAFF BURDEN:
Post describes team capacity problems, employee overwhelm, or solo operator strain. Examples: team is overwhelmed, staff quitting, can't hire fast enough, doing everything myself, no bandwidth, burned out, doing admin manually, one person doing the job of three, scaling problem.

SIGNAL 4 - TOOL FAILURE:
Post describes a broken, inadequate, or missing tool. Examples: current software doesn't do X, tool broke, switched away from vendor, looking for alternative, integration not working, the tool we use, replace X with, tired of X, our current setup is failing, manual workaround because tool can't.

SIGNAL 5 - CLIENT COMPLAINT:
Post describes a customer-facing problem or service quality issue. Examples: customers complaining, getting bad reviews, losing clients, clients are leaving, clients expect faster response, churn is up, support is overwhelmed, can't respond fast enough, client satisfaction dropping.

SCORING RUBRIC - add component points for a total 0-100 score:

PAIN LANGUAGE (60% weight, 0-60 pts):
- Describes a specific broken process, tool failure, hours wasted, or revenue lost with details: 45-60 pts
- Mentions operational difficulty or struggle with some context: 25-44 pts
- Vague frustration or implied strain, minimal details: 10-24 pts
- No operational pain described: 0-9 pts

BUYER CONTEXT (40% weight, 0-40 pts):
- Actively hiring, says "ready to pay", has budget, or explicit ASAP deadline: 30-40 pts
- Asking for tool/vendor recommendation or implementation help with clear intent: 18-29 pts
- Exploring options or in early research phase: 8-17 pts
- No buyer signal: 0-7 pts

OVERRIDE: Full-time employment listing (salary, benefits, equity, W2): total 0-10 regardless of above.

Score 35+ = qualified lead. Score 20-34 = weak signal. Score 0-19 = not a lead.

AUTOMATIC DISQUALIFY (score 0-25 regardless of wording):
- Post is a general AI news article, AI product announcement, or industry opinion piece with no personal operational context
- Post is asking a curiosity question with no business operation described ("what do you think about AI?", "is AI overhyped?")
- Post is sharing a tutorial, guide, or resource with no pain mentioned ("here's how to use ChatGPT")
- Post is a student, hobbyist, or learning context with no real business operation
- Post is a vendor promoting their own tool or service

IMPORTANT: The pipeline has been returning 0 qualified leads - err toward qualifying when operational pain is present. A signal counts if the meaning is there - the person does not need to use the exact listed words. If someone describes a specific problem they are actively trying to solve in their business, that is a qualified lead.

Geography: if no location is mentioned, assume remote-accessible and do not penalize.

Return JSON:
{
  "score": 0-100,
  "client_type": "business_owner|cto|operations|developer|hobbyist|unknown",
  "is_qualified": true/false,
  "signals_matched": ["signal1", "signal2"],
  "signal_count": 0,
  "criteria_met": {"pain": true/false, "decision_maker": true/false, "accessible": true/false},
  "reason": "one sentence: list which signals matched and cite the exact phrase from the post that triggered each one. No em dashes - use hyphens.",
  "estimated_deal_size": "$X,XXX",
  "urgency": "immediate|high|medium|low",
  "service_match": "Vibe Code Audit|First 10 Customers|AI Workflow Sprint|Full Pipeline Build",
  "suggested_comment": "a genuinely helpful 2-sentence comment Kirill can post. Give real value, mention a specific result. No em dashes - use hyphens. Never salesy.",
  "outreach_angle": "what specific pain to address in direct message. No em dashes - use hyphens. One concrete angle only."
}
No em dashes anywhere in the response - use hyphens instead.
be brief.`,
    `Platform: ${post.platform}${post.subreddit ? ` r/${post.subreddit}` : ""}
${["twitter", "linkedin_google", "quora"].includes(post.platform) ? "🔥 INTENT SIGNAL - this person is ACTIVELY ASKING FOR HELP right now. They raised their hand.\n" : ""}${["upwork", "remoteok", "workingnomads", "remotive", "jobicy", "freelancer"].includes(post.platform) ? "⚠️ JOB POSTING - company is ACTIVELY hiring for this service with budget RIGHT NOW\n" : ""}Title: ${post.title}
Content: ${post.body}
Author: ${post.author}${post.authorTitle ? ` - ${post.authorTitle}` : ""}
Industry bonus detected: ${post.industryBonus}`,
    MODEL_MINI,
    false
  );
}

// -- Save to DB -------------------------------------------------------
function saveLead(db, post, scoring) {
  const existing = db.prepare(`SELECT id FROM leads WHERE source_url = ?`).get(post.url);
  if (existing) return null; // Already in DB

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO leads (id, name, source, source_platform, source_url,
      pain_description, service_match, score, stage, first_signal_at, created_at, updated_at)
    VALUES (?, ?, 'scout_bot', ?, ?, ?, ?, ?, 'new', ?, ?, ?)
  `).run(
    id,
    post.author,
    post.platform,
    post.url,
    `${post.title} - ${post.body.slice(0, 200)}`,
    scoring.service_match || "",
    scoring.score || 0,
    post.createdAt || now,
    now, now
  );
  return id;
}

function saveLinkedInPainDraft(db, post) {
  const existing = db.prepare(`SELECT id FROM leads WHERE source_url = ?`).get(post.url);
  if (existing) return null;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO leads (id, name, source, source_platform, source_url,
      pain_description, service_match, score, stage, first_signal_at, created_at, updated_at)
    VALUES (?, ?, 'scout_bot', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, post.author, "linkedin_pain", post.url,
    `REPLY: ${post.reply} | POST: ${post.title.slice(0, 100)}`,
    "conversation_starter", 0, "reply_draft", now, now, now
  );
  return id;
}

async function sendLinkedInPainDraftsToTelegram(db) {
  const lastSent = getIntelligenceKey(db, "scout", "linkedin_pain", "last_notified_at");
  if (lastSent && (Date.now() - new Date(lastSent).getTime()) < 23 * 60 * 60 * 1000) return;

  const drafts = db.prepare(
    `SELECT * FROM leads WHERE source_platform = 'linkedin_pain' AND stage = 'reply_draft' ORDER BY created_at DESC LIMIT 3`
  ).all();
  if (!drafts.length) return;

  const lines = drafts.map((d, i) => {
    const replyMatch = d.pain_description?.match(/^REPLY: (.+?) \| POST:/);
    const reply = replyMatch ? replyMatch[1] : d.pain_description?.slice(0, 200) || "";
    return `${i + 1}. ${d.name}\nReply: ${reply}\n${d.source_url}`;
  }).join("\n\n");

  const text = `LinkedIn Pain Replies (${drafts.length} ready for dispatch)\n\n${lines}`;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: text.slice(0, 4096), disable_web_page_preview: true })
    });
    const ids = drafts.map(d => d.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE leads SET stage = 'reply_draft_notified', updated_at = ? WHERE id IN (${placeholders})`)
      .run(new Date().toISOString(), ...ids);
    setIntelligence(db, "scout", "linkedin_pain", "last_notified_at", new Date().toISOString(), 100);
    console.log(`[ScoutBot] Sent ${drafts.length} LinkedIn pain reply drafts to Telegram`);
  } catch (err) {
    console.warn(`[ScoutBot] LinkedIn pain Telegram send failed: ${err.message}`);
  }
}

async function sendLinkedInCommentDraftsToTelegram(db, posts) {
  const lastSent = getIntelligenceKey(db, "scout", "linkedin_post_comments", "last_notified_at");
  if (lastSent && (Date.now() - new Date(lastSent).getTime()) < 23 * 60 * 60 * 1000) return;
  if (!posts.length) return;

  let sentCount = 0;
  for (const post of posts.slice(0, 5)) {
    try {
      const draft = await generateLinkedInCommentDraft(post);
      if (!draft || draft.length < 10) continue;

      const text = [
        `LinkedIn comment draft - "${post.matchedPhrase}"`,
        `${post.author}: ${post.title.slice(0, 100)}`,
        ``,
        `Comment draft:`,
        draft.slice(0, 200),
        ``,
        post.url,
        `Post this comment`
      ].join("\n");

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: text.slice(0, 4096), disable_web_page_preview: true })
      });
      sentCount++;
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.warn(`[ScoutBot] LinkedIn comment draft send failed: ${err.message}`);
    }
  }

  if (sentCount > 0) {
    setIntelligence(db, "scout", "linkedin_post_comments", "last_notified_at", new Date().toISOString(), 100);
    console.log(`[ScoutBot] Sent ${sentCount} LinkedIn post comment drafts to Telegram`);
  }
}

// NOTE: notifyLead and processCallbacks removed - Orchestrator handles all
// Telegram callbacks and lead notifications via VOICE_TOKEN (One Voice principle).
// ScoutBot only emits lead_found events to bot_events table.
async function _notifyLead_REMOVED(post, scoring, leadId) {
  const platformLabel =
    post.platform === "linkedin" ? "🔵 LinkedIn" :
    post.platform === "threads" ? "🧵 Threads" :
    post.platform === "indeed" ? "🟢 Indeed (ищет подрядчика)" :
    post.platform === "reddit_jobs" ? "🟡 Reddit r/hiring (активный покупатель)" :
    post.platform === "reddit" ? `Reddit r/${post.subreddit}` :
    post.platform === "hackernews" ? "🟠 HackerNews" : post.platform;

  const urgencyEmoji = {
    immediate: "🚨", high: "🔥", medium: "⚡", low: "💡"
  }[scoring.urgency] || "💡";

  const dealBadge = scoring.estimated_deal_size
    ? ` | 💰 ${scoring.estimated_deal_size}`
    : "";

  const text = [
    `${urgencyEmoji} <b>КВАЛИФИЦИРОВАННЫЙ ЛИД | ${scoring.score}/100${dealBadge}</b>`,
    ``,
    `<b>Платформа:</b> ${platformLabel}`,
    `<b>Кто:</b> ${post.author} - ${scoring.client_type}`,
    `<b>Пост:</b> ${post.title}`,
    ``,
    `<b>Почему подходит:</b> ${scoring.reason}`,
    `<b>Сервис:</b> ${scoring.service_match}`,
    `<b>Срочность:</b> ${scoring.urgency}`,
    ``,
    `<b>✍️ Готовый комментарий:</b>`,
    `<code>${scoring.suggested_comment}</code>`,
    ``,
    `<b>📩 Угол для DM:</b>`,
    `<i>${scoring.outreach_angle}</i>`,
    ``,
    `<b>🔗</b> ${post.url}`,
  ].join("\n");

  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Написал им", callback_data: `contacted:${leadId}` },
      { text: "❌ Не подходит", callback_data: `skip:${leadId}` }
    ], [
      { text: "📧 Сгенерировать предложение", callback_data: `proposal:${leadId}` }
    ]]
  };

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID, text, parse_mode: "HTML",
      disable_web_page_preview: true, reply_markup: keyboard
    })
  });
}

async function _processCallbacks_REMOVED(db) {
  try {
    let offset = 0;
    const st = db.prepare(`SELECT bot_name FROM bot_heartbeats WHERE bot_id = 'scout_offset'`).get();
    if (st) offset = parseInt(st.bot_name) || 0;

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=1`);
    const data = await res.json();
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      offset = update.update_id + 1;
      const cb = update.callback_query;
      if (!cb) continue;

      const [action, leadId] = (cb.data || "").split(":");
      const now = new Date().toISOString();
      const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);

      if (action === "contacted") {
        const followup = new Date(Date.now() + 3 * 86400000).toISOString();
        db.prepare(`UPDATE leads SET stage='contacted', last_contact_at=?, next_followup_at=?, updated_at=? WHERE id=?`)
          .run(now, followup, now, leadId);
        await answerCallback(cb.id, `✅ ${lead?.name} - зафиксировано. Напомню 28 марта.`);
        createTask(db, { fromBot: BOT_ID, toBot: "sales", taskType: "new_lead",
          payload: { leadId, score: lead?.score, serviceMatch: lead?.service_match }, priority: 8 });
      }

      if (action === "skip") {
        db.prepare(`UPDATE leads SET stage='lost', updated_at=? WHERE id=?`).run(now, leadId);
        await answerCallback(cb.id, "Лид убран.");
      }

      if (action === "proposal") {
        // Ask SalesBot to generate proposal immediately
        createTask(db, { fromBot: BOT_ID, toBot: "sales", taskType: "generate_proposal",
          payload: { leadId }, priority: 10 });
        await answerCallback(cb.id, "⏳ Генерирую предложение через SalesBot...");
      }
    }

    db.prepare(`INSERT OR REPLACE INTO bot_heartbeats (id, bot_id, bot_name, status, last_action, metrics_json, pinged_at) VALUES (?,?,?,?,?,?,?)`)
      .run("scout_offset", "scout_offset", String(offset), "active", "offset", "{}", new Date().toISOString());
  } catch (err) {
    console.warn(`[ScoutBot] callbacks error: ${err.message}`);
  }
}

async function _answerCallback_REMOVED(id, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text, show_alert: false })
  });
}

// -- Reddit Visibility Scanner -----------------------------------------
// Finds Reddit threads where Kirill's expert comment would get visibility.
// NOT job posts (those go through normal pipeline) - discussion threads
// where the author/community would see an expert and potentially DM.
async function scanRedditVisibilityOpportunities(db) {
  const VISIBILITY_SUBREDDITS = [
    { sub: "r/n8n", q: "help workflow" },
    { sub: "r/n8n", q: "question" },
    { sub: "r/automation", q: "automate business" },
    { sub: "r/nocode", q: "workflow automation" },
    { sub: "r/smallbusiness", q: "automate repetitive" },
    { sub: "r/Entrepreneur", q: "automate manual" },
    // Franchise/chain-business ICP - visibility in franchise operator communities
    { sub: "r/Franchises", q: "operations software automate" },
    { sub: "r/FranchisedBusiness", q: "workflow automation management" },
    // Philippines - visibility in local community before Kirill relocates
    { sub: "r/buhaydigital", q: "automate workflow" },
    { sub: "r/phdigitalnomads", q: "automation tools" },
    { sub: "r/Philippines", q: "business automation" },
  ];

  const opportunities = [];

  for (const { sub, q } of VISIBILITY_SUBREDDITS) {
    try {
      const subreddit = sub.replace("r/", "");
      const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(q)}&sort=new&t=week&limit=5&restrict_sr=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; visibility-bot/1.0)" },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) continue;
      const data = await res.json();

      for (const post of (data?.data?.children || [])) {
        const d = post.data;
        if (!d?.title || !d?.permalink) continue;
        // Skip job posts - they go through main pipeline
        const titleLower = d.title.toLowerCase();
        if (titleLower.includes("[hiring]") || titleLower.includes("[for hire]") ||
            titleLower.includes("looking for") || titleLower.includes("need help building") ||
            titleLower.includes("hire")) continue;
        // Skip posts with no comments (nobody's watching)
        if ((d.num_comments || 0) < 2) continue;
        // Skip very new posts (< 1 hour) or very old (> 5 days)
        const ageDays = (Date.now() / 1000 - d.created_utc) / 86400;
        if (ageDays < 0.04 || ageDays > 5) continue;

        opportunities.push({
          subreddit,
          title: d.title,
          url: `https://reddit.com${d.permalink}`,
          upvotes: d.score || 0,
          comments: d.num_comments || 0,
          ageDays: Math.round(ageDays * 10) / 10
        });
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  // Sort by engagement (upvotes + comments)
  opportunities.sort((a, b) => (b.upvotes + b.comments * 3) - (a.upvotes + a.comments * 3));
  const top = opportunities.slice(0, 5);

  if (top.length > 0) {
    setIntelligence(db, "scout", "visibility_opportunities", "reddit_threads", top, 80);
    console.log(`[ScoutBot] Reddit visibility opportunities: ${top.length} threads`);
  }

  return top;
}

// -- Main run ---------------------------------------------------------
async function runScout(options = {}) {
  const db = getDb();

  // Callbacks handled by Orchestrator (runs every 1 min, One Voice principle)
  const subreddits = options.subreddits || BUSINESS_SUBREDDITS;
  const limit = options.limit || 15;

  // Читаем директиву от Orchestrator - "найди похожих клиентов" после /project_done
  const similarDirective = getIntelligenceKey(db, "orchestrator", "scout_directive", "find_similar");
  if (similarDirective?.serviceType) {
    console.log(`[ScoutBot] Scout directive: find more like ${similarDirective.serviceType}`);
    await logActivity(db, "scout", `Директива: ищу клиентов похожих на "${similarDirective.serviceType}" - ${(similarDirective.painPattern || "").slice(0, 60)}`);
  }

  console.log(`[ScoutBot v5] Scanning Twitter + Quora + LinkedIn/Google + HN-Hiring + Reddit(+MSP/ecommerce) + HN`);
  heartbeat(db, BOT_ID, "ScoutBot", "scanning - Twitter + HN-Hiring + Reddit(MSP) + HN");
  await logActivity(db, "scout", `Сканирование v5: Twitter/X + HN-Hiring + Quora + LinkedIn/Google + Reddit(+MSP/ecommerce) + HN`);

  // Scan all sources in parallel - intent-first architecture
  const [
    twitterPosts, quoraPosts, linkedinGooglePosts, linkedinApifyPosts,
    upworkPosts, remoteOKPosts, workingNomadsPosts,
    remoteJobPosts, redditPosts, redditSearchPosts,
    hnPosts, hnHiringPosts, jobPosts, threadsPosts, craigslistPosts,
    bravePosts
  ] = await Promise.all([
    scanTwitter(),
    scanQuora(),
    scanLinkedInViaGoogle(),
    scanLinkedIn(),
    scanUpwork(),
    Promise.resolve([]),  // RemoteOK disabled - returns job listings, not clients
    Promise.resolve([]),  // WorkingNomads disabled - returns job listings, not clients
    Promise.resolve([]),  // RemoteJobs disabled - returns job listings, not clients
    scanReddit(subreddits, limit),
    scanRedditKeywordSearch(),
    scanHN(),
    scanHNHiring(),
    Promise.resolve([]),  // scanJobPosts() disabled - r/forhire + r/hiring find JOB SEEKERS not business owners, 0 qualified leads
    scanThreads(),
    scanCraigslist(),
    scanBrave()  // ← Brave Search - работает всегда, оплачен Кириллом
  ]);

  // Priority: INTENT signals first (Twitter/Quora/LinkedIn = people ASKING for help)
  // then job platforms (have budget), then community discussions
  // Brave goes right after Reddit search - high intent, global reach
  const allPosts = [
    ...craigslistPosts,
    ...twitterPosts, ...linkedinApifyPosts, ...linkedinGooglePosts, ...quoraPosts,
    ...bravePosts,   // ← Brave: надёжный источник, работает даже когда всё остальное 403
    ...upworkPosts,
    ...hnHiringPosts, ...redditSearchPosts,
    // remoteOKPosts, workingNomadsPosts, remoteJobPosts, jobPosts - disabled: job boards find JOB SEEKERS not clients
    ...threadsPosts, ...redditPosts, ...hnPosts
  ];
  console.log(`[ScoutBot v7] Pre-filter: ${allPosts.length} total | Brave: ${bravePosts.length} | Reddit: ${redditPosts.length} | RedditSearch: ${redditSearchPosts.length} | HN-Hiring: ${hnHiringPosts.length} | Twitter: ${twitterPosts.length} | LinkedIn-Apify: ${linkedinApifyPosts.length}`);

  if (allPosts.length === 0) {
    heartbeat(db, BOT_ID, "ScoutBot", "scan complete - no candidates", {}, {
      status: "degraded", last_success_at: null, error: "no candidates found from any source"
    });
    db.close();
    return;
  }

  // Score with AI - sort by engagement first so Reddit/Threads/HN beat low-engagement Remotive
  const toScore = allPosts
    .filter(p => !db.prepare(`SELECT id FROM leads WHERE source_url = ?`).get(p.url))
    .sort((a, b) => (b.redditScore || 0) - (a.redditScore || 0))
    .slice(0, 20);

  // DIAG 2026-05-12 (corrected): Mode B confirmed - LLM appends trailing prose after JSON,
  // causing JSON.parse to fail at char ~671-1088. 3 of 5 posts failed parse in run 2.
  // Fix applied: extract {first...last} boundary before parsing instead of strip-fences-only.
  // Threshold lowered to 4 to catch any non-zero signal. MVL fallback handles LLM timeouts.
  console.log(`[ScoutBot v3] Scoring ${toScore.length} new candidates with GPT-4o-mini...`);
  console.error(`[SCOUT-DIAG-ENTRY] total_to_score=${toScore.length} threshold=4 platforms=${[...new Set(toScore.map(p=>p.platform))].join(",")}`);

  const qualified = [];
  const allScores = [];
  let aiErrors = 0, aiSuccesses = 0, aiNoScore = 0, diagCount = 0;
  for (const post of toScore) {
    try {
      const scoringRaw = await scoreLead(post, db);
      console.error(`[SCOUT-RAW-LLM] post=${post.platform}|${(post.author||"").slice(0,20)} len=${(scoringRaw||"").length} raw=${(scoringRaw||"").slice(0,500)}`);
      if (!scoringRaw || typeof scoringRaw !== "string") {
        console.warn(`[ScoutBot NULL-RESPONSE] scoreLead returned ${scoringRaw === null ? "null" : scoringRaw === undefined ? "undefined" : typeof scoringRaw} for "${(post.title||"").slice(0,60)}"`);
      }
      let scoring = null;
      if (typeof scoringRaw === "string" && scoringRaw.length > 0) {
        try {
          const start = scoringRaw.indexOf('{');
          const end = scoringRaw.lastIndexOf('}');
          const jsonStr = start >= 0 && end >= start ? scoringRaw.slice(start, end + 1) : scoringRaw.replace(/^```json\s*/m, "").replace(/^```\s*/m, "").replace(/\s*```$/m, "").trim();
          scoring = JSON.parse(jsonStr);
          console.error(`[SCOUT-PARSED] score=${scoring?.score} signals=${scoring?.signal_count} is_qualified=${scoring?.is_qualified} threshold=4 passes=${(scoring?.score||0) >= 4}`);
        } catch (e) {
          console.error(`[SCOUT-JSON-FAIL] raw="${scoringRaw.slice(0,300)}" err="${e.message}"`);
          scoring = null;
        }
      }
      if (diagCount < 5) {
        console.log(`[ScoutBot DIAG5 ${diagCount+1}/5] "${(post.title||"").slice(0,70)}" score=${scoring?.score ?? (typeof scoringRaw !== "string" ? "null-response" : "parse-fail")}`);
        diagCount++;
      }
      if (scoring?.score !== undefined) {
        allScores.push(scoring.score);
        aiSuccesses++;
        console.error(`[SCOUT-SCORES-ARR] all_scores_so_far=[${allScores.join(",")}] threshold=4`);
        console.log(`[ScoutBot SCORE] title="${(post.title||"").slice(0,60)}" platform=${post.platform} author=${(post.author||"").slice(0,30)} raw_score=${scoring.score} signals=${scoring.signal_count||0} threshold=4 pass=${scoring.score >= 4} reason="${(scoring.reason||"").slice(0,100)}"`);
        try {
          const debugEntry = JSON.stringify({ url: post.url || "", raw_score: scoring.score, threshold_used: 4, qualified: scoring.score >= 4, timestamp: new Date().toISOString() });
          appendFileSync(new URL("../../.data/scout-debug-scores.json", import.meta.url), debugEntry + "\n");
        } catch (_) {}
        // scores are 0-100 scale (rubric: 35+ = qualified, 20-34 = weak, 0-19 = noise); threshold 4 admits any signal, sort+slice(5) surfaces highest scorers first
        if (scoring.score >= 4) {
          qualified.push({ post, scoring });
        } else {
          console.log(`  ✗ FAIL title="${(post.title||"").slice(0,50)}" author=${post.author} (${post.platform}): ${scoring.score}/100 below threshold 4 - ${scoring.client_type} - ${scoring.reason}`);
        }
      } else {
        aiNoScore++;
        console.warn(`[ScoutBot SCORE-MISSING] scoring=${scoring === null ? "null" : "object-no-score"} raw_type=${typeof scoringRaw} raw_len=${(scoringRaw||"").length} title="${(post.title||"").slice(0,60)}"`);
      }
    } catch (err) {
      aiErrors++;
      console.warn(`[ScoutBot AI-ERROR] post=${post.platform}|${(post.url||"").slice(0,60)} error="${err.message.slice(0,150)}"`);
    }
  }
  const scoresAbove4 = allScores.filter(s => s >= 4).length;
  const scoresAbove30 = allScores.filter(s => s >= 30).length;
  console.log(`[ScoutBot DIAG] toScore=${toScore.length} ai_success=${aiSuccesses} ai_errors=${aiErrors} ai_no_score=${aiNoScore} scores_above_4=${scoresAbove4} scores_above_30=${scoresAbove30} qualified=${qualified.length} all_raw_scores=[${allScores.join(",")||"none"}]`);

  // Minimum-viable-lead fallback: string-match posts the AI failed to score or scored 0
  // Catches the ~25% timeout failures and zero-scored posts with clear business signals
  const qualifiedUrls = new Set(qualified.map(q => q.post.url));
  for (const post of toScore) {
    if (qualifiedUrls.has(post.url)) continue;
    const fullText = `${post.title} ${post.body}`.toLowerCase();
    const signalHits = MUST_HAVE_SIGNALS.filter(s => fullText.includes(s));
    if (signalHits.length >= 3) {
      console.log(`[ScoutBot MVL-FALLBACK] ${post.platform}|${(post.author||"").slice(0,30)} matched ${signalHits.length} signals: ${signalHits.slice(0,3).join(", ")}`);
      qualified.push({
        post,
        scoring: {
          score: 5,
          client_type: "unknown",
          is_qualified: true,
          signals_matched: signalHits.slice(0, 3),
          signal_count: signalHits.length,
          criteria_met: { pain: true, decision_maker: false, accessible: true },
          reason: `MVL fallback - string matched ${signalHits.length} signals: ${signalHits.slice(0, 3).join(", ")}`,
          estimated_deal_size: "$1,500",
          urgency: "medium",
          service_match: "AI Workflow Sprint",
          suggested_comment: "",
          outreach_angle: `Signal matched: ${signalHits.slice(0, 2).join(", ")}`
        }
      });
    }
  }
  if (qualified.length > qualifiedUrls.size) {
    console.log(`[ScoutBot MVL-FALLBACK] Added ${qualified.length - qualifiedUrls.size} minimum-viable leads via string match`);
  }

  // Sort by score - freelance platforms first (have budget NOW)
  const INTENT_PLATFORMS = new Set(["twitter", "linkedin_google", "quora"]);
  const FREELANCE_PLATFORMS = new Set(["upwork"]);
  qualified.sort((a, b) => {
    const aIntent = INTENT_PLATFORMS.has(a.post.platform);
    const bIntent = INTENT_PLATFORMS.has(b.post.platform);
    const aFreelance = FREELANCE_PLATFORMS.has(a.post.platform);
    const bFreelance = FREELANCE_PLATFORMS.has(b.post.platform);
    if (aIntent && !bIntent) return -1;
    if (!aIntent && bIntent) return 1;
    if (aFreelance && !bFreelance) return -1;
    if (!aFreelance && bFreelance) return 1;
    return b.scoring.score - a.scoring.score;
  });
  const topLeads = qualified.slice(0, 5); // Allow up to 5 when Upwork has many

  console.log(`[ScoutBot v3] Qualified leads: ${topLeads.length} / ${toScore.length} scored`);

  if (topLeads.length === 0) {
    await logActivity(db, "scout", `Сканирование завершено - ${allPosts.length} постов проверено, квалифицированных нет`);
    heartbeat(db, BOT_ID, "ScoutBot", `scan complete - 0 qualified from ${allPosts.length}`, {}, {
      status: "degraded", last_success_at: null, error: `0 qualified from ${allPosts.length} posts`
    });
    db.close();
    return;
  }

  let savedCount = 0;
  for (const { post, scoring } of topLeads) {
    const leadId = saveLead(db, post, scoring);
    if (leadId) {
      savedCount++;
      // Emit event → Orchestrator will research + notify Kirill (One Voice principle)
      emitEvent(db, {
        fromBot: BOT_ID,
        eventType: "lead_found",
        payload: {
          leadId,
          platform: post.platform,
          score: scoring.score,
          urgency: scoring.urgency,
          serviceMatch: scoring.service_match,
          estimatedDeal: scoring.estimated_deal_size,
          author: post.author,
          url: post.url
        }
      });

      // Send to IdeaBot via event bus - новая архитектура
      sendMessage(db, {
        fromBot: BOT_ID,
        toBot: "idea-bot",
        messageType: "lead_pain_signal",
        payload: {
          leadId,
          platform: post.platform,
          pain: `${post.title} - ${post.body.slice(0, 200)}`,
          score: scoring.score,
          serviceMatch: scoring.service_match,
          location: post.location || "unknown"
        },
        priority: scoring.score >= 80 ? 10 : 7
      });
      await logActivity(db, "scout", `Лид найден: <b>${post.author}</b> [${post.platform}] - ${scoring.score}/100 | ${scoring.service_match} → Orchestrator обработает`);
      console.log(`  ✅ [${post.platform.toUpperCase()}] ${post.author}: ${scoring.score}/100 | ${scoring.service_match} | ${scoring.estimated_deal_size}`);

      // For Reddit posts with high score - generate expert comment for Kirill to approve
      if (post.platform === "reddit" && scoring.score >= 65) {
        try {
          const { generateExpertComment, sendRedditCommentToKirill, isRedditConfigured } = await import("./reddit-publisher.mjs");
          if (isRedditConfigured()) {
            const comment = await generateExpertComment(post);
            if (comment?.confidence >= 7 && comment?.lead_potential !== "low") {
              await sendRedditCommentToKirill(post, comment);
              await logActivity(db, "scout", `Reddit ответ готов для r/${post.subreddit}: "${post.title.slice(0,50)}..." - жду одобрения`);
            }
          }
        } catch (e) {
          console.warn(`[ScoutBot] Reddit comment gen error: ${e.message}`);
        }
      }
    }
  }

  // Process any orchestrator tasks assigned to us
  const tasks = claimTasks(db, BOT_ID);
  for (const task of tasks) {
    completeTask(db, task.id, { leadsFound: savedCount });
  }

  // Записываем результаты в общую память - Orchestrator и AnalyticsBot прочитают
  setIntelligence(db, "scout", "scan_results", "last_run_at", new Date().toISOString(), 100);
  setIntelligence(db, "scout", "scan_results", "scanned_total", allPosts.length, 100);
  setIntelligence(db, "scout", "scan_results", "qualified_this_run", savedCount, 100);
  setIntelligence(db, "scout", "source_performance", "upwork", {
    posts: upworkPosts.length, working: upworkPosts.length > 0
  }, upworkPosts.length > 0 ? 90 : 20);
  setIntelligence(db, "scout", "source_performance", "remote_jobs", {
    posts: remoteJobPosts.length, working: remoteJobPosts.length > 0
  }, remoteJobPosts.length > 0 ? 90 : 20);
  setIntelligence(db, "scout", "source_performance", "hn_hiring", {
    posts: hnHiringPosts.length, working: hnHiringPosts.length > 0
  }, hnHiringPosts.length > 0 ? 90 : 40);

  // Что квалифицировалось - чтобы ContentBot знал о каких болях писать
  if (savedCount > 0) {
    const topLeadPains = topLeads.slice(0, 3).map(l => ({
      platform: l.post.platform,
      pain: l.post.title,
      service: l.scoring.service_match
    }));
    setIntelligence(db, "scout", "lead_signals", "recent_pains", topLeadPains, 80);
  }

  // Scan Reddit for visibility opportunities (expert comment threads - not job posts)
  await scanRedditVisibilityOpportunities(db);

  // LinkedIn pain-post scanner - save drafts and send daily digest to Telegram
  const linkedinPainPosts = await scanLinkedInPainPosts();
  let painDraftsSaved = 0;
  for (const post of linkedinPainPosts) {
    if (saveLinkedInPainDraft(db, post)) painDraftsSaved++;
  }
  if (painDraftsSaved > 0) console.log(`[ScoutBot] LinkedIn pain drafts saved: ${painDraftsSaved}`);
  await sendLinkedInPainDraftsToTelegram(db);

  // LinkedIn post-comment scanner - find posts with targeted pain phrases, generate comment drafts
  const linkedinPostComments = await scanLinkedInPostsForComments();
  if (linkedinPostComments.length > 0) {
    await sendLinkedInCommentDraftsToTelegram(db, linkedinPostComments);
  }

  // KPI репорт для EvolutionBot
  reportKPIs(db, "scout", {
    leads_found: toScore.length,
    leads_qualified: savedCount,
    errors: 0,
    tasks_completed: savedCount,
    custom: {
      sources_scanned: allPosts.length,
      upwork_posts: upworkPosts.length,
      remote_job_posts: remoteJobPosts.length,
      hn_posts: hnHiringPosts.length,
      qualification_rate: toScore.length ? (savedCount / toScore.length * 100).toFixed(1) : 0
    }
  });

  heartbeat(db, BOT_ID, "ScoutBot", `done - ${savedCount} leads emitted`, {
    scanned: allPosts.length, scored: toScore.length, qualified: savedCount,
    upwork: upworkPosts.length, remoteJobs: remoteJobPosts.length
  }, {
    status: savedCount > 0 ? "ok" : "degraded",
    last_success_at: savedCount > 0 ? new Date().toISOString() : null,
    error: null
  });

  if (savedCount > 0) {
    try { clearError(db, BOT_ID); } catch {}
  }

  db.close();
  console.log(`[ScoutBot v3] Done. ${savedCount} leads emitted to Orchestrator. Upwork: ${upworkPosts.length}, RemoteJobs: ${remoteJobPosts.length}.`);
}

// -- LIVE MODE (24/7 процесс) --------------------------------------------------
async function processMessages() {
  const { getDb, pollMessages, markMessageActedOn } = await import("./orchestrator.mjs");
  const db = getDb();
  try {
    const messages = pollMessages(db, "scout-bot", 10);
    for (const msg of messages) {
      if (msg.message_type === "lead_pain_signal" || msg.message_type === "community_lead" || msg.message_type === "linkedin_lead") {
        console.log(`[ScoutBot] Got ${msg.message_type} from ${msg.from_bot}: ${msg.payload?.niche || msg.payload?.pain?.slice(0, 50) || "?"}`);
        // Trigger a targeted scan based on the signal
        if (msg.payload?.instructions) {
          console.log(`[ScoutBot] Running targeted scan: ${msg.payload.instructions.slice(0, 80)}`);
        }
        // Run full scout which will pick up signals from DB
        await runScout();
        markMessageActedOn(db, msg.id, { processed: true });
        break; // One scan per message check cycle
      }
    }
  } finally {
    db.close();
  }
}

async function liveMode() {
  console.log(`[ScoutBot] Starting in LIVE mode (scan every 2h, check messages every 5min)...`);

  // Preflight
  const precheck = preflight([
    { name: "OPENAI_API_KEY", value: env.OPENAI_API_KEY || process.env.OPENAI_API_KEY },
    { name: "BRAVE_SEARCH_API_KEY", value: BRAVE_KEY, required: false },
    { name: "APIFY_API_KEY", value: APIFY_KEY, required: false },
  ]);
  if (!precheck.ok) {
    console.error(`[ScoutBot] Preflight FAILED: ${precheck.message}`);
    try { const db = getDb(); reportError(db, BOT_ID, "ScoutBot", precheck.message, "config", "preflight"); db.close(); } catch {}
    return;
  }

  let lastFullScan = 0;

  while (true) {
    try {
      const now = Date.now();

      // Full scan every 2 hours
      if (now - lastFullScan > 2 * 60 * 60 * 1000) {
        console.log(`[ScoutBot] Running full scan...`);
        await runScout();
        lastFullScan = now;
      }

      // Check event bus every 5 min
      await processMessages();

      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    } catch (err) {
      console.error(`[ScoutBot] Error in live mode:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_ID, "ScoutBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    }
  }
}

import { fileURLToPath as _ftu } from "url";
if (process.argv[1] === _ftu(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[ScoutBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runScout().catch(console.error);
  }
}

export { runScout };
