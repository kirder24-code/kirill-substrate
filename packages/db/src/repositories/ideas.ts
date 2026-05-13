import type { Idea } from "@linkedin-brand-os/shared";

export interface CreateIdeaRecord {
  signalId: string;
  title: string;
  coreInsight: string;
  businessRelevance: string;
  targetAudience: string;
  status: Idea["status"];
  sourceContentWorkItemId?: string;
  sourceMatchedOpportunityId?: string;
}

export interface IdeasRepository {
  createIdea(input: CreateIdeaRecord): Promise<Idea>;
  listIdeas(): Promise<Idea[]>;
  getIdeaById(id: string): Promise<Idea | null>;
}

