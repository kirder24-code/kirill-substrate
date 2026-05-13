import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

interface Lead {
  id: string;
  name: string;
  company?: string;
  role?: string;
  stage: string;
  score: number;
  source_platform?: string;
  service_match?: string;
  pain_description?: string;
  source_url?: string;
  created_at: string;
  last_contact_at?: string;
}

interface Deal {
  id: string;
  lead_id: string;
  service_type?: string;
  amount: number;
  currency: string;
  status: string;
  closed_at?: string;
  created_at: string;
}

interface BotHeartbeat {
  bot_id: string;
  bot_name: string;
  status: string;
  last_action?: string;
  metrics_json?: string;
  pinged_at: string;
}

interface Post {
  id: string;
  topic?: string;
  status?: string;
  created_at: string;
}

interface Revenue {
  totalClosed: number;
  pipeline: number;
  mrr: number;
  mode: string;
}

interface FactoryStatus {
  leads: Lead[];
  deals: Deal[];
  heartbeats: BotHeartbeat[];
  posts: Post[];
  revenue: Revenue;
}

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "bg-blue-100 text-blue-700" },
  contacted: { label: "Contacted", color: "bg-yellow-100 text-yellow-700" },
  qualified: { label: "Qualified", color: "bg-purple-100 text-purple-700" },
  proposal_sent: { label: "Proposal Sent", color: "bg-orange-100 text-orange-700" },
  won: { label: "Won", color: "bg-emerald-100 text-emerald-700" },
  lost: { label: "Lost", color: "bg-red-100 text-red-700" },
};

const MODE_STYLES: Record<string, { label: string; color: string }> = {
  HUNT: { label: "HUNT — No clients, max outreach", color: "text-red-600 bg-red-50 border-red-200" },
  GROW: { label: "GROW — Building momentum", color: "text-yellow-600 bg-yellow-50 border-yellow-200" },
  SCALE: { label: "SCALE — Quality over quantity", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
};

function minutesAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isBotAlive(pingedAt: string, botId: string): boolean {
  const thresholds: Record<string, number> = {
    scout: 6 * 60,
    sales: 2 * 60,
    analytics: 2 * 60,
    build: 24 * 60,
    orchestrator: 10,
  };
  const threshold = thresholds[botId] ?? 60;
  const diffMins = (Date.now() - new Date(pingedAt).getTime()) / 60000;
  return diffMins <= threshold;
}

interface FactoryDashboardProps {
  apiBaseUrl: string;
  authToken: string;
}

export function FactoryDashboard({ apiBaseUrl, authToken }: FactoryDashboardProps) {
  const [status, setStatus] = useState<FactoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/factory/status`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json() as FactoryStatus;
        setStatus(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  };

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
        <span className="ml-3 text-sm text-slate-500">Loading factory status...</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load factory data. Make sure the API is running and database is migrated.
      </div>
    );
  }

  const { leads, deals, heartbeats, posts, revenue } = status;
  const modeStyle = MODE_STYLES[revenue.mode] ?? MODE_STYLES["HUNT"];

  const BOTS = ["orchestrator", "scout", "sales", "analytics", "build"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Factory Dashboard</h2>
          <p className="text-sm text-slate-500">
            Last refresh: {lastRefresh.toLocaleTimeString()} •{" "}
            <button
              className="text-blue-600 underline"
              onClick={() => void fetchStatus()}
              type="button"
            >
              Refresh
            </button>
          </p>
        </div>
        <div className={`rounded-lg border px-4 py-2 text-sm font-medium ${modeStyle.color}`}>
          {revenue.mode} — {modeStyle.label.split(" — ")[1]}
        </div>
      </div>

      {/* Revenue KPIs */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Pipeline</p>
          <p className="mt-1 text-2xl font-bold">${revenue.pipeline.toLocaleString()}</p>
          <p className="text-xs text-slate-400">CAD proposed</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Closed Revenue</p>
          <p className="mt-1 text-2xl font-bold">${revenue.totalClosed.toLocaleString()}</p>
          <p className="text-xs text-slate-400">CAD total</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">MRR</p>
          <p className="mt-1 text-2xl font-bold">${revenue.mrr.toLocaleString()}</p>
          <p className="text-xs text-slate-400">CAD / month</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Active Leads</p>
          <p className="mt-1 text-2xl font-bold">{leads.length}</p>
          <p className="text-xs text-slate-400">in pipeline</p>
        </Card>
      </div>

      {/* Bot Status */}
      <Card>
        <h3 className="mb-3 font-semibold">Bot Status</h3>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {BOTS.map((botId) => {
            const hb = heartbeats.find((h) => h.bot_id === botId);
            const alive = hb ? isBotAlive(hb.pinged_at, botId) : false;
            return (
              <div
                key={botId}
                className={`rounded-lg border p-3 ${
                  alive ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${alive ? "bg-emerald-500" : "bg-slate-400"}`}
                  />
                  <span className="text-sm font-medium capitalize">{botId}</span>
                </div>
                {hb ? (
                  <>
                    <p className="mt-1 text-xs text-slate-500 truncate">{hb.last_action}</p>
                    <p className="text-xs text-slate-400">{minutesAgo(hb.pinged_at)}</p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">Never pinged</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Leads Pipeline */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Leads Pipeline</h3>
          <span className="text-xs text-slate-500">{leads.length} active</span>
        </div>
        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center">
            <p className="text-sm text-slate-500">No active leads.</p>
            <p className="mt-1 text-xs text-slate-400">ScoutBot will add leads as it finds them.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Stage</th>
                  <th className="pb-2 pr-4">Score</th>
                  <th className="pb-2 pr-4">Service</th>
                  <th className="pb-2 pr-4">Source</th>
                  <th className="pb-2">Last Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.map((lead) => {
                  const stageInfo = STAGE_LABELS[lead.stage] ?? { label: lead.stage, color: "bg-slate-100 text-slate-700" };
                  return (
                    <tr key={lead.id} className="hover:bg-slate-50">
                      <td className="py-2 pr-4">
                        <p className="font-medium">{lead.name}</p>
                        {lead.company && <p className="text-xs text-slate-400">{lead.company}</p>}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageInfo.color}`}>
                          {stageInfo.label}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full ${lead.score >= 75 ? "bg-emerald-500" : lead.score >= 50 ? "bg-yellow-500" : "bg-red-400"}`}
                              style={{ width: `${lead.score}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600">{lead.score}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-600">{lead.service_match ?? "—"}</td>
                      <td className="py-2 pr-4 text-xs text-slate-400">{lead.source_platform ?? "—"}</td>
                      <td className="py-2 text-xs text-slate-400">
                        {lead.last_contact_at ? minutesAgo(lead.last_contact_at) : "Not contacted"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Deals */}
      {deals.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Deals</h3>
            <span className="text-xs text-slate-500">{deals.length} deals</span>
          </div>
          <div className="space-y-2">
            {deals.map((deal) => (
              <div key={deal.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{deal.service_type ?? "Custom"}</p>
                  <p className="text-xs text-slate-400">{deal.status}</p>
                </div>
                <p className="text-sm font-bold">${deal.amount.toLocaleString()} {deal.currency}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent Posts */}
      {posts.length > 0 && (
        <Card>
          <h3 className="mb-3 font-semibold">Recent Posts</h3>
          <div className="space-y-2">
            {posts.map((post) => (
              <div key={post.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <p className="text-sm">{post.topic ?? "Untitled post"}</p>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${post.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {post.status ?? "draft"}
                  </span>
                  <span className="text-xs text-slate-400">{minutesAgo(post.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
