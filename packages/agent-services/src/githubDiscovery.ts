import type { CreateAutonomousWatchlistInput } from "@linkedin-brand-os/shared";

export interface GitHubDiscoveryConfig {
  topics: string[];
  minStars?: number;
  maxResults?: number;
  fetchImpl?: typeof fetch;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  description: string;
  url: string;
  stars: number;
  language: string;
  topics: string[];
  updatedAt: string;
}

export interface GitHubDiscoveryResult {
  repos: GitHubRepo[];
  watchlistCandidates: CreateAutonomousWatchlistInput[];
  summary: string;
}

/**
 * Discovers solution-oriented GitHub repos based on topics
 * Returns watchlist candidates ready for autonomous processing
 */
export async function discoverGitHubSolutions(
  config: GitHubDiscoveryConfig
): Promise<GitHubDiscoveryResult> {
  const {
    topics,
    minStars = 50,
    maxResults = 5,
    fetchImpl = globalThis.fetch
  } = config;

  if (!fetchImpl) {
    return {
      repos: [],
      watchlistCandidates: [],
      summary: "No fetch implementation available for GitHub discovery."
    };
  }

  const repos: GitHubRepo[] = [];

  try {
    // Query GitHub API for repos with specified topics
    // Using GitHub search API: https://docs.github.com/en/rest/search
    for (const topic of topics) {
      const query = `topic:${topic} stars:>=${minStars} sort:updated`;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${maxResults}&sort=updated`;

      const response = await fetchImpl(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'linkedin-brand-os-discovery'
        }
      });

      if (!response.ok) {
        console.warn(`GitHub API returned ${response.status} for topic: ${topic}`);
        continue;
      }

      const data = await response.json() as {
        items: Array<{
          name: string;
          full_name: string;
          description: string;
          html_url: string;
          stargazers_count: number;
          language: string;
          topics: string[];
          updated_at: string;
        }>;
      };

      for (const item of data.items.slice(0, maxResults)) {
        // Skip if we already have this repo
        if (repos.some(r => r.fullName === item.full_name)) {
          continue;
        }

        // Filter out repos that match exclusion keywords
        const description = (item.description || '').toLowerCase();
        const repoName = item.full_name.toLowerCase();
        const hasExcludedContent = EXCLUSION_KEYWORDS.some(keyword =>
          description.includes(keyword.toLowerCase()) || repoName.includes(keyword.toLowerCase())
        );

        if (hasExcludedContent) {
          continue;
        }

        repos.push({
          name: item.name,
          fullName: item.full_name,
          description: item.description || "No description",
          url: item.html_url,
          stars: item.stargazers_count,
          language: item.language || "unknown",
          topics: item.topics || [],
          updatedAt: item.updated_at
        });
      }
    }

    // Convert repos to watchlist candidates
    const watchlistCandidates: CreateAutonomousWatchlistInput[] = repos.map(repo => ({
      sourceKind: 'github_repo' as const,
      label: `GitHub: ${repo.fullName}`,
      sourceUrl: repo.url,
      seedExcerpt: repo.description,
      targetProblem: inferTargetProblem(repo),
      refreshCadence: 'weekly_candidate' as const,
      priority: repo.stars > 1000 ? 'high' as const : 'normal' as const,
      isActive: true,
      notes: `Auto-discovered via topics: ${repo.topics.slice(0, 3).join(', ')}. ${repo.stars} stars.`,
      autoPromotionRules: {
        enabled: true,
        minConfidence: 'medium' as const,
        minOpportunityStrength: 'medium' as const,
        autoDraftGeneration: false // Conservative: review before auto-drafting from discovered sources
      }
    }));

    return {
      repos,
      watchlistCandidates,
      summary: `Discovered ${repos.length} GitHub repos across ${topics.length} topics. Generated ${watchlistCandidates.length} watchlist candidates.`
    };
  } catch (error) {
    return {
      repos: [],
      watchlistCandidates: [],
      summary: `GitHub discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Infers target problem from repo metadata
 */
function inferTargetProblem(repo: GitHubRepo): string {
  const topics = repo.topics.join(' ').toLowerCase();
  const desc = repo.description.toLowerCase();
  const combined = `${topics} ${desc}`;

  if (combined.includes('deploy') || combined.includes('ci') || combined.includes('cd')) {
    return 'Deployment and release automation challenges';
  }

  if (combined.includes('infrastructure') || combined.includes('terraform') || combined.includes('cloud')) {
    return 'Infrastructure provisioning and management';
  }

  if (combined.includes('monitor') || combined.includes('observability') || combined.includes('logging')) {
    return 'Observability and incident management';
  }

  if (combined.includes('kubernetes') || combined.includes('container') || combined.includes('docker')) {
    return 'Container orchestration and deployment';
  }

  if (combined.includes('security') || combined.includes('compliance')) {
    return 'Security and compliance automation';
  }

  if (combined.includes('testing') || combined.includes('qa')) {
    return 'Testing and quality automation';
  }

  return 'DevOps automation and tooling';
}

/**
 * Default discovery config for solution-oriented repos
 * Narrowed to specific operational automation categories
 */
export const DEFAULT_SOLUTION_DISCOVERY_TOPICS = [
  'infrastructure-as-code',
  'ci-cd',
  'gitops',
  'kubernetes-operators',
  'terraform',
  'deployment-automation'
];

/**
 * Keywords that indicate a repo is NOT an operational tool
 * Used to filter out data tools, personal sites, etc.
 */
const EXCLUSION_KEYWORDS = [
  'visualization',
  'dashboard',
  'analytics',
  'data science',
  'machine learning',
  'personal',
  'portfolio',
  'blog',
  'tutorial'
];
