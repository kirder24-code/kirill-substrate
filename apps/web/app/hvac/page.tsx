"use client";

import { useState } from "react";

const DEFAULT_COMPANY = "[CompanyName]";
const DEFAULT_DEMO = "(856) 556-8035";
const DEFAULT_CALENDAR = "https://cal.com/kirill-d";

const HVAC_SUBJECT_TEMPLATES = [
  (c: string) => `${c} - who answers your emergency calls tonight?`,
  (c: string) => `${c} - missed HVAC calls after hours`,
  (c: string) => `Quick question for ${c} about after-hours coverage`,
  (c: string) => `${c} - calls that go to voicemail during emergencies`,
  (c: string) => `${c} - one thing that costs HVAC companies jobs every week`,
];

function buildHvacEmailEN(company: string, demo: string, calendar: string): string {
  return `Hi,

Quick question: when a customer calls ${company} at 11pm with a broken furnace and nobody picks up - where does that job go?

It goes to whoever answers first. Usually a competitor.

I am running a pilot for HVAC companies this week: the first 3 businesses get full setup at no cost. You only pay once the agent actually handles a call - not before.

Here is how it works: your after-hours line forwards to an AI voice agent. It answers live (not a recording), confirms the emergency, gives an estimated arrival window, and texts a job summary to your on-call tech. Your team wakes up with full context - the customer feels taken care of.

Setup takes 3 days. Call forwarding only - no hardware, nothing new for your staff.

You can hear the agent live right now: dial ${demo}.

If it sounds useful, I have two slots open this week: ${calendar}

- Kirill D.
AI Voice Automation for Trades and Service Companies
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;
}

function buildHvacCallScript(company: string, demo: string): string {
  return `COLD CALL SCRIPT - HVAC EMERGENCY/AFTER-HOURS INTENT

Target: HVAC companies showing emergency/after-hours language in their copy or reviews.

Opening (when someone picks up):
"Hi, is this [owner name] or the manager? I am calling from LaunchSoloAI - I work with HVAC companies in Calgary on after-hours call coverage. Do you have 90 seconds?"

If yes:
"I will be fast. We set up an AI voice agent on your after-hours line - it answers live at 2am, confirms the emergency, gives an arrival window, and texts your on-call tech. No recordings, no lost jobs.

This week I am offering free setup to the first 3 HVAC companies - you only pay once the agent actually handles a call, not before.

Can I send you a 2-minute demo? You can literally call a number right now and hear it live. It is ${demo}.

Would you be open to a 15-minute call this week to see if it fits ${company}?"

If they ask about price:
"Setup is free for the pilot. After that it is a flat monthly fee - around $300-400 CAD depending on call volume. If the agent handles 3-4 emergency calls in a month, it pays for itself from one job alone."

If they say they already have voicemail:
"Voicemail is a dead end at 2am - the customer does not wait until morning, they call whoever answers next. This agent answers live, handles the call, and gets the job locked in tonight."

Objection - no time:
"I just need 15 minutes on a video call. You can hear the agent live before that at ${demo} - takes 2 minutes."

Close:
"What does your week look like? I have Tuesday and Thursday afternoons open."`;
}

function buildHvacSms(company: string, demo: string): string {
  return `${company} - HVAC calls going unanswered after hours? AI agent answers live, first 3 setups free. Hear it: ${demo}. Worth 15 min?`;
}

const HVAC_INTENT_SIGNALS = [
  "Website copy mentions 24/7 or emergency service but calls go to voicemail after 6pm",
  "Google Business profile shows 'On-call' or 'Emergency available' with no live answer number",
  "Reviews mention 'called after hours and left a message' or 'hard to reach at night'",
  "Facebook/Nextdoor posts: 'furnace broke tonight, who can I call?' - business tagged but no response",
  "No answering service, virtual receptionist, or after-hours line visible on website",
  "Yelp or Google shows gaps in 5-star reviews - lower rating often from missed urgent calls",
  "Job board listings for 'on-call HVAC tech' - means they have demand but no coverage system",
];

const HVAC_SEARCH_QUERIES = [
  "Calgary HVAC emergency 24/7 contact",
  "Calgary furnace repair after hours",
  "site:.ca HVAC Calgary emergency call now",
  "Alberta HVAC company on-call service",
  "Calgary heating cooling emergency repair",
  "HVAC Calgary reviews 'left a message'",
  "Calgary air conditioning emergency contact",
  "Alberta furnace breakdown emergency HVAC",
  "Calgary HVAC after hours answering service",
  "Edmonton HVAC missed calls after hours",
  "Airdrie OR Cochrane OR Okotoks HVAC no one answers",
  "site:reddit.com Calgary HVAC after hours calls",
  "site:facebook.com/groups plumber answering service",
  "site:facebook.com/groups med spa receptionist help",
  "site:reddit.com/r/smallbusiness answering service recommendations",
  "site:reddit.com/r/Entrepreneur missed calls local business",
  "site:reddit.com/r/HVAC answering service",
];

const COLD_CALL_CHECKLIST = [
  "Lead shows emergency/after-hours language on site or in reviews",
  "No live answering service mentioned (no 'press 1 for emergency')",
  "Business has Google reviews in last 90 days - still active",
  "Found owner or manager name via LinkedIn or Google Business",
  "Demo number ready: " + DEFAULT_DEMO,
  "Calendar link ready for booking: " + DEFAULT_CALENDAR,
  "Called between 9-11am or 2-4pm local time (avoid Mondays and Fridays)",
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

export default function HvacOfferPage() {
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [demo, setDemo] = useState(DEFAULT_DEMO);
  const [calendar, setCalendar] = useState(DEFAULT_CALENDAR);

  const subjects = HVAC_SUBJECT_TEMPLATES.map(fn => fn(company));
  const emailBody = buildHvacEmailEN(company, demo, calendar);
  const callScript = buildHvacCallScript(company, demo);
  const sms = buildHvacSms(company, demo);

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

      {/* Hero headline */}
      <div style={{ background: "#0c2340", border: "1px solid #1e4a7a", borderRadius: 10, padding: "24px 28px", marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#f0f9ff", marginBottom: 10, lineHeight: 1.3 }}>
          We answer your missed HVAC calls tonight - setup free.
        </h1>
        <p style={{ fontSize: 14, color: "#7dd3fc", marginBottom: 12 }}>
          First 3 HVAC businesses: full setup at no cost. You pay only once the agent handles a call.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>No hardware</span>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>Call forwarding only</span>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>3-day setup</span>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>Live answer - not a recording</span>
          <span style={{ background: "#1e3a5f", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bae6fd" }}>Pay only when calls handled</span>
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#94a3b8" }}>HVAC Offer - Same-Day Outreach Kit</h2>
      <p style={{ color: "#475569", fontSize: 13, marginBottom: 24 }}>
        Fill in company details, copy each section before sending or calling.
      </p>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>Company Name</label>
          <input style={inputStyle} value={company} onChange={e => setCompany(e.target.value)} placeholder="NorthStar Heating" />
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

      {/* (a) Subject lines */}
      <div style={sectionTitle}>(a) Email Subject Lines</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {subjects.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "8px 12px" }}>
            <span style={{ color: "#64748b", marginRight: 10, fontSize: 12 }}>{i + 1}.</span>
            <span style={{ flex: 1, fontSize: 13 }}>{s}</span>
            <CopyButton text={s} />
          </div>
        ))}
      </div>

      {/* (b) Email body */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>(b) Email Body - HVAC Free Pilot Offer</span>
        <CopyButton text={emailBody} />
      </div>
      <pre style={preStyle}>{emailBody}</pre>

      {/* (c) SMS */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>(c) SMS Variant</span>
        <CopyButton text={sms} />
      </div>
      <div style={{ ...preStyle, fontStyle: "normal" }}>
        {sms}
        <span style={{ color: "#475569", marginLeft: 8, fontSize: 11 }}>({sms.length} chars)</span>
      </div>

      {/* (d) Cold call script */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>(d) Cold Call Script - Same-Day</span>
        <CopyButton text={callScript} />
      </div>
      <pre style={preStyle}>{callScript}</pre>

      {/* (e) Cold call checklist */}
      <div style={sectionTitle}>(e) Pre-Call Checklist</div>
      <div style={{ background: "#0c2340", border: "1px solid #1e3a5f", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        {COLD_CALL_CHECKLIST.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
            <span style={{ color: "#f97316", fontSize: 14, marginTop: 1 }}>[ ]</span>
            <span style={{ fontSize: 13, color: "#cbd5e1" }}>{item}</span>
          </div>
        ))}
      </div>

      {/* (f) Lead intent signals */}
      <div style={sectionTitle}>(f) HVAC Emergency-Intent Signals - Who to Target</div>
      <div style={{ background: "#0c1a2e", border: "1px solid #1e3a5f", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Prioritize businesses showing any of these signals:
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {HVAC_INTENT_SIGNALS.map((s, i) => (
            <li key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>{s}</li>
          ))}
        </ul>
      </div>

      {/* (g) Search queries */}
      <div style={sectionTitle}>(g) Google/Maps Lead-Finding Queries</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {HVAC_SEARCH_QUERIES.map((q, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "7px 12px" }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: "monospace", color: "#7dd3fc" }}>{q}</span>
            <CopyButton text={q} />
          </div>
        ))}
      </div>

      {/* Offer reminder */}
      <div style={{ background: "#1a1200", border: "1px solid #78350f", borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>PILOT OFFER - USE THIS FRAMING ONLY</div>
        <div style={{ fontSize: 13, color: "#fef3c7" }}>
          "First 3 HVAC businesses this week: setup is free. You pay only once the agent actually handles a call - not before, not upfront."
        </div>
        <CopyButton text="First 3 HVAC businesses this week: setup is free. You pay only once the agent actually handles a call - not before, not upfront." />
      </div>

    </div>
  );
}
