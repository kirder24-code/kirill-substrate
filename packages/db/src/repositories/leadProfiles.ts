import type { LeadProfile } from "@linkedin-brand-os/shared";

export class LeadProfilesRepository {
  async list(): Promise<LeadProfile[]> {
    return [];
  }

  async create(profile: LeadProfile): Promise<LeadProfile> {
    return profile;
  }
}

