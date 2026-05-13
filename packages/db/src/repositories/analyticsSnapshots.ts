import type { DashboardSummary } from "@linkedin-brand-os/shared";

export class AnalyticsSnapshotsRepository {
  async latest(): Promise<DashboardSummary | null> {
    return null;
  }

  async create(snapshot: DashboardSummary): Promise<DashboardSummary> {
    return snapshot;
  }
}

