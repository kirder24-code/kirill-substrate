import type { CreateAutonomousWatchlistInput } from "@linkedin-brand-os/shared";

export interface HackerNewsDiscoveryConfig {
  painKeywords?: string[];
  minScore?: number;
  maxResults?: number;
  fetchImpl?: typeof fetch;
}

export interface HackerNewsStory {
  id: number;
  title: string;
  text: string;
  url: string;
  score: number;
  descendants: number; // comment count
  by: string; // author
  time: number;
}

export interface HackerNewsDiscoveryResult {
  stories: HackerNewsStory[];
  watchlistCandidates: CreateAutonomousWatchlistInput[];
  summary: string;
}

/**
 * Discovers audience pain signals from Hacker News discussions
 * Focuses on "Ask HN" posts and discussions about operational problems
 */
export async function discoverHackerNewsAudience(
  config: HackerNewsDiscoveryConfig
): Promise<HackerNewsDiscoveryResult> {
  const {
    painKeywords = DEFAULT_PAIN_KEYWORDS,
    minScore = 5,
    maxResults = 10,
    fetchImpl = globalThis.fetch
  } = config;

  if (!fetchImpl) {
    return {
      stories: [],
      watchlistCandidates: [],
      summary: "No fetch implementation available for HackerNews discovery."
    };
  }

  const stories: HackerNewsStory[] = [];

  try {
    // Get top stories from HN
    const topStoriesUrl = 'https://hacker-news.firebaseio.com/v0/topstories.json';
    const response = await fetchImpl(topStoriesUrl);

    if (!response.ok) {
      return {
        stories: [],
        watchlistCandidates: [],
        summary: `HackerNews API returned ${response.status}`
      };
    }

    const storyIds = (await response.json()) as number[];

    // Fetch details for top stories, looking for pain-oriented discussions
    const candidateIds = storyIds.slice(0, 100); // Check first 100 stories
    let checked = 0;
    let matched = 0;

    for (const id of candidateIds) {
      if (stories.length >= maxResults) {
        break;
      }

      checked += 1;

      try {
        const storyUrl = `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
        const storyResponse = await fetchImpl(storyUrl);

        if (!storyResponse.ok) {
          continue;
        }

        const story = (await storyResponse.json()) as {
          id: number;
          title?: string;
          text?: string;
          url?: string;
          score?: number;
          descendants?: number;
          by?: string;
          time?: number;
          type?: string;
        };

        // Skip if not a story or missing data
        if (!story || story.type !== 'story' || !story.title) {
          continue;
        }

        // Check if title or text contains pain keywords
        const titleLower = story.title.toLowerCase();
        const textLower = (story.text || '').toLowerCase();
        const combined = `${titleLower} ${textLower}`;

        // Filter out off-topic discussions (AI/ML hype, product launches)
        const hasExcludedContent = HN_EXCLUSION_KEYWORDS.some(keyword =>
          combined.includes(keyword.toLowerCase())
        );

        if (hasExcludedContent) {
          continue;
        }

        const hasPainSignal = painKeywords.some(keyword =>
          combined.includes(keyword.toLowerCase())
        );

        if (!hasPainSignal) {
          continue;
        }

        // Check engagement threshold
        const score = story.score || 0;
        if (score < minScore) {
          continue;
        }

        matched += 1;

        stories.push({
          id: story.id,
          title: story.title,
          text: story.text || '',
          url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
          score: score,
          descendants: story.descendants || 0,
          by: story.by || 'unknown',
          time: story.time || 0
        });
      } catch (error) {
        // Skip failed story fetches
        continue;
      }
    }

    // Convert stories to watchlist candidates
    const watchlistCandidates: CreateAutonomousWatchlistInput[] = stories.map(story => ({
      sourceKind: 'public_discussion_source' as const,
      label: `HN: ${story.title.substring(0, 60)}`,
      sourceUrl: story.url,
      seedExcerpt: extractPainSignal(story),
      targetProblem: inferPainCategory(story),
      refreshCadence: 'daily_candidate' as const, // Process immediately, then daily
      priority: story.score > 100 ? 'high' as const : 'normal' as const,
      isActive: true,
      notes: `Auto-discovered HN discussion. ${story.score} points, ${story.descendants} comments. By: ${story.by}`,
      autoPromotionRules: {
        enabled: true,
        minConfidence: 'medium' as const,
        minOpportunityStrength: 'medium' as const,
        autoDraftGeneration: false // Conservative: review audience signals before auto-drafting
      }
    }));

    return {
      stories,
      watchlistCandidates,
      summary: `Checked ${checked} HN stories, found ${matched} pain-oriented discussions. Generated ${watchlistCandidates.length} watchlist candidates.`
    };
  } catch (error) {
    return {
      stories: [],
      watchlistCandidates: [],
      summary: `HackerNews discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Extracts pain signal from story for seed excerpt
 */
function extractPainSignal(story: HackerNewsStory): string {
  if (story.text && story.text.length > 50) {
    // Use text content if available (Ask HN posts often have this)
    return story.text.substring(0, 400);
  }

  // Otherwise use title as seed
  return story.title;
}

/**
 * Infers pain category from story content
 */
function inferPainCategory(story: HackerNewsStory): string {
  const combined = `${story.title} ${story.text}`.toLowerCase();

  if (combined.includes('deploy') || combined.includes('release') || combined.includes('rollout')) {
    return 'Deployment and release workflow pain';
  }

  if (combined.includes('approval') || combined.includes('waiting') || combined.includes('blocked')) {
    return 'Approval and handoff delays';
  }

  if (combined.includes('ownership') || combined.includes('responsibility') || combined.includes('who owns')) {
    return 'Ownership and accountability confusion';
  }

  if (combined.includes('manual') || combined.includes('automat') || combined.includes('toil')) {
    return 'Manual process and automation gaps';
  }

  if (combined.includes('incident') || combined.includes('outage') || combined.includes('downtime')) {
    return 'Incident response and recovery challenges';
  }

  if (combined.includes('monitor') || combined.includes('observ') || combined.includes('visibility')) {
    return 'Observability and monitoring gaps';
  }

  if (combined.includes('test') || combined.includes('qa') || combined.includes('quality')) {
    return 'Testing and quality assurance friction';
  }

  if (combined.includes('security') || combined.includes('compliance') || combined.includes('audit')) {
    return 'Security and compliance workflow challenges';
  }

  return 'DevOps operational friction';
}

/**
 * Default pain-oriented keywords for audience discovery
 * Focused on operational problems, broken processes, and friction
 * Uses single-word and common phrases, filtered by exclusions
 */
export const DEFAULT_PAIN_KEYWORDS = [
  // Approval and handoff friction
  'approval',
  'waiting',
  'blocked',
  'bottleneck',

  // Ownership and accountability
  'ownership',
  'who owns',
  'handoff',
  'unclear',

  // Deployment and release pain
  'deploy',
  'deployment',
  'release',
  'rollback',
  'production',
  'downtime',

  // Incident and exception handling
  'incident',
  'on-call',
  'pagerduty',
  'outage',
  'post-mortem',
  'postmortem',

  // Manual process toil
  'manual',
  'toil',
  'repetitive',

  // DevOps/SRE specific
  'devops',
  'sre',
  'ops team',
  'infrastructure',
  'ci/cd',
  'kubernetes',

  // Ask HN patterns
  'ask hn'
];

/**
 * Keywords that indicate off-topic discussions
 * Used to filter out AI/ML hype, product features, etc.
 */
const HN_EXCLUSION_KEYWORDS = [
  'ai agent',
  'llm',
  'gpt',
  'machine learning',
  'chatbot',
  'openai',
  'anthropic',
  'generative ai',
  'prompt engineering',
  'show hn: ',  // Show HN is usually product launches, not pain discussions
  'startup idea',
  'side project'
];
