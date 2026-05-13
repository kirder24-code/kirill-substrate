import React, { useEffect, useState, useCallback } from "react";

const TENANT = (typeof window !== "undefined" && window.location.hostname.split(".")[0]) || "default";
const fmtTime = (d) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

async function fetchJson(path, fallback) {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return fallback;
    return await r.json();
  } catch {
    return fallback;
  }
}

const DEFAULT_METRICS = {
  pipeline_usd: 0,
  pipeline_delta_pct: 0,
  decisions_due: 0,
  active_builds: 0,
};
const DEFAULT_DEPARTMENTS = [
  { name: "FINANCE", status: "amber", message: "Loading..." },
  { name: "SALES", status: "amber", message: "Loading..." },
  { name: "OPERATIONS", status: "amber", message: "Loading..." },
  { name: "MARKETING", status: "amber", message: "Loading..." },
  { name: "TECHNOLOGY", status: "amber", message: "Loading..." },
  { name: "STRATEGY", status: "amber", message: "Loading..." },
];
const DEFAULT_HEALTH = [
  { label: "Revenue", pct: 0, gradient: "linear-gradient(90deg,var(--arc),var(--green))" },
  { label: "Pipeline", pct: 0, gradient: "linear-gradient(90deg,var(--amber),#ff8800)" },
  { label: "Marketing", pct: 0, gradient: "linear-gradient(90deg,#ff69b4,var(--red))" },
  { label: "Operations", pct: 0, gradient: "linear-gradient(90deg,var(--arc),#00aaff)" },
  { label: "Tech Build", pct: 0, gradient: "linear-gradient(90deg,var(--gold),#e6c466)" },
];

function MetricsPanel({ metrics }) {
  return (
    <div className="panel">
      <div className="panel-title">// LIVE METRICS</div>
      <div className="metric-block cyan">
        <div className="v">${(metrics.pipeline_usd / 1000).toFixed(0)}K</div>
        <div className="l">Pipeline Value</div>
      </div>
      <div className={`metric-block ${metrics.pipeline_delta_pct >= 0 ? "up" : "down"}`}>
        <div className="v">{metrics.pipeline_delta_pct >= 0 ? "+" : ""}{metrics.pipeline_delta_pct}%</div>
        <div className="l">MoM Growth</div>
      </div>
      <div className="metric-block warn">
        <div className="v">{metrics.decisions_due}</div>
        <div className="l">Decisions Due</div>
      </div>
      <div className="metric-block">
        <div className="v">{metrics.active_builds}</div>
        <div className="l">Active Builds</div>
      </div>
    </div>
  );
}

function DepartmentsPanel({ departments }) {
  return (
    <div className="panel">
      <div className="panel-title">// DEPARTMENT STATUS</div>
      {departments.map((d) => (
        <div className="dept-row" key={d.name}>
          <div className={`dot ${d.status}`} />
          <div className="dept-name">{d.name}</div>
          <div className="dept-msg">{d.message}</div>
        </div>
      ))}
    </div>
  );
}

function HealthPanel({ health }) {
  return (
    <div className="panel">
      <div className="panel-title">// BUSINESS HEALTH</div>
      {health.map((h) => (
        <div className="bar-row" key={h.label}>
          <div className="bar-label"><span>{h.label}</span><span>{h.pct}%</span></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${h.pct}%`, background: h.gradient }} /></div>
        </div>
      ))}
    </div>
  );
}

function BriefPanel({ brief, onRefresh }) {
  return (
    <div className="brief-panel">
      <div className="panel-title">// AI MORNING BRIEF · {brief?.generated_at ? new Date(brief.generated_at).toLocaleString() : "loading..."}</div>
      <div className="brief-text">{brief?.text || "Waiting for substrate to synthesize today's brief..."}</div>
      {brief?.pills && brief.pills.length > 0 && (
        <div className="brief-actions">
          {brief.pills.map((p, i) => <span className="brief-pill" key={i}>{p}</span>)}
        </div>
      )}
      <div className="brief-actions">
        <button className="brief-pill" onClick={onRefresh} style={{ cursor: "pointer" }}>↻ REFRESH BRIEF</button>
        <button className="brief-pill" style={{ cursor: "pointer" }} onClick={() => alert("Voice interface coming online soon.")}>🎤 ASK COMMAND</button>
      </div>
    </div>
  );
}

const TABS = [
  { id: "opportunities", label: "OPPORTUNITIES" },
  { id: "pipeline", label: "PIPELINE" },
  { id: "automation", label: "AUTOMATION" },
];

function OpportunitiesRow({ tab, opps }) {
  if (!opps || opps.length === 0) {
    return <div style={{ padding: 20, color: "var(--text-3)", fontSize: 12 }}>No items in this view.</div>;
  }
  return (
    <div>
      {opps.map((o) => (
        <div className="opp-row" key={o.id}>
          <div><span className={`opp-state ${o.state}`}>{o.state}</span></div>
          <div className="opp-title">{o.title}</div>
          <div className="opp-source">{o.source}</div>
          <div><button className="opp-action">VIEW →</button></div>
        </div>
      ))}
    </div>
  );
}

function RowPanel({ opportunities }) {
  const [tab, setTab] = useState("opportunities");
  return (
    <div className="panel">
      <div className="row-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`row-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <OpportunitiesRow tab={tab} opps={opportunities[tab] || []} />
    </div>
  );
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [departments, setDepartments] = useState(DEFAULT_DEPARTMENTS);
  const [health, setHealth] = useState(DEFAULT_HEALTH);
  const [brief, setBrief] = useState(null);
  const [opportunities, setOpportunities] = useState({ opportunities: [], pipeline: [], automation: [] });
  const [tenant, setTenant] = useState({ name: "BRAND OS", logo_word: "BRAND", logo_accent: "OS" });

  const refresh = useCallback(async () => {
    const [m, d, h, b, o, t] = await Promise.all([
      fetchJson("/api/state/metrics", DEFAULT_METRICS),
      fetchJson("/api/state/departments", DEFAULT_DEPARTMENTS),
      fetchJson("/api/state/health", DEFAULT_HEALTH),
      fetchJson("/api/state/brief", null),
      fetchJson("/api/state/opportunities", { opportunities: [], pipeline: [], automation: [] }),
      fetchJson(`/api/state/tenant?id=${TENANT}`, { name: "BRAND OS", logo_word: "BRAND", logo_accent: "OS" }),
    ]);
    setMetrics(m);
    setDepartments(d);
    setHealth(h);
    setBrief(b);
    setOpportunities(o);
    setTenant(t);
  }, []);

  useEffect(() => {
    refresh();
    const tick = setInterval(() => setNow(new Date()), 1000);
    const poll = setInterval(refresh, 30_000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [refresh]);

  return (
    <div className="cmd-shell">
      <div className="cmd-header">
        <div className="cmd-logo">{tenant.logo_word}<span>{tenant.logo_accent}</span> · COMMAND</div>
        <div className="cmd-clock">{fmtTime(now)} · {now.toISOString().slice(0, 10)}</div>
        <div className="cmd-status">SUBSTRATE LIVE</div>
      </div>
      <div className="cmd-body">
        <div className="cmd-grid">
          <MetricsPanel metrics={metrics} />
          <BriefPanel brief={brief} onRefresh={refresh} />
          <HealthPanel health={health} />
        </div>
        <RowPanel opportunities={opportunities} />
        <DepartmentsPanel departments={departments} />
        <div className="cmd-footer">
          <span>TENANT: {TENANT.toUpperCase()}</span>
          <span>POLL: 30S · TICK: 1S</span>
        </div>
      </div>
    </div>
  );
}
