import type { OrchestratorService } from "./index.js";

/**
 * MasterAutonomyBootstrap
 *
 * Bootstraps the autonomous factory on first startup:
 * 1. Discovers GitHub repos in AI automation space → creates solution watchlists
 * 2. Discovers HackerNews discussions about business pain → creates audience watchlists
 * 3. Seeds static watchlists for high-signal sources (if none exist)
 *
 * Idempotent — safe to call on every startup.
 */

export interface MasterBootstrapResult {
  alreadySeeded: boolean;
  githubWatchlistsCreated: number;
  hnWatchlistsCreated: number;
  staticWatchlistsCreated: number;
  totalWatchlists: number;
  summary: string;
}

// GitHub topics targeting companies/tools in the AI automation space
const AI_AUTOMATION_GITHUB_TOPICS = [
  "n8n",
  "workflow-automation",
  "business-automation",
  "ai-automation",
  "process-automation",
  "rpa",
  "zapier-alternative",
  "make-automation",
  "no-code-automation",
  "ai-agents"
];

// HackerNews keywords targeting business owners/managers with manual process pain
const BUSINESS_PAIN_KEYWORDS = [
  "manual process",
  "spreadsheet",
  "copy paste",
  "automate",
  "workflow",
  "repetitive",
  "integrations",
  "api integration",
  "time-consuming",
  "bottleneck",
  "approval",
  "handoff",
  "no-code",
  "make.com",
  "zapier",
  "n8n",
  "airtable",
  "outsource",
  "freelancer",
  "consultant"
];

// Static watchlists pointing to high-signal public sources for AI automation clients
const STATIC_WATCHLIST_SEEDS = [
  {
    sourceKind: "public_discussion_source" as const,
    label: "HN: Businesses asking about AI automation",
    sourceUrl: "https://news.ycombinator.com/ask",
    seedExcerpt:
      "Founders and operators posting about manual workflows, time-consuming repetitive tasks, data entry, API integrations, and asking how to automate their business processes with AI or no-code tools.",
    targetProblem: "manual business processes that can be automated with AI",
    refreshCadence: "daily_candidate" as const,
    priority: "high" as const,
    autoPromotionRules: {
      enabled: true,
      minPriorityScore: 55,
      minConfidence: "medium" as const,
      autoDraftGeneration: true
    }
  },
  {
    sourceKind: "public_discussion_source" as const,
    label: "Reddit: r/automation — workflow pain signals",
    sourceUrl: "https://www.reddit.com/r/automation/new.json",
    seedExcerpt:
      "Small business owners, operations managers, and startup founders discussing repetitive tasks, manual data entry, broken handoffs between tools, and looking for affordable automation solutions.",
    targetProblem: "operational inefficiency and manual work in small businesses",
    refreshCadence: "daily_candidate" as const,
    priority: "high" as const,
    autoPromotionRules: {
      enabled: true,
      minPriorityScore: 55,
      minConfidence: "medium" as const,
      autoDraftGeneration: true
    }
  },
  {
    sourceKind: "public_discussion_source" as const,
    label: "Reddit: r/nocode — no-code automation buyers",
    sourceUrl: "https://www.reddit.com/r/nocode/new.json",
    seedExcerpt:
      "Business owners and entrepreneurs evaluating no-code and AI automation tools like Make, n8n, Zapier, Airtable. Many are looking for consultants to set up automations they cannot do themselves.",
    targetProblem: "companies looking for AI automation consultants and implementation help",
    refreshCadence: "daily_candidate" as const,
    priority: "high" as const,
    autoPromotionRules: {
      enabled: true,
      minPriorityScore: 60,
      minConfidence: "medium" as const,
      autoDraftGeneration: true
    }
  },
  {
    sourceKind: "article_source" as const,
    label: "ProductHunt: AI automation tool launches",
    sourceUrl: "https://www.producthunt.com/topics/artificial-intelligence",
    seedExcerpt:
      "New AI automation tools launching on ProductHunt targeting business workflow automation, document processing, CRM automation, sales outreach automation, and operational efficiency.",
    targetProblem: "emerging AI automation tools that indicate growing market demand",
    refreshCadence: "weekly_candidate" as const,
    priority: "normal" as const,
    autoPromotionRules: {
      enabled: true,
      minPriorityScore: 65,
      minConfidence: "medium" as const,
      autoDraftGeneration: true
    }
  },
  {
    sourceKind: "github_repo" as const,
    label: "GitHub: n8n workflows — automation demand signals",
    sourceUrl: "https://github.com/n8n-io/n8n",
    seedExcerpt:
      "n8n is the most popular open-source workflow automation platform. Issues and discussions reveal pain points of businesses trying to automate: CRM syncs, lead generation, invoice processing, customer support routing, data pipeline automation.",
    targetProblem: "companies adopting n8n who need consulting and custom workflow development",
    refreshCadence: "weekly_candidate" as const,
    priority: "high" as const,
    autoPromotionRules: {
      enabled: true,
      minPriorityScore: 60,
      minConfidence: "medium" as const,
      autoDraftGeneration: true
    }
  }
];

// Labels that identify bootstrap-created watchlists (used for idempotency)
const BOOTSTRAP_LABELS = new Set(STATIC_WATCHLIST_SEEDS.map((s) => s.label));

export async function bootstrapMasterAutonomy(
  orchestrator: Pick<
    OrchestratorService,
    | "listAutonomousWatchlists"
    | "createAutonomousWatchlist"
    | "runGitHubSolutionDiscovery"
    | "runHackerNewsAudienceDiscovery"
  >
): Promise<MasterBootstrapResult> {
  const existing = await orchestrator.listAutonomousWatchlists();

  // Check if static bootstrap watchlists are already present (by label)
  const existingLabels = new Set(existing.map((w) => w.label));
  const bootstrapAlreadyPresent = STATIC_WATCHLIST_SEEDS.every((s) =>
    existingLabels.has(s.label)
  );

  if (bootstrapAlreadyPresent) {
    return {
      alreadySeeded: true,
      githubWatchlistsCreated: 0,
      hnWatchlistsCreated: 0,
      staticWatchlistsCreated: 0,
      totalWatchlists: existing.length,
      summary: `Master autonomy already seeded (${existing.length} watchlists active). Skipping bootstrap.`
    };
  }

  const existingUrls = new Set(
    existing.map((w) => w.sourceUrl).filter((url): url is string => Boolean(url))
  );

  let githubCreated = 0;
  let hnCreated = 0;
  let staticCreated = 0;

  // 1. Discover GitHub repos in AI automation space (only if no GitHub watchlists exist)
  const hasGithubWatchlists = existing.some(
    (w) => w.sourceKind === "github_repo" || w.sourceKind === "github_release"
  );
  if (!hasGithubWatchlists) {
    try {
      const githubResult = await orchestrator.runGitHubSolutionDiscovery({
        topics: AI_AUTOMATION_GITHUB_TOPICS,
        minStars: 30,
        maxResults: 8
      });
      githubCreated = githubResult.created;
    } catch (error) {
      console.warn(
        "[MasterBootstrap] GitHub discovery failed (network may be unavailable):",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // 2. Discover HackerNews discussions (only if no HN audience watchlists exist)
  const hasHnWatchlists = existing.some(
    (w) => w.sourceKind === "public_discussion_source"
  );
  if (!hasHnWatchlists) {
    try {
      const hnResult = await orchestrator.runHackerNewsAudienceDiscovery({
        painKeywords: BUSINESS_PAIN_KEYWORDS,
        minScore: 3,
        maxResults: 8
      });
      hnCreated = hnResult.created;
    } catch (error) {
      console.warn(
        "[MasterBootstrap] HackerNews discovery failed (network may be unavailable):",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // 3. Seed static strategic watchlists (by URL + label deduplication)
  const currentWatchlists = await orchestrator.listAutonomousWatchlists();
  const currentUrls = new Set(
    currentWatchlists.map((w) => w.sourceUrl).filter((url): url is string => Boolean(url))
  );
  const currentLabels = new Set(currentWatchlists.map((w) => w.label));

  for (const seed of STATIC_WATCHLIST_SEEDS) {
    if (
      (seed.sourceUrl && (existingUrls.has(seed.sourceUrl) || currentUrls.has(seed.sourceUrl))) ||
      currentLabels.has(seed.label)
    ) {
      continue;
    }
    try {
      await orchestrator.createAutonomousWatchlist({
        ...seed,
        isActive: true
      });
      staticCreated += 1;
    } catch (error) {
      console.warn(
        `[MasterBootstrap] Failed to create static watchlist "${seed.label}":`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const total = githubCreated + hnCreated + staticCreated;
  const summary = [
    `Master autonomy bootstrap complete.`,
    `GitHub solution watchlists: ${githubCreated}`,
    `HackerNews audience watchlists: ${hnCreated}`,
    `Static strategic watchlists: ${staticCreated}`,
    `Total watchlists created: ${total}`
  ].join(" | ");

  console.info(`[MasterBootstrap] ${summary}`);

  return {
    alreadySeeded: false,
    githubWatchlistsCreated: githubCreated,
    hnWatchlistsCreated: hnCreated,
    staticWatchlistsCreated: staticCreated,
    totalWatchlists: total,
    summary
  };
}
