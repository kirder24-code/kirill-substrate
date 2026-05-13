"use client";

import { useState } from "react";

const DEFAULT_COMPANY = "[CompanyName]";
const DEFAULT_DEMO = "(856) 556-8035";
const DEFAULT_CALENDAR = "https://cal.com/kirill-d";

const PRICING_SHOCK_SUBJECT_TEMPLATES = [
  (c: string) => `${c} - $2,800/mo for a receptionist vs $299/mo AI`,
  (c: string) => `Quick question about front-desk costs at ${c}`,
  (c: string) => `${c} - what your receptionist actually costs per month`,
  (c: string) => `${c} - front-desk coverage at a fraction of the cost`,
  (c: string) => `${c} - replacing a $35K salary with a $299/mo agent`,
];

function buildPricingShockEmail(company: string, demo: string, calendar: string): string {
  return `Hi,

Quick question: what does your front desk cost per month?

A full-time receptionist in your area runs $2,800-$3,500/mo - salary alone, before benefits, sick days, turnover, or training. And they still can't answer calls at 8pm or on weekends.

We install a 24/7 AI receptionist for ${company} starting at $199-$499/mo. It answers calls live (not a recording), books appointments, handles intake questions, and routes emergencies. Same coverage, a fraction of the cost.

No hardware. No new software for your staff. Setup in 3 days.

You can hear it answer a live call right now: dial ${demo}.

If that sounds worth 15 minutes: ${calendar}

- Kirill D.
AI Voice Automation for Trades and Service Companies
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;
}

function buildPricingShockCallScript(company: string, demo: string): string {
  return `COLD CALL SCRIPT - PRICING-SHOCK INTENT

Target: Businesses posting about receptionist costs, staffing shortages, or front-desk burnout.

Opening:
"Hi, is this the owner or manager? I am calling from LaunchSoloAI - we help service businesses replace their front-desk phone costs with an AI receptionist. Do you have 60 seconds?"

If yes:
"A full-time receptionist runs $2,800-$3,500/mo. We do the same job - answer calls live, book appointments, handle intake - for $199-$499/mo flat. No hiring, no sick days, no turnover.

You can hear it live right now at ${demo}. It answers like a human, not a recording.

Would you be open to a 15-minute call to see if it fits ${company}?"

If they ask about price:
"$199-$499/mo depending on call volume and features. A single missed booking or new patient call usually pays for a month."

If they say they already have a receptionist:
"I am not asking you to replace anyone - a lot of businesses use us to cover evenings, weekends, and overflow so the front desk can focus on in-person patients instead of the phone."

Objection - we tried something like that before:
"Most of those were recordings or call trees. This is different - it holds a real conversation. You can test it right now: ${demo}."

Close:
"What does your week look like? I have two slots open - Tuesday and Thursday afternoon."`;
}

function buildPricingShockSms(company: string, demo: string): string {
  return `${company} - AI receptionist at $199-$499/mo vs $2,800+/mo human. Answers 24/7, live (not a recording). Hear it: ${demo}. Worth 15 min?`;
}

const PRICING_SHOCK_INTENT_SIGNALS = [
  "Reddit/forum post: owner complaining about receptionist cost, turnover, or sick days",
  "Indeed/LinkedIn job posting for receptionist at dental, law, HVAC, or plumbing business",
  "Facebook group post: 'who handles your front desk?' or 'how do you deal with phones?'",
  "Review mentions 'hard to reach' or 'phone just rings' - signals staff shortage",
  "Business posts about hiring struggles or front-desk vacancies on social media",
  "Site shows 'Now Hiring - Receptionist' or similar banner",
  "Glassdoor/Indeed reviews from employees mention being overwhelmed or understaffed at front desk",
];

const PRICING_SHOCK_SEARCH_QUERIES = [
  "site:reddit.com dental receptionist cost",
  "site:reddit.com HVAC receptionist burnout",
  "site:reddit.com law firm receptionist salary",
  "site:reddit.com plumber front desk staffing",
  "site:reddit.com dental front desk overwhelmed",
  "site:reddit.com receptionist quit dentist",
  "site:facebook.com HVAC hiring receptionist",
  "site:facebook.com dental receptionist shortage",
  "site:indeed.com law firm receptionist salary",
  "site:indeed.com dental receptionist Calgary",
  "site:indeed.com HVAC office receptionist",
  "site:indeed.com plumbing front desk",
  "site:forum* front desk overwhelmed dentist",
  "site:reddit.com small business receptionist cost per month",
  "site:reddit.com hiring receptionist expensive alternative",
];

const PRICING_SHOCK_NICHES = [
  { label: "Dental", why: "High call volume, emergency calls after hours, frequent receptionist turnover, $30-40K/yr salary common" },
  { label: "Law firms", why: "Client intake calls are high-stakes, after-hours inquiries are common, missing a call = lost retainer" },
  { label: "HVAC", why: "Emergency calls at night and weekends, dispatching is time-sensitive, one missed call = lost job" },
  { label: "Plumbing", why: "Urgent call pattern, small operators often answer themselves or miss calls entirely" },
];

const COMPARISON_TABLE = [
  { item: "Monthly cost", human: "$2,800 - $3,500+", ai: "$199 - $499" },
  { item: "Hours covered", human: "8am - 5pm weekdays", ai: "24/7, every day" },
  { item: "Sick days / vacation", human: "Yes - you cover or close", ai: "None" },
  { item: "Onboarding time", human: "2-4 weeks", ai: "3 days" },
  { item: "Turnover risk", human: "High - avg tenure 12 months", ai: "Zero" },
  { item: "After-hours calls", human: "Missed or voicemail", ai: "Answered live" },
];

const COLD_CALL_CHECKLIST_PS = [
  "Lead shows active receptionist hiring or cost complaint signal (post, review, job ad)",
  "Business is in dental, law, HVAC, or plumbing vertical",
  "Business has active Google presence - reviews in last 90 days",
  "Found owner or manager name via LinkedIn or Google Business",
  "Demo number ready: " + DEFAULT_DEMO,
  "Calendar link ready: " + DEFAULT_CALENDAR,
  "Called between 9-11am or 2-4pm local time",
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={{
        padding: "2px 10px",
        fontSize: 12,
        cursor: "pointer",
        background: copied ? "#16a34a" : "#334155",
        color: "#fff",
        border: "none",
        borderRadius: 4,
        marginLeft: 8,
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function PricingShockPage() {
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [demo, setDemo] = useState(DEFAULT_DEMO);
  const [calendar, setCalendar] = useState(DEFAULT_CALENDAR);

  const subjects = PRICING_SHOCK_SUBJECT_TEMPLATES.map(fn => fn(company));
  const emailBody = buildPricingShockEmail(company, demo, calendar);
  const callScript = buildPricingShockCallScript(company, demo);
  const sms = buildPricingShockSms(company, demo);

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#e2e8f0",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#94a3b8",
    display: "block",
    marginBottom: 4,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: "#7dd3fc",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    margin: "20px 0 10px",
  };

  const preStyle: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 8,
    padding: 14,
    fontSize: 13,
    color: "#e2e8f0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    lineHeight: 1.6,
  };

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 20px", fontFamily: "monospace", color: "#e2e8f0", background: "#0f172a", minHeight: "100vh" }}>

      {/* Hero */}
      <div style={{ background: "#0c2340", border: "1px solid #1e4a7a", borderRadius: 10, padding: "24px 28px", marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#f0f9ff", marginBottom: 10, lineHeight: 1.3 }}>
          Pricing-Shock Lead Source
        </h1>
        <p style={{ fontSize: 14, color: "#7dd3fc", marginBottom: 6 }}>
          Target businesses actively complaining about receptionist cost, staffing gaps, or front-desk burnout.
        </p>
        <p style={{ fontSize: 13, color: "#bae6fd", marginBottom: 12 }}>
          Hook: $199-$499/mo AI receptionist vs $2,800+/mo human front desk.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>Dental</span>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>Law firms</span>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>HVAC</span>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>Plumbing</span>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>Reddit + Facebook + Indeed signals</span>
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#94a3b8" }}>Pricing-Shock Outreach Kit</h2>
      <p style={{ color: "#475569", fontSize: 13, marginBottom: 24 }}>
        Fill in company details, copy each section before sending or calling.
      </p>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>Company Name</label>
          <input style={inputStyle} value={company} onChange={e => setCompany(e.target.value)} placeholder="Bright Smile Dental" />
        </div>
        <div>
          <label style={labelStyle}>Demo Number</label>
          <input style={inputStyle} value={demo} onChange={e => setDemo(e.target.value)} placeholder="(856) 556-8035" />
        </div>
        <div>
          <label style={labelStyle}>Calendar Link</label>
          <input style={inputStyle} value={calendar} onChange={e => setCalendar(e.target.value)} placeholder="https://cal.com/kirill-d" />
        </div>
      </div>

      {/* Comparison table */}
      <div style={sectionTitle}>(a) Cost Comparison Table - Use in Calls / Demos</div>
      <div style={{ background: "#0c1a2e", border: "1px solid #1e3a5f", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", background: "#1e293b", padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>
          <span></span>
          <span style={{ color: "#f87171" }}>Human receptionist</span>
          <span style={{ color: "#86efac" }}>AI receptionist</span>
        </div>
        {COMPARISON_TABLE.map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "8px 14px", fontSize: 12, borderTop: "1px solid #1e293b", background: i % 2 === 0 ? "#0c1a2e" : "#0f172a" }}>
            <span style={{ color: "#94a3b8" }}>{row.item}</span>
            <span style={{ color: "#fca5a5" }}>{row.human}</span>
            <span style={{ color: "#86efac" }}>{row.ai}</span>
          </div>
        ))}
      </div>

      {/* Subject lines */}
      <div style={sectionTitle}>(b) Email Subject Lines</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {subjects.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "8px 12px" }}>
            <span style={{ color: "#64748b", marginRight: 10, fontSize: 12 }}>{i + 1}.</span>
            <span style={{ flex: 1, fontSize: 13 }}>{s}</span>
            <CopyButton text={s} />
          </div>
        ))}
      </div>

      {/* Email body */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>(c) Email Body - Pricing-Shock Angle</span>
        <CopyButton text={emailBody} />
      </div>
      <pre style={preStyle}>{emailBody}</pre>

      {/* SMS */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>(d) SMS Variant</span>
        <CopyButton text={sms} />
      </div>
      <div style={{ ...preStyle, fontStyle: "normal" }}>
        {sms}
        <span style={{ color: "#475569", marginLeft: 8, fontSize: 11 }}>({sms.length} chars)</span>
      </div>

      {/* Call script */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>(e) Cold Call Script - Pricing-Shock</span>
        <CopyButton text={callScript} />
      </div>
      <pre style={preStyle}>{callScript}</pre>

      {/* Pre-call checklist */}
      <div style={sectionTitle}>(f) Pre-Call Checklist</div>
      <div style={{ background: "#0c2340", border: "1px solid #1e3a5f", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        {COLD_CALL_CHECKLIST_PS.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
            <span style={{ color: "#f97316", fontSize: 14, marginTop: 1 }}>[ ]</span>
            <span style={{ fontSize: 13, color: "#cbd5e1" }}>{item}</span>
          </div>
        ))}
      </div>

      {/* Intent signals */}
      <div style={sectionTitle}>(g) Pricing-Shock Intent Signals - Who to Target</div>
      <div style={{ background: "#0c1a2e", border: "1px solid #1e3a5f", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Prioritize businesses showing any of these signals:
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {PRICING_SHOCK_INTENT_SIGNALS.map((s, i) => (
            <li key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>{s}</li>
          ))}
        </ul>
      </div>

      {/* Search queries */}
      <div style={sectionTitle}>(h) Lead-Finding Search Queries - Reddit / Facebook / Indeed / Forums</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {PRICING_SHOCK_SEARCH_QUERIES.map((q, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "7px 12px" }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: "monospace", color: "#7dd3fc" }}>{q}</span>
            <CopyButton text={q} />
          </div>
        ))}
      </div>

      {/* Niche priority */}
      <div style={sectionTitle}>(i) Top Verticals - Priority Order</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {PRICING_SHOCK_NICHES.map((n, i) => (
          <div key={i} style={{ background: "#1e293b", borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f0f9ff" }}>{i + 1}. {n.label}: </span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{n.why}</span>
          </div>
        ))}
      </div>

      {/* Anchor line */}
      <div style={{ background: "#1a1200", border: "1px solid #78350f", borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>ANCHOR LINE - USE THIS IN ALL OUTREACH</div>
        <div style={{ fontSize: 13, color: "#fef3c7", marginBottom: 8 }}>
          "$199-$499/mo AI receptionist vs $2,800+/mo human front desk. Answers 24/7, live - not a recording."
        </div>
        <CopyButton text="$199-$499/mo AI receptionist vs $2,800+/mo human front desk. Answers 24/7, live - not a recording." />
      </div>

    </div>
  );
}
