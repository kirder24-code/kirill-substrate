/**
 * Opportunity Adapters
 *
 * Adapters that allow autonomous and manual opportunity entities to implement
 * shared IOpportunity semantics without changing native models.
 */

import type {
  AutonomousMatchedOpportunity,
  Idea,
  IOpportunity,
  ReviewState,
  mapAutonomousReviewStateToShared,
  mapManualIdeaStatusToReviewState
} from "@linkedin-brand-os/shared";

/**
 * Adapter for AutonomousMatchedOpportunity to implement IOpportunity
 */
export class AutonomousOpportunityAdapter implements IOpportunity {
  constructor(private readonly opportunity: AutonomousMatchedOpportunity) {}

  getId(): string {
    return this.opportunity.id;
  }

  getTitle(): string {
    return this.opportunity.title;
  }

  getSummary(): string {
    return this.opportunity.matchRationale;
  }

  getValue(): number {
    return this.opportunity.priorityScore;
  }

  getConfidence(): "high" | "medium" | "low" {
    return this.opportunity.confidence;
  }

  getRecommendedAction(): "write_post" | "write_comment" | "write_reply" | "save_for_later" {
    return this.opportunity.recommendedAction;
  }

  getReviewState(): ReviewState {
    // Import the mapper at runtime to avoid circular dependency
    const { mapAutonomousReviewStateToShared } = require("@linkedin-brand-os/shared");
    return mapAutonomousReviewStateToShared(this.opportunity.reviewState);
  }

  /**
   * Access the underlying native opportunity
   */
  unwrap(): AutonomousMatchedOpportunity {
    return this.opportunity;
  }
}

/**
 * Adapter for Idea to implement IOpportunity
 *
 * TRUTHFULNESS: Manual path does not calculate priority scores or confidence,
 * so getValue() and getConfidence() return undefined.
 */
export class ManualOpportunityAdapter implements IOpportunity {
  constructor(private readonly idea: Idea) {}

  getId(): string {
    return this.idea.id;
  }

  getTitle(): string {
    return this.idea.title;
  }

  getSummary(): string {
    return this.idea.coreInsight;
  }

  getValue(): undefined {
    // TRUTHFULNESS: Manual path does not calculate priority scores
    return undefined;
  }

  getConfidence(): undefined {
    // TRUTHFULNESS: Manual path does not calculate confidence
    return undefined;
  }

  getRecommendedAction(): undefined {
    // TRUTHFULNESS: Manual path does not track recommended actions in Idea
    return undefined;
  }

  getReviewState(): ReviewState {
    // Import the mapper at runtime to avoid circular dependency
    const { mapManualIdeaStatusToReviewState } = require("@linkedin-brand-os/shared");
    return mapManualIdeaStatusToReviewState(this.idea.status);
  }

  /**
   * Access the underlying native idea
   */
  unwrap(): Idea {
    return this.idea;
  }
}

/**
 * Factory functions for creating adapters
 */

export function toOpportunity(
  entity: AutonomousMatchedOpportunity | Idea
): IOpportunity {
  if ("matchRationale" in entity) {
    // AutonomousMatchedOpportunity
    return new AutonomousOpportunityAdapter(entity);
  } else {
    // Idea
    return new ManualOpportunityAdapter(entity);
  }
}
