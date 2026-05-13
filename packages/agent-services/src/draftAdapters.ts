/**
 * Draft Adapters
 *
 * Adapters that allow autonomous and manual draft entities to implement
 * shared IReviewableDraft semantics without changing native models.
 */

import type {
  AutonomousDraftDocument,
  ContentAsset,
  IReviewableDraft,
  DraftState
} from "@linkedin-brand-os/shared";

/**
 * Adapter for AutonomousDraftDocument to implement IReviewableDraft
 */
export class AutonomousDraftAdapter implements IReviewableDraft {
  constructor(private readonly draft: AutonomousDraftDocument) {}

  getId(): string {
    return this.draft.id;
  }

  getOpportunityId(): string {
    // TRUTHFULNESS: Autonomous drafts track sourceContentWorkItemId,
    // which is one level removed from the opportunity. This is the
    // closest analog we have.
    return this.draft.sourceContentWorkItemId;
  }

  getTitle(): string {
    return this.draft.title;
  }

  getBody(): string {
    return this.draft.body;
  }

  getDraftState(): DraftState {
    // Import the mapper at runtime to avoid circular dependency
    const { mapAutonomousDraftStatusToShared } = require("@linkedin-brand-os/shared");
    return mapAutonomousDraftStatusToShared(this.draft.status);
  }

  getRecommendedAction(): "write_post" | "write_comment" | "write_reply" | "save_for_later" {
    return this.draft.recommendedAction;
  }

  /**
   * Access the underlying native draft
   */
  unwrap(): AutonomousDraftDocument {
    return this.draft;
  }
}

/**
 * Adapter for ContentAsset to implement IReviewableDraft
 *
 * TRUTHFULNESS: Manual path uses ideaId, not opportunityId.
 * getRecommendedAction() returns undefined because ContentAsset doesn't track this.
 */
export class ManualDraftAdapter implements IReviewableDraft {
  constructor(private readonly asset: ContentAsset) {}

  getId(): string {
    return this.asset.id;
  }

  getOpportunityId(): string {
    // TRUTHFULNESS: Manual path uses ideaId, which is the closest analog
    // to opportunityId, though not exactly the same concept
    return this.asset.ideaId;
  }

  getTitle(): string {
    return this.asset.hook;
  }

  getBody(): string {
    return this.asset.body;
  }

  getDraftState(): DraftState {
    // Import the mapper at runtime to avoid circular dependency
    const { mapManualContentStatusToDraftState } = require("@linkedin-brand-os/shared");
    return mapManualContentStatusToDraftState(this.asset.contentStatus);
  }

  getRecommendedAction(): undefined {
    // TRUTHFULNESS: Manual path does not track recommended actions in ContentAsset
    return undefined;
  }

  /**
   * Access the underlying native asset
   */
  unwrap(): ContentAsset {
    return this.asset;
  }
}

/**
 * Factory functions for creating adapters
 */

export function toReviewableDraft(
  entity: AutonomousDraftDocument | ContentAsset
): IReviewableDraft {
  if ("title" in entity) {
    // AutonomousDraftDocument has title field
    return new AutonomousDraftAdapter(entity);
  } else {
    // ContentAsset has hook field instead
    return new ManualDraftAdapter(entity);
  }
}
