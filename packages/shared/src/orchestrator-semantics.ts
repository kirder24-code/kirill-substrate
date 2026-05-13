/**
 * Shared Orchestrator Semantics
 *
 * This module defines a minimal shared internal vocabulary for concepts that
 * are genuinely shared by meaning across autonomous and manual orchestrator paths.
 *
 * These interfaces establish semantic alignment WITHOUT changing behavior.
 * They use adapters/mappers to allow existing entities to implement shared
 * semantics without invasive redesign.
 *
 * TRUTHFULNESS CONSTRAINT: Fields are optional/nullable where not truly
 * supported in one path. We do NOT invent fake semantic values.
 */

/**
 * ReviewState - Shared review progression semantics
 *
 * Maps to both autonomous and manual review states:
 * - Autonomous: "new" | "in_review" | "saved" | "dismissed" | "archived"
 * - Manual: IdeaStatus ("draft" | "approved" | "rejected")
 */
export enum ReviewState {
  /** New opportunity, not yet reviewed */
  NEW = "new",
  /** Currently being reviewed by operator */
  IN_REVIEW = "in_review",
  /** Saved for future action */
  SAVED = "saved",
  /** Dismissed/rejected by operator */
  DISMISSED = "dismissed",
  /** Archived, no longer active */
  ARCHIVED = "archived"
}

/**
 * DraftState - Shared draft readiness semantics
 *
 * Maps to both autonomous and manual draft states:
 * - Autonomous: AutonomousDraftDocumentStatus ("draft" | "ready" | "blocked" | "archived")
 * - Manual: ContentStatus ("draft" | "review" | "published")
 */
export enum DraftState {
  /** Draft in progress, not ready for review */
  DRAFT = "draft",
  /** Ready for operator review */
  READY = "ready",
  /** Blocked, cannot proceed */
  BLOCKED = "blocked",
  /** Archived, no longer active */
  ARCHIVED = "archived"
}

/**
 * IOpportunity - Shared opportunity semantics
 *
 * Represents a content opportunity that can be acted upon.
 * Implemented by:
 * - AutonomousMatchedOpportunity (via adapter)
 * - Idea (via adapter)
 *
 * TRUTHFULNESS: getValue() and getConfidence() are optional because
 * manual path does not calculate priority/confidence scores.
 */
export interface IOpportunity {
  /** Unique identifier */
  getId(): string;

  /** Human-readable title/summary */
  getTitle(): string;

  /** Longer description or rationale */
  getSummary(): string;

  /**
   * Numerical value/priority score (0-100)
   * TRUTHFULNESS: Optional - manual path (Idea) does not calculate this
   */
  getValue(): number | undefined;

  /**
   * Confidence level in this opportunity
   * TRUTHFULNESS: Optional - manual path (Idea) does not calculate this
   */
  getConfidence(): "high" | "medium" | "low" | undefined;

  /**
   * Recommended action to take
   * TRUTHFULNESS: Optional - manual path (Idea) does not track recommended actions
   */
  getRecommendedAction(): "write_post" | "write_comment" | "write_reply" | "save_for_later" | undefined;

  /** Current review state */
  getReviewState(): ReviewState;
}

/**
 * IReviewableDraft - Shared draft semantics
 *
 * Represents a content draft that can be reviewed by operator.
 * Implemented by:
 * - AutonomousDraftDocument (via adapter)
 * - ContentAsset (via adapter)
 */
export interface IReviewableDraft {
  /** Unique identifier */
  getId(): string;

  /**
   * Source opportunity identifier
   * TRUTHFULNESS: Optional - manual path uses ideaId which is not the same as opportunity
   */
  getOpportunityId(): string | undefined;

  /** Draft title */
  getTitle(): string;

  /** Draft body/content */
  getBody(): string;

  /** Current draft state */
  getDraftState(): DraftState;

  /**
   * Recommended action that generated this draft
   * TRUTHFULNESS: Optional - not all drafts track source action
   */
  getRecommendedAction(): "write_post" | "write_comment" | "write_reply" | "save_for_later" | undefined;
}

/**
 * Adapter helpers for mapping between path-specific types and shared semantics
 */

export function mapAutonomousReviewStateToShared(
  state: "new" | "in_review" | "saved" | "dismissed" | "archived"
): ReviewState {
  switch (state) {
    case "new":
      return ReviewState.NEW;
    case "in_review":
      return ReviewState.IN_REVIEW;
    case "saved":
      return ReviewState.SAVED;
    case "dismissed":
      return ReviewState.DISMISSED;
    case "archived":
      return ReviewState.ARCHIVED;
  }
}

export function mapManualIdeaStatusToReviewState(
  status: "draft" | "approved" | "rejected"
): ReviewState {
  switch (status) {
    case "draft":
      return ReviewState.NEW;
    case "approved":
      return ReviewState.SAVED;
    case "rejected":
      return ReviewState.DISMISSED;
  }
}

export function mapAutonomousDraftStatusToShared(
  status: "draft" | "ready" | "blocked" | "archived"
): DraftState {
  switch (status) {
    case "draft":
      return DraftState.DRAFT;
    case "ready":
      return DraftState.READY;
    case "blocked":
      return DraftState.BLOCKED;
    case "archived":
      return DraftState.ARCHIVED;
  }
}

export function mapManualContentStatusToDraftState(
  status: "draft" | "review" | "ready" | "published" | "archived" | undefined
): DraftState {
  if (!status) {
    return DraftState.DRAFT;
  }

  switch (status) {
    case "draft":
      return DraftState.DRAFT;
    case "review":
    case "ready":
      return DraftState.READY;
    case "published":
    case "archived":
      return DraftState.ARCHIVED;
  }
}
