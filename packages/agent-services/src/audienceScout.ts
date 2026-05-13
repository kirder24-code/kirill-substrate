import type {
  AudienceScoutInput,
  AudienceScoutItem,
  AudienceScoutResult
} from "@linkedin-brand-os/shared";

const DEFAULT_MAX_RESULTS = 6;
const SCOUT_CREATED_AT = "2026-03-15T00:00:00.000Z";

type AudienceScoutPattern =
  | "workflow_pain"
  | "support_friction"
  | "manual_work"
  | "broken_handoff"
  | "implementation_confusion"
  | "operational_visibility"
  | "general";

interface ScoutSeed {
  idSuffix: string;
  excerpt: string;
  summary: string;
  whyItMatters: string;
  action: AudienceScoutItem["suggestedActionType"];
  confidence: AudienceScoutItem["confidence"];
}

interface PublicScoutInput {
  sourceLabel?: string;
  sourceUrl?: string;
  excerpt: string;
}

interface ScoredAudienceSignal {
  score: number;
  strength: NonNullable<AudienceScoutItem["signalStrength"]>;
  confidence: AudienceScoutItem["confidence"];
  notes: string[];
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function uniqueNormalized(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeToken(value))
        .filter((value) => value.length > 0)
    )
  );
}

function normalizePublicInputs(values: AudienceScoutInput["publicInputs"]): PublicScoutInput[] {
  return (values ?? [])
    .map((item) => ({
      sourceLabel: item.sourceLabel?.trim() || undefined,
      sourceUrl: item.sourceUrl?.trim() || undefined,
      excerpt: item.excerpt.trim()
    }))
    .filter((item) => item.excerpt.length > 0);
}

export function classifyAudienceScoutPattern(topic: string, keywords: string[]): AudienceScoutPattern {
  const combined = normalizeToken(`${topic} ${keywords.join(" ")}`);

  if (
    /\b(manual|spreadsheet|copy paste|busywork|double entry|repeated work|rework)\b/.test(combined)
  ) {
    return "manual_work";
  }

  if (
    /\b(handoff|handoffs|handover|handover gap|workflow chaos|ownerless|ownership)\b/.test(
      combined
    )
  ) {
    return "broken_handoff";
  }

  if (/\b(visibility|black box|status|trace|audit|reporting|observability)\b/.test(combined)) {
    return "operational_visibility";
  }

  if (/\b(implementation|adoption|rollout|enablement|onboarding|setup)\b/.test(combined)) {
    return "implementation_confusion";
  }

  if (/\b(support|ticket|confusion|confused|ux friction|help requests|escalation)\b/.test(combined)) {
    return "support_friction";
  }

  if (/\b(workflow|approval|ops bottleneck|bottleneck|queue|exception|recovery|stalled)\b/.test(combined)) {
    return "workflow_pain";
  }

  return "general";
}

function buildScoutSeed(topic: string, role: string | undefined, pattern: AudienceScoutPattern): ScoutSeed {
  const audienceLabel = role ? `${role} teams` : "operator-led teams";

  switch (pattern) {
    case "manual_work":
      return {
        idSuffix: "manual-work",
        excerpt:
          "We're still doing this by hand after rollout. The team keeps exporting data, updating spreadsheets, and patching the same workflow every week.",
        summary: `${audienceLabel} are still carrying repeated manual work after rollout.`,
        whyItMatters:
          "This exposes an execution tax operators will recognize quickly, which makes it strong material for a practical post or planner input.",
        action: "post_candidate",
        confidence: "high"
      };
    case "broken_handoff":
      return {
        idSuffix: "broken-handoff",
        excerpt:
          "The pilot looked fine, but the handoff broke the minute another team had to own it. Nobody knows who carries the workflow after launch.",
        summary: `${audienceLabel} are flagging broken handoffs after the initial launch phase.`,
        whyItMatters:
          "Broken handoffs create a strong operator lesson and usually translate cleanly into workflow-accountability content.",
        action: "post_candidate",
        confidence: "high"
      };
    case "support_friction":
      return {
        idSuffix: "support-friction",
        excerpt:
          "We keep answering the same questions because the workflow is confusing in real conditions, and support escalations are stacking up.",
        summary: `${audienceLabel} keep surfacing recurring support friction around the workflow.`,
        whyItMatters:
          "This is usually better as an engagement-first opportunity because operators often react to lived support pain in public threads.",
        action: "comment_opportunity",
        confidence: "medium"
      };
    case "implementation_confusion":
      return {
        idSuffix: "implementation-confusion",
        excerpt:
          "The tool makes sense in a demo, but implementation gets messy fast once the team tries to fit it into the real operating process.",
        summary: `${audienceLabel} are describing implementation confusion after the initial rollout.`,
        whyItMatters:
          "This points to adoption friction and gives the operator a strong way to frame why rollout discipline matters.",
        action: "comment_opportunity",
        confidence: "medium"
      };
    case "operational_visibility":
      return {
        idSuffix: "visibility-gap",
        excerpt:
          "We still cannot see where the workflow is stuck until something breaks. The status only becomes visible after the exception lands.",
        summary: `${audienceLabel} are calling out operational visibility gaps in day-to-day execution.`,
        whyItMatters:
          "Visibility pain is useful for both thought leadership and direct replies because it maps to a clear operational consequence.",
        action: "reply_opportunity",
        confidence: "medium"
      };
    case "workflow_pain":
      return {
        idSuffix: "workflow-pain",
        excerpt:
          "The workflow keeps stalling in edge cases, and the team has no clean recovery path once the normal process breaks.",
        summary: `${audienceLabel} are describing recurring workflow pain around exceptions and stalled execution.`,
        whyItMatters:
          "This gives the operator a strong way to talk about recovery ownership, operational resilience, and the cost of unclear process design.",
        action: "reply_opportunity",
        confidence: "medium"
      };
    case "general":
    default:
      return {
        idSuffix: "general",
        excerpt:
          "There is visible discussion around this topic, but the problem framing is still broad and not yet specific enough to act on aggressively.",
        summary: `${audienceLabel} are discussing ${topic}, but the public pain signal is still broad.`,
        whyItMatters:
          "This is worth tracking, but it needs sharper operator evidence before it becomes a strong planner or engagement target.",
        action: "later",
        confidence: "low"
      };
  }
}

function buildSourceUrl(topic: string, pattern: AudienceScoutPattern): string {
  const slug = normalizeToken(`${topic} ${pattern}`).replace(/\s+/g, "-");
  return `https://public.example.com/audience/${slug}`;
}

function buildAuthorName(role: string | undefined): string | undefined {
  if (!role) {
    return undefined;
  }

  if (/founder|ceo/i.test(role)) {
    return "Founder operator";
  }

  if (/ops|operations|revops|coo/i.test(role)) {
    return "Ops lead";
  }

  return "Public operator";
}

function inferTopicClusterFromExcerpt(excerpt: string): string {
  const normalized = normalizeToken(excerpt);

  if (/\b(handoff|handoffs|ownership|owner|owns|handover)\b/.test(normalized)) {
    return "Broken Handoff";
  }

  if (/\b(manual|spreadsheet|copy paste|busywork)\b/.test(normalized)) {
    return "Manual Work";
  }

  if (/\b(support|ticket|confusion|escalation)\b/.test(normalized)) {
    return "Support Friction";
  }

  if (/\b(visibility|status|observability|audit)\b/.test(normalized)) {
    return "Operational Visibility";
  }

  if (/\b(implementation|adoption|rollout|setup|onboarding)\b/.test(normalized)) {
    return "Implementation Confusion";
  }

  if (/\b(workflow|exception|recovery|queue|stalled)\b/.test(normalized)) {
    return "Workflow Pain";
  }

  return "Public Signal";
}

function confidenceForAudienceStrength(
  strength: NonNullable<AudienceScoutItem["signalStrength"]>
): AudienceScoutItem["confidence"] {
  if (strength === "strong") {
    return "high";
  }

  if (strength === "medium") {
    return "medium";
  }

  return "low";
}

function strengthForAudienceScore(
  score: number
): NonNullable<AudienceScoutItem["signalStrength"]> {
  if (score >= 5) {
    return "strong";
  }

  if (score >= 3) {
    return "medium";
  }

  return "weak";
}

function scoreAudiencePublicSignal(
  excerpt: string,
  pattern: AudienceScoutPattern
): ScoredAudienceSignal {
  const normalized = normalizeToken(excerpt);
  let score = 0;
  const notes: string[] = [];

  if (pattern !== "general") {
    score += 2;
    notes.push("Clear operational pain");
  }

  if (
    /\b(workflow|handoff|ownership|manual|support|implementation|visibility|queue|recovery|rollout|approval)\b/.test(
      normalized
    )
  ) {
    score += 1;
    notes.push("Operationally relevant");
  }

  if (
    excerpt.trim().length >= 90 ||
    /\b(because|after|before|until|when|once|every|across)\b/.test(normalized)
  ) {
    score += 1;
    notes.push("Specific workflow context");
  }

  if (
    /\b(breaks|broken|stalled|stack|escalation|escalations|delayed|delay|rework|patching|patch|manual|spreadsheet|every friday)\b/.test(
      normalized
    )
  ) {
    score += 1;
    notes.push("Specific workflow consequence");
  }

  if (
    pattern !== "general" &&
    /\b(owner|ownership|handoff|recovery|support|visibility|workflow|approval)\b/.test(normalized)
  ) {
    score += 1;
    notes.push("Actionable operator angle");
  }

  const strength = strengthForAudienceScore(score);
  return {
    score,
    strength,
    confidence: confidenceForAudienceStrength(strength),
    notes
  };
}

function scoreAudienceKeywordSignal(
  topic: string,
  role: string | undefined,
  keywords: string[],
  pattern: AudienceScoutPattern
): ScoredAudienceSignal {
  const corpus = normalizeToken([topic, role ?? "", keywords.join(" ")].join(" "));
  let score = 0;
  const notes: string[] = [];

  if (pattern !== "general") {
    score += 2;
    notes.push("Clear operational pain");
  }

  if (role) {
    score += 1;
    notes.push("Audience role is explicit");
  }

  if (keywords.length > 0) {
    score += 1;
    notes.push("Target keywords reinforce the pain pattern");
  }

  if (topic.trim().split(/\s+/).length >= 2 || /\b(handoff|manual|visibility|support|workflow)\b/.test(corpus)) {
    score += 1;
    notes.push("Specific workflow context");
  }

  if (
    /\b(manual|handoff|ownership|support|visibility|recovery|escalation|approval)\b/.test(corpus)
  ) {
    score += 1;
    notes.push("Actionable operator angle");
  }

  const strength = strengthForAudienceScore(score);
  return {
    score,
    strength,
    confidence: confidenceForAudienceStrength(strength),
    notes
  };
}

function audienceSortValue(item: AudienceScoutItem): number {
  if (item.signalStrength === "strong") {
    return 3;
  }

  if (item.signalStrength === "medium") {
    return 2;
  }

  return 1;
}

/**
 * Extract specific pain/friction from excerpt instead of collapsing to generic pattern
 * Preserves the actual operational problem described in the source
 */
function extractSpecificPain(excerpt: string): string {
  const cleaned = excerpt.trim();

  // If excerpt is already concise and specific, use it
  if (cleaned.length > 0 && cleaned.length <= 150) {
    return cleaned;
  }

  // Extract first sentence as the core pain signal
  const firstSentence = cleaned.split(/[.!?]\s/)[0];
  if (firstSentence && firstSentence.length > 20 && firstSentence.length <= 150) {
    return firstSentence;
  }

  // Extract first 120 chars with word boundary
  if (cleaned.length > 150) {
    const truncated = cleaned.substring(0, 147);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 100) {
      return truncated.substring(0, lastSpace) + '...';
    }
    return truncated + '...';
  }

  return '';
}

function buildPublicScoutItem(
  input: PublicScoutInput,
  role: string | undefined,
  keywords: string[],
  index: number
): AudienceScoutItem {
  const pattern = classifyAudienceScoutPattern(input.excerpt, keywords);
  const topicCluster = inferTopicClusterFromExcerpt(input.excerpt);
  const audienceLabel = role ? `${role} teams` : "operator-led teams";
  const normalizedExcerpt = normalizeToken(input.excerpt);
  const scored = scoreAudiencePublicSignal(input.excerpt, pattern);
  const lowSignal = scored.strength === "weak";

  let suggestedActionType: AudienceScoutItem["suggestedActionType"] = "later";

  if (!lowSignal) {
    if (pattern === "manual_work" || pattern === "broken_handoff") {
      suggestedActionType = "post_candidate";
    } else if (pattern === "support_friction" || pattern === "implementation_confusion") {
      suggestedActionType = "comment_opportunity";
    } else {
      suggestedActionType = "reply_opportunity";
    }
  }

  // Extract specific pain from excerpt instead of using generic pattern
  const extractedPain = extractSpecificPain(input.excerpt);

  const painSignalSummary = extractedPain.length > 0
    ? extractedPain
    : lowSignal
      ? `${audienceLabel} are discussing this public signal, but the pain pattern is still broad.`
      : pattern === "manual_work"
        ? `${audienceLabel} are still carrying manual workflow work in public discussions.`
        : pattern === "broken_handoff"
          ? `${audienceLabel} are describing broken handoffs and missing ownership in public threads.`
          : pattern === "support_friction"
            ? `${audienceLabel} are surfacing recurring support friction in public discussions.`
            : pattern === "implementation_confusion"
              ? `${audienceLabel} are describing implementation confusion in public rollout conversations.`
              : pattern === "operational_visibility"
                ? `${audienceLabel} are calling out operational visibility gaps in public execution threads.`
                : `${audienceLabel} are describing workflow pain and recovery strain in public discussions.`;

  const whyItMatters = lowSignal
    ? "This is worth keeping in view, but the excerpt is too broad to trust aggressively without more operator evidence."
    : pattern === "manual_work"
      ? "The excerpt points to repeated manual work after rollout, which is a strong operator pain pattern for a post or planner input."
      : pattern === "broken_handoff"
        ? "The excerpt signals a handoff and ownership problem that usually translates well into workflow-accountability content."
        : pattern === "support_friction"
          ? "The excerpt shows lived support pain, which is usually stronger as a comment opportunity than a broad top-of-funnel post."
          : pattern === "implementation_confusion"
            ? "The excerpt highlights rollout and adoption confusion, which creates a grounded engagement angle around implementation reality."
            : pattern === "operational_visibility"
              ? "The excerpt points to visibility gaps in live operations, which often work well as direct replies or tactical discussion hooks."
              : "The excerpt shows workflow breakdown and recovery pressure, which maps to a practical operator lesson around resilience.";

  return {
    id: `scout-public-${normalizedExcerpt.replace(/\s+/g, "-").slice(0, 36)}-${index}`,
    sourcePlatform: "public_web",
    sourceLabel: input.sourceLabel,
    sourceUrl: input.sourceUrl,
    authorName: buildAuthorName(role),
    authorRole: role,
    rawExcerpt: input.excerpt,
    painSignalSummary,
    whyItMatters,
    suggestedActionType,
    topicCluster,
    confidence: scored.confidence,
    signalStrength: scored.strength,
    scoreNotes: scored.notes,
    createdAt: SCOUT_CREATED_AT
  };
}

function buildKeywordScoutItem(
  topic: string,
  role: string | undefined,
  keywords: string[]
): AudienceScoutItem {
  const pattern = classifyAudienceScoutPattern(topic, keywords);
  const seed = buildScoutSeed(topic, role, pattern);
  const normalizedTopic = normalizeToken(topic);
  const scored = scoreAudienceKeywordSignal(topic, role, keywords, pattern);

  return {
    id: `scout-${normalizedTopic.replace(/\s+/g, "-")}-${seed.idSuffix}`,
    sourcePlatform: "public_web",
    sourceUrl: buildSourceUrl(topic, pattern),
    authorName: buildAuthorName(role),
    authorRole: role,
    rawExcerpt: seed.excerpt,
    painSignalSummary: seed.summary,
    whyItMatters: seed.whyItMatters,
    suggestedActionType: scored.strength === "weak" ? "later" : seed.action,
    topicCluster: titleCase(topic),
    confidence: scored.confidence,
    signalStrength: scored.strength,
    scoreNotes: scored.notes,
    createdAt: SCOUT_CREATED_AT
  };
}

function buildSummary(items: AudienceScoutItem[]): string {
  if (items.length === 0) {
    return "No strong public audience signals found for review yet.";
  }

  const postCount = items.filter((item) => item.suggestedActionType === "post_candidate").length;
  const engagementCount = items.filter(
    (item) =>
      item.suggestedActionType === "comment_opportunity" ||
      item.suggestedActionType === "reply_opportunity"
  ).length;

  return `${items.length} audience signals shortlisted: ${postCount} broader post angles and ${engagementCount} discussion opportunities.`;
}

export function buildAudienceScoutResult(input: AudienceScoutInput): AudienceScoutResult {
  const topics = uniqueNormalized(input.targetTopics);
  const roles = uniqueNormalized(input.targetRoles);
  const keywords = uniqueNormalized(input.targetKeywords);
  const publicInputs = normalizePublicInputs(input.publicInputs);
  const maxResults = Math.max(1, Math.min(input.maxResults ?? DEFAULT_MAX_RESULTS, 10));

  if (topics.length === 0 && keywords.length === 0 && publicInputs.length === 0) {
    return {
      items: [],
      summary: "No strong public audience signals found for review yet.",
      notes:
        "Audience Scout needs at least one target topic, keyword, or public excerpt. It stays operator-reviewed and does not execute externally."
    };
  }

  const publicItems = publicInputs.map((publicInput, index) =>
    buildPublicScoutItem(publicInput, roles[index % Math.max(roles.length, 1)], keywords, index)
  );
  const effectiveTopics = topics.length > 0 ? topics : keywords;
  const keywordItems = effectiveTopics.map((topic, index) =>
    buildKeywordScoutItem(topic, roles[index % Math.max(roles.length, 1)], keywords)
  );
  const items = [...publicItems, ...keywordItems]
    .sort((left, right) => audienceSortValue(right) - audienceSortValue(left))
    .slice(0, maxResults);

  return {
    items,
    summary: buildSummary(items),
    notes:
      "Audience Scout is a review-first shortlist. Public URLs are preserved as context only. Send useful items into Source Intake, the queue, or Decision Planner before any generation step."
  };
}
