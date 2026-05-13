import type { AnalyzeRelevanceInput, RelevanceAnalysis } from "@linkedin-brand-os/shared";

const icpRolePatterns = /(founder|cofounder|operator|operations|ops leader|revops|sales ops|gtm|go-to-market|chief operating officer|coo)/i;
const lowFitRolePatterns = /(student|designer|recruiter|influencer|fitness|lifestyle|creator)/i;
const workflowPatterns = /(workflow|handoff|owner|ownership|exception|accountability|process|ops|operations|automation|rollout|queue|approval)/i;
const roiPatterns = /(roi|revenue|margin|cost|throughput|adoption|execution|pipeline)/i;

function clean(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export async function relevanceAnalyzer(
  input: AnalyzeRelevanceInput
): Promise<RelevanceAnalysis> {
  const corpus = clean([
    input.companyText,
    input.roleTitle,
    input.postText,
    input.websiteAboutText
  ]);

  let score = 0;
  const riskNotes: string[] = [];

  if (icpRolePatterns.test(input.roleTitle ?? "")) score += 35;
  if (workflowPatterns.test(corpus)) score += 40;
  if (roiPatterns.test(corpus)) score += 20;
  if (/founder|operator|ops|gtm|revenue|automation|support/i.test(corpus)) score += 12;
  if (lowFitRolePatterns.test(input.roleTitle ?? "")) score -= 35;
  if (/hiring|culture|brand design|wellness|personal productivity/i.test(corpus)) score -= 20;

  const relevanceScore = Math.max(0, Math.min(100, score));

  let bestAngle: RelevanceAnalysis["bestAngle"] = "low_fit";
  if (/owner|ownership/i.test(corpus)) bestAngle = "ownership_gap";
  else if (/handoff|handoffs/i.test(corpus)) bestAngle = "handoff_failure";
  else if (/exception/i.test(corpus)) bestAngle = "exception_handling";
  else if (/accountability|workflow|process/i.test(corpus)) bestAngle = "workflow_accountability";
  else if (roiPatterns.test(corpus)) bestAngle = "operational_roi";

  let recommendedAction: RelevanceAnalysis["recommendedAction"] = "ignore";
  if (relevanceScore >= 75) {
    recommendedAction = input.hasCommentContext ? "reply" : "comment";
  } else if (relevanceScore >= 45) {
    recommendedAction = "save_for_later";
  } else if (relevanceScore >= 35 && icpRolePatterns.test(input.roleTitle ?? "")) {
    recommendedAction = "outreach_candidate";
  }

  if (relevanceScore < 40) {
    riskNotes.push("Low ICP overlap.");
  }
  if (!workflowPatterns.test(corpus)) {
    riskNotes.push("Weak workflow/process signal.");
  }
  if (/generic ai|future of ai|thought leadership/i.test(corpus)) {
    riskNotes.push("May be generic AI commentary rather than operational pain.");
  }

  const targetType: RelevanceAnalysis["targetType"] =
    input.companyText && input.roleTitle && input.postText
      ? "mixed"
      : input.postText
        ? "post"
        : input.roleTitle
          ? "role"
          : "company";

  const angleSummaryMap: Record<RelevanceAnalysis["bestAngle"], string> = {
    ownership_gap: "The strongest angle is ownership after the workflow leaves the demo.",
    handoff_failure: "The strongest angle is handoff failure across teams or systems.",
    exception_handling: "The strongest angle is exception handling once live work gets messy.",
    workflow_accountability: "The strongest angle is workflow accountability in real operations.",
    operational_roi: "The strongest angle is practical ROI tied to execution quality.",
    low_fit: "There is not enough ICP overlap to justify engagement."
  };

  return {
    relevanceScore,
    targetType,
    bestAngle,
    recommendedAction,
    riskNotes,
    reasoningSummary: angleSummaryMap[bestAngle],
    mode: "deterministic"
  };
}
