"use client";

import { useState } from "react";

const DEFAULT_COMPANY = "[ClinicName]";
const DEFAULT_DEMO = "(856) 556-8035";
const DEFAULT_CALENDAR = "https://cal.com/kirill-d";

const VET_SUBJECT_TEMPLATES = [
  (c: string) => `${c} - who triages your emergency calls at 2am?`,
  (c: string) => `${c} - after-hours calls going to voicemail`,
  (c: string) => `Quick question for ${c} about overnight call coverage`,
  (c: string) => `${c} - pet owners calling at night with nowhere to go`,
  (c: string) => `${c} - missed emergency calls cost clinics every week`,
];

function buildVetEmailEN(company: string, demo: string, calendar: string): string {
  return `Hi,

Quick question: when a pet owner calls ${company} at midnight with a sick animal and nobody picks up - where do they go?

They go to the ER vet across town. Or they panic and call whoever answers first. Either way, ${company} loses that relationship.

I am running a pilot for veterinary clinics this week: the first 3 practices get full setup at no cost. You only pay once the agent actually handles a call - not before.

Here is how it works: your after-hours line forwards to an AI voice agent. It answers live (not a recording), triages the situation, confirms whether it is a true emergency or can wait until morning, and texts a summary to your on-call staff. Pet owners feel heard. Your team gets context before they even call back.

Setup takes 3 days. Call forwarding only - no hardware, no new software for your staff.

You can hear the agent live right now: dial ${demo}.

If it sounds useful, I have two slots open this week: ${calendar}

- Kirill D.
AI Receptionist for Veterinary Clinics and Animal Hospitals
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;
}

function buildVetCallScript(company: string, demo: string): string {
  return `COLD CALL SCRIPT - VETERINARY AFTER-HOURS / OVERFLOW INTENT

Target: Vet clinics and animal hospitals showing emergency or after-hours language on their site or in reviews.

Opening (when someone picks up):
"Hi, is this the practice manager or owner? I am calling from LaunchSoloAI - I work with veterinary clinics on after-hours call coverage. Do you have 90 seconds?"

If yes:
"I will be fast. We set up an AI voice agent on your after-hours line - it answers live at 2am, triages whether it is a true emergency or can wait until morning, and texts your on-call vet a summary. No recordings, no lost clients.

This week I am offering free setup to the first 3 vet practices - you only pay once the agent actually handles a call, not before.

Can I send you a 2-minute demo? You can literally call a number right now and hear it live. It is ${demo}.

Would you be open to a 15-minute call this week to see if it fits ${company}?"

If they ask about price:
"Setup is free for the pilot. After that it is a flat monthly fee - around $300-400 CAD depending on call volume. If the agent handles 3-4 after-hours calls in a month and saves one emergency referral, it pays for itself."

If they say they already have an answering service:
"Most answering services take a message and stop there. This agent triages the situation, asks the right clinical screening questions, confirms whether the owner needs to drive to an ER tonight, and texts your team a full summary. It does not just take a name and number."

Objection - no time:
"I just need 15 minutes on a video call. You can hear the agent live before that at ${demo} - takes 2 minutes."

Close:
"What does your week look like? I have Tuesday and Thursday afternoons open."`;
}

function buildVetSms(company: string, demo: string): string {
  return `${company} - after-hours calls going unanswered? AI agent triages emergencies live, first 3 setups free. Hear it: ${demo}. Worth 15 min?`;
}

const VET_INTENT_SIGNALS = [
  "Website mentions emergency or after-hours care but calls go to voicemail outside office hours",
  "Google Business profile says 'Emergency appointments available' with no live answer line",
  "Reviews mention 'called at night and got voicemail' or 'wish they had 24-hour service'",
  "Site lists an emergency ER referral number instead of handling overflow directly",
  "Facebook community posts: 'my dog is sick tonight, who can I call?' - clinic tagged but no response",
  "No on-call number, answering service, or triage line visible on the website",
  "Google or Yelp reviews show pattern of missed urgent calls or difficulty reaching someone",
  "Job listings for 'emergency vet tech' or 'on-call receptionist' - demand exists, coverage gap visible",
];

const VET_SEARCH_QUERIES = [
  '"24/7 emergency vet" site:.com',
  '"after hours" "animal hospital" site:.com',
  '"call us immediately" veterinarian site:.com',
  '"if we miss your call" vet site:.com',
  '"emergency animal hospital" "leave a message" site:.com',
  '"after hours" "veterinary clinic" "call us" site:.com -yelp -yellowpages',
  '"on call" veterinarian "text us" OR "call back" site:.com',
  '"urgent care" "animal hospital" Calgary OR Alberta',
];

const COLD_CALL_CHECKLIST = [
  "Clinic shows emergency or after-hours language on site or in reviews",
  "No live answering service or triage line mentioned (no 'press 1 for emergencies')",
  "Clinic has Google reviews in last 90 days - still active",
  "Found practice manager or owner name via LinkedIn or Google Business",
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

export default function VetOfferPage() {
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [demo, setDemo] = useState(DEFAULT_DEMO);
  const [calendar, setCalendar] = useState(DEFAULT_CALENDAR);

  const subjects = VET_SUBJECT_TEMPLATES.map(fn => fn(company));
  const emailBody = buildVetEmailEN(company, demo, calendar);
  const callScript = buildVetCallScript(company, demo);
  const sms = buildVetSms(company, demo);

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
    color: "#86efac",
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
      <div style={{ background: "#0c2a1a", border: "1px solid #166534", borderRadius: 10, padding: "24px 28px", marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#f0fdf4", marginBottom: 10, lineHeight: 1.3 }}>
          We answer your missed vet calls tonight - setup free.
        </h1>
        <p style={{ fontSize: 14, color: "#86efac", marginBottom: 12 }}>
          First 3 veterinary practices: full setup at no cost. You pay only once the agent handles a call.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <span style={{ background: "#14532d", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bbf7d0" }}>No hardware</span>
          <span style={{ background: "#14532d", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bbf7d0" }}>Call forwarding only</span>
          <span style={{ background: "#14532d", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bbf7d0" }}>3-day setup</span>
          <span style={{ background: "#14532d", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bbf7d0" }}>Live triage - not a recording</span>
          <span style={{ background: "#14532d", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#bbf7d0" }}>Pay only when calls handled</span>
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#94a3b8" }}>Vet Clinic Offer - Same-Day Outreach Kit</h2>
      <p style={{ color: "#475569", fontSize: 13, marginBottom: 24 }}>
        Fill in clinic details, copy each section before sending or calling.
      </p>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>Clinic Name</label>
          <input style={inputStyle} value={company} onChange={e => setCompany(e.target.value)} placeholder="Riverside Animal Hospital" />
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
        <span>(b) Email Body - Vet Clinic Free Pilot Offer</span>
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
      <div style={{ background: "#0c2a1a", border: "1px solid #14532d", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        {COLD_CALL_CHECKLIST.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
            <span style={{ color: "#f97316", fontSize: 14, marginTop: 1 }}>[ ]</span>
            <span style={{ fontSize: 13, color: "#cbd5e1" }}>{item}</span>
          </div>
        ))}
      </div>

      {/* (f) Lead intent signals */}
      <div style={sectionTitle}>(f) Vet Emergency-Intent Signals - Who to Target</div>
      <div style={{ background: "#0b1e12", border: "1px solid #14532d", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Prioritize clinics showing any of these signals:
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {VET_INTENT_SIGNALS.map((s, i) => (
            <li key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>{s}</li>
          ))}
        </ul>
      </div>

      {/* (g) Search queries */}
      <div style={sectionTitle}>(g) Google/Maps Lead-Finding Queries</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {VET_SEARCH_QUERIES.map((q, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "7px 12px" }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: "monospace", color: "#86efac" }}>{q}</span>
            <CopyButton text={q} />
          </div>
        ))}
      </div>

      {/* Offer reminder */}
      <div style={{ background: "#1a1200", border: "1px solid #78350f", borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>PILOT OFFER - USE THIS FRAMING ONLY</div>
        <div style={{ fontSize: 13, color: "#fef3c7" }}>
          "First 3 vet clinics this week: setup is free. You pay only once the agent actually handles a call - not before, not upfront."
        </div>
        <CopyButton text="First 3 vet clinics this week: setup is free. You pay only once the agent actually handles a call - not before, not upfront." />
      </div>

    </div>
  );
}
