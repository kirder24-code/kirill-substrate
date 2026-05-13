import type { ContentAsset } from "@linkedin-brand-os/shared";

export interface CreateContentAssetRecord {
  ideaId: string;
  signalId?: ContentAsset["signalId"];
  signalAnalysisId?: ContentAsset["signalAnalysisId"];
  orchestratorDecisionId?: ContentAsset["orchestratorDecisionId"];
  sourceContentWorkItemId?: ContentAsset["sourceContentWorkItemId"];
  sourceMatchedOpportunityId?: ContentAsset["sourceMatchedOpportunityId"];
  contentType: ContentAsset["contentType"];
  hook: string;
  body: string;
  cta: string;
  bestAngle?: ContentAsset["bestAngle"];
  alternativeAnglesJson?: ContentAsset["alternativeAnglesJson"];
  recommendedFormat?: ContentAsset["recommendedFormat"];
  longPostDraft?: ContentAsset["longPostDraft"];
  shortPostDraft?: ContentAsset["shortPostDraft"];
  hooksJson?: ContentAsset["hooksJson"];
  commentAnglesJson?: ContentAsset["commentAnglesJson"];
  ctaVariantsJson?: ContentAsset["ctaVariantsJson"];
  carouselOutline?: ContentAsset["carouselOutline"];
  contentStatus?: ContentAsset["contentStatus"];
  publishReadyFlag?: ContentAsset["publishReadyFlag"];
  status: ContentAsset["status"];
  qualityStatus?: ContentAsset["qualityStatus"];
  overallQualityScore?: ContentAsset["overallQualityScore"];
  brandVoiceProfileId?: ContentAsset["brandVoiceProfileId"];
  finalHook?: ContentAsset["finalHook"];
  finalBody?: ContentAsset["finalBody"];
  finalClosing?: ContentAsset["finalClosing"];
  finalStatus?: ContentAsset["finalStatus"];
  finalQualityScore?: ContentAsset["finalQualityScore"];
}

export interface ContentAssetsRepository {
  createContentAsset(input: CreateContentAssetRecord): Promise<ContentAsset>;
  listContentAssets(): Promise<ContentAsset[]>;
  getContentAssetById(id: string): Promise<ContentAsset | null>;
  updateContentAssetCriticState(
    id: string,
    criticState: Pick<
      ContentAsset,
      "contentStatus" | "publishReadyFlag" | "qualityStatus" | "overallQualityScore"
    >
  ): Promise<ContentAsset | null>;
  updateContentAssetRefinement(
    id: string,
    refinement: Pick<
      ContentAsset,
      | "refinedHook"
      | "refinedBody"
      | "refinedCta"
      | "refinementStatus"
      | "qualityStatus"
      | "overallQualityScore"
      | "brandVoiceProfileId"
    >
  ): Promise<ContentAsset | null>;
  updateContentAssetFinalPost(
    id: string,
    finalPost: Pick<
      ContentAsset,
      "finalHook" | "finalBody" | "finalClosing" | "finalStatus" | "finalQualityScore"
    >
  ): Promise<ContentAsset | null>;
}

export interface CreateVisualAssetRecord {
  contentAssetId: string;
  title: string;
  visualType: "single-image" | "carousel" | "diagram";
  prompt: string;
  status: "ready" | "failed";
}

export interface CreateStrategyRecommendationRecord {
  type: "audience" | "format" | "messaging" | "cadence";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
}
