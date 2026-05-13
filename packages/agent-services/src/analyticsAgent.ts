import type { AnalyticsSnapshot } from "@linkedin-brand-os/shared";

export interface AnalyticsFindings {
  bestPerformingContentId: string | null;
  averageEngagementRate: number;
  notes: string[];
}

export interface AnalyticsAgentInput {
  snapshots: AnalyticsSnapshot[];
}

export async function analyticsAgent(
  input: AnalyticsAgentInput
): Promise<AnalyticsFindings> {
  if (input.snapshots.length === 0) {
    return {
      bestPerformingContentId: null,
      averageEngagementRate: 0,
      notes: ["Not enough analytics data yet to detect reliable patterns."]
    };
  }

  const ranked = [...input.snapshots].sort((left, right) => {
    const leftScore = left.likes + left.comments * 2 + left.saves * 2;
    const rightScore = right.likes + right.comments * 2 + right.saves * 2;
    return rightScore - leftScore;
  });

  const averageEngagementRate =
    input.snapshots.reduce((total, snapshot) => {
      const engagement =
        snapshot.likes + snapshot.comments + snapshot.saves + snapshot.followersGained;
      return total + engagement / Math.max(snapshot.impressions, 1);
    }, 0) / input.snapshots.length;

  const notes: string[] = [];
  if (averageEngagementRate >= 0.08) {
    notes.push("Engagement is strongest on grounded, practical posts.");
  } else {
    notes.push("Current engagement is modest; tighten the hook and payoff.");
  }

  const visualSignals = input.snapshots.some((snapshot) => snapshot.saves >= 5);
  if (visualSignals) {
    notes.push("Visual-linked posts are producing above-average engagement.");
  }

  return {
    bestPerformingContentId: ranked[0]?.contentAssetId ?? null,
    averageEngagementRate: Number(averageEngagementRate.toFixed(4)),
    notes
  };
}

