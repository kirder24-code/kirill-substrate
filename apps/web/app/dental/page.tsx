"use client";

import { useState } from "react";

const DEFAULT_COMPANY = "[ClinicName]";
const DEFAULT_DEMO = "(856) 556-8035";
const DEFAULT_CALENDAR = "https://cal.com/kirill-d";

type TriggerKey = "booking_no_afterhours" | "no_emergency" | "no_sms" | "all_three";

const TRIGGER_LABELS: Record<TriggerKey, string> = {
  booking_no_afterhours: "Online booking present - no after-hours call handling",
  no_emergency: "No emergency instruction visible on site",
  no_sms: "No SMS/text option anywhere on site",
  all_three: "All three gaps found",
};

const TRIGGER_OPENERS: Record<TriggerKey, (c: string) => string> = {
  booking_no_afterhours: (c) =>
    `I just checked ${c}'s website. You have online booking - which is great. But when a patient tries to call after hours with a tooth emergency, there is no live option, no forwarding instruction, and no SMS. They leave a voicemail or give up.`,
  no_emergency: (c) =>
    `I just checked ${c}'s website. There is no emergency instruction anywhere. A patient with a broken tooth at 8pm has no idea what to do next. No call-back number, no after-hours line, nothing.`,
  no_sms: (c) =>
    `I just checked ${c}'s website. There is no SMS or text option. Most dental patients under 40 will not call - they text. Right now those patients go silent or find a clinic that answers.`,
  all_three: (c) =>
    `I just checked ${c}'s website. Three gaps in one: online booking exists but no after-hours call handling, no emergency instruction, and no SMS option. Each one loses patients on its own. Together they add up fast.`,
};

const DENTAL_SUBJECT_TEMPLATES = [
  (c: string) => `${c} - quick question about your after-hours call handling`,
  (c: string) => `${c} - I checked your site and found something`,
  (c: string) => `${c} - patients calling after hours have nowhere to go`,
  (c: string) => `${c} - missed dental call audit (free, 24hr turnaround)`,
  (c: string) => `${c} - your online booking is on, but calls after 5pm are not`,
];

function buildDentalEmailEN(
  company: string,
  trigger: TriggerKey,
  demo: string,
  calendar: string
): string {
  const opener = TRIGGER_OPENERS[trigger](company);
  return `Hi,

${opener}

Here is what I am offering: a free Missed-Call Recovery Audit for ${company}. I will map your current call flow, identify exactly where patients drop off after hours, and send you a custom call-flow fix with an ROI estimate - what it is likely costing you per month in lost emergency appointments.

The audit takes 24 hours. No commitment, no sales call required to get it.

If the fix makes sense, I can implement a custom after-hours call flow for ${company} - patients hear a live prompt, get an emergency option, can send an SMS, and your front desk wakes up with a full summary of overnight contacts.

You can hear what that sounds like right now: dial ${demo}.

If you want the audit, just reply "yes" and I will start today.
If you want to talk through it first: ${calendar}

- Kirill D.
AI Workflow Automation - Calgary Dental Clinics
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;
}

function buildDentalCallScript(company: string, trigger: TriggerKey, demo: string): string {
  const openerLine =
    trigger === "booking_no_afterhours"
      ? `You have online booking - great. But when a patient calls after 5pm with a dental emergency, there is no live option and no forwarding. That patient goes somewhere else.`
      : trigger === "no_emergency"
      ? `I looked at your site this morning - there is no emergency instruction anywhere. A patient with a broken tooth at 7pm has no idea what to do next.`
      : trigger === "no_sms"
      ? `Your site has no SMS option. Most patients under 40 will not call at all - they text. Right now those contacts are going silent.`
      : `Your site has three gaps at once: no after-hours call handling, no emergency instruction, and no SMS. Each one costs you patients.`;

  return `COLD CALL SCRIPT - CALGARY DENTAL CLINICS / MISSED-CALL RECOVERY AUDIT

Target: Dental clinics with online booking but no after-hours call handling, no emergency instruction, or no SMS option.

Opening:
"Hi, is this the practice manager or Dr. [Name]? I am calling from LaunchSoloAI - I work with Calgary dental clinics on missed-call recovery. Do you have 90 seconds?"

If yes:
"I checked ${company}'s website this morning. ${openerLine}

I offer a free 24-hour audit - I map your current call flow, find where patients drop off after hours, and send you a custom fix with an ROI estimate. No commitment to get it.

If it makes sense to implement, setup takes 3 days. Patients get a live prompt, emergency option, and SMS - your front desk gets a morning summary of overnight contacts.

You can hear what it sounds like right now at ${demo} - takes 2 minutes.

Want me to run the free audit for ${company} today?"

If they ask what the audit costs:
"Nothing. I send you the call-flow map and ROI estimate for free. If you want it implemented, that is a separate conversation."

If they say they already have voicemail:
"Voicemail is a dead end after 5pm - patients with tooth pain do not wait until morning, they call whoever answers. This is a full call-flow replacement, not voicemail."

If they ask about price for implementation:
"Flat monthly fee, around $350-500 CAD depending on call volume. If the flow captures 3-4 missed emergency appointments in a month, one filling pays for the whole year."

Objection - no time:
"The audit is 24 hours, I do all the work. You just say yes and I start."

Close:
"Can I run the audit today and send you results tomorrow morning?"`;
}

function buildDentalSms(company: string, trigger: TriggerKey): string {
  const triggerShort =
    trigger === "booking_no_afterhours"
      ? "online booking but no after-hours call option"
      : trigger === "no_emergency"
      ? "no emergency instructions visible"
      : trigger === "no_sms"
      ? "no SMS option for patients"
      : "3 call-flow gaps found";
  return `${company} - noticed ${triggerShort} on your site. Free missed-call audit: I map your flow + send ROI estimate in 24hr. Reply "yes" to start. - Kirill`;
}

function buildRoiEstimate(company: string): string {
  return `MISSED-CALL ROI ESTIMATE - TEMPLATE FOR ${company.toUpperCase()}

--- Fill in actual numbers from Google Business profile or ask on first call ---

Avg new patient value (lifetime):   $1,200 - $2,500 CAD
Avg emergency visit value:           $350 - $900 CAD
Estimated missed after-hours calls:  4 - 8 per month (conservative)
Patient conversion rate from call:   40 - 60%

--- Conservative case ---
4 missed calls/month x 50% conversion x $500 avg value = $1,000 CAD/month lost
Annual: ~$12,000 CAD

--- Realistic case ---
6 missed calls/month x 50% conversion x $800 avg value = $2,400 CAD/month lost
Annual: ~$28,800 CAD

--- Cost of fix ---
Call flow implementation: $350 - $500 CAD/month flat

--- Payback ---
1 recovered emergency appointment = 1 month of service paid for.

NOTE: Present this as an estimate, not a guarantee. Ask the clinic to verify their own call volume from their phone system or Google Business insights.`;
}

const DENTAL_INTENT_SIGNALS = [
  "Online booking widget present (Dentrix, Jane, Booksy) - but no phone coverage after 5pm",
  "Website says 'call us' for emergencies but no after-hours line, forwarding, or on-call option",
  "No SMS, text, or chat option anywhere on the site",
  "Google Business shows 'Closed' outside 9-5 with no emergency number",
  "Reviews mention 'called after hours and got voicemail' or 'wish they had emergency line'",
  "Facebook posts: 'toothache tonight, any Calgary dentist available?' - clinic tagged, no reply",
  "Yelp or Google reviews show pattern: rating drops on weekends (missed urgent contacts)",
  "Site has a generic contact form but no real-time response path",
  "No visible call-to-action for after-hours patients on homepage or contact page",
];

const WEBSITE_TRIGGER_CHECKLIST = [
  {
    label: "Online booking present (Jane App, Dentrix, Booker, etc.)",
    trigger: "Check header/nav and 'Book Appointment' button. If booking exists, note it.",
  },
  {
    label: "After-hours call handling visible",
    trigger:
      "Look for: 'After hours call X', emergency phone number, call-forwarding note. If NONE = trigger found.",
  },
  {
    label: "Emergency instruction on homepage or contact page",
    trigger:
      "Search for: 'dental emergency', '24 hour', 'after hours', 'urgent care'. If NONE = trigger found.",
  },
  {
    label: "SMS or text option",
    trigger:
      "Look for: 'text us', SMS widget, WhatsApp button, or any phone number with 'text' option. If NONE = trigger found.",
  },
  {
    label: "Google Business hours check",
    trigger:
      "Search clinic name on Google. If hours show 'Closed' evenings/weekends with no emergency note = confirm gap.",
  },
  {
    label: "Review scan (last 90 days)",
    trigger:
      "Filter Google/Yelp reviews for 'voicemail', 'no answer', 'hard to reach', 'after hours'. Any match = strong trigger.",
  },
];

const DENTAL_SEARCH_QUERIES = [
  '"Calgary dental clinic" "book online" site:.ca',
  "Calgary dentist emergency hours site:.ca",
  '"Calgary dental" "after hours" OR "emergency" OR "urgent"',
  "site:google.com/maps Calgary dental clinic reviews",
  "Calgary dentist 'no one answered' OR 'left a message' OR 'voicemail'",
  '"book appointment" Calgary dental -24hr -emergency',
  "site:yelp.com Calgary dentist \"couldn't reach\" OR \"no callback\"",
  "Calgary SE OR NW OR SW OR NE dentist online booking",
  '"dental emergency Calgary" reviews 2024 OR 2025',
  "site:facebook.com/groups Calgary toothache emergency tonight",
  "Google Maps: Calgary dental - filter by 'open now' gap on evenings",
];

const COLD_CALL_CHECKLIST = [
  "Checked clinic website - confirmed at least one trigger (booking/no-afterhours, no emergency, no SMS)",
  "Noted which trigger was found - use specific opener, not generic",
  "Checked Google reviews for 'voicemail' or 'no answer' patterns in last 90 days",
  "Clinic has Google profile with recent reviews - still active",
  "Found practice manager or dentist name via Google Business or LinkedIn",
  "Demo number ready: " + DEFAULT_DEMO,
  "Calendar link ready: " + DEFAULT_CALENDAR,
  "Calling between 9-11am or 2-4pm Calgary time (avoid Monday mornings and Fridays)",
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
        background: copied ? "#0d9488" : "#334155",
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

export default function DentalOfferPage() {
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [trigger, setTrigger] = useState<TriggerKey>("booking_no_afterhours");
  const [demo, setDemo] = useState(DEFAULT_DEMO);
  const [calendar, setCalendar] = useState(DEFAULT_CALENDAR);

  const subjects = DENTAL_SUBJECT_TEMPLATES.map((fn) => fn(company));
  const emailBody = buildDentalEmailEN(company, trigger, demo, calendar);
  const callScript = buildDentalCallScript(company, trigger, demo);
  const sms = buildDentalSms(company, trigger);
  const roi = buildRoiEstimate(company);

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #134e4a",
    background: "#0f172a",
    color: "#e2e8f0",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
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
    color: "#2dd4bf",
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
    <div
      style={{
        maxWidth: 780,
        margin: "0 auto",
        padding: "32px 20px",
        fontFamily: "monospace",
        color: "#e2e8f0",
        background: "#0f172a",
        minHeight: "100vh",
      }}
    >
      {/* Hero */}
      <div
        style={{
          background: "#042f2e",
          border: "1px solid #0f766e",
          borderRadius: 10,
          padding: "24px 28px",
          marginBottom: 28,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#0d9488",
            letterSpacing: "0.1em",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          24-Hour Sprint - Calgary Dental Clinics Only
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: "#f0fdfa",
            marginBottom: 10,
            lineHeight: 1.3,
          }}
        >
          Missed-Call Recovery Audit - custom call-flow + ROI estimate in 24hr.
        </h1>
        <p style={{ fontSize: 14, color: "#5eead4", marginBottom: 12 }}>
          Trigger: online booking present but no after-hours call handling, no emergency instruction,
          or no SMS option. Offer the audit first - not the product.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {[
            "Site-specific trigger required",
            "Audit delivered in 24hr",
            "Custom call-flow map",
            "ROI estimate included",
            "No generic AI pitch",
          ].map((tag) => (
            <span
              key={tag}
              style={{
                background: "#0f3d3a",
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 12,
                color: "#99f6e4",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#94a3b8" }}>
        Calgary Dental ICP Sprint - 24-Hour Outreach Kit
      </h2>
      <p style={{ color: "#475569", fontSize: 13, marginBottom: 24 }}>
        Check clinic website first. Select the trigger you found. Copy outreach with that specific
        hook - not generic copy.
      </p>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Clinic Name</label>
          <input
            style={inputStyle}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Sunridge Dental"
          />
        </div>
        <div>
          <label style={labelStyle}>Trigger Found on Website</label>
          <select
            style={selectStyle}
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as TriggerKey)}
          >
            {(Object.keys(TRIGGER_LABELS) as TriggerKey[]).map((k) => (
              <option key={k} value={k}>
                {TRIGGER_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>Demo Number</label>
          <input
            style={inputStyle}
            value={demo}
            onChange={(e) => setDemo(e.target.value)}
            placeholder="(856) 556-8035"
          />
        </div>
        <div>
          <label style={labelStyle}>Calendar Link</label>
          <input
            style={inputStyle}
            value={calendar}
            onChange={(e) => setCalendar(e.target.value)}
            placeholder="https://cal.com/kirill-d"
          />
        </div>
      </div>

      {/* (a) Subject lines */}
      <div style={sectionTitle}>(a) Email Subject Lines</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {subjects.map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              background: "#1e293b",
              borderRadius: 6,
              padding: "8px 12px",
            }}
          >
            <span style={{ color: "#64748b", marginRight: 10, fontSize: 12 }}>{i + 1}.</span>
            <span style={{ flex: 1, fontSize: 13 }}>{s}</span>
            <CopyButton text={s} />
          </div>
        ))}
      </div>

      {/* (b) Email body */}
      <div
        style={{
          ...sectionTitle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>(b) Email Body - Audit Offer (trigger-specific)</span>
        <CopyButton text={emailBody} />
      </div>
      <pre style={preStyle}>{emailBody}</pre>

      {/* (c) SMS */}
      <div
        style={{
          ...sectionTitle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>(c) SMS Variant</span>
        <CopyButton text={sms} />
      </div>
      <div style={{ ...preStyle }}>
        {sms}
        <span style={{ color: "#475569", marginLeft: 8, fontSize: 11 }}>({sms.length} chars)</span>
      </div>

      {/* (d) Cold call script */}
      <div
        style={{
          ...sectionTitle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>(d) Cold Call Script - Trigger-Specific Opener</span>
        <CopyButton text={callScript} />
      </div>
      <pre style={preStyle}>{callScript}</pre>

      {/* (e) ROI estimate */}
      <div
        style={{
          ...sectionTitle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>(e) ROI Estimate Template - Send After Audit</span>
        <CopyButton text={roi} />
      </div>
      <pre style={preStyle}>{roi}</pre>

      {/* (f) Website trigger checklist */}
      <div style={sectionTitle}>(f) Website Trigger Checklist - Run Before Any Outreach</div>
      <div
        style={{
          background: "#042f2e",
          border: "1px solid #0f766e",
          borderRadius: 8,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 12, color: "#5eead4", marginBottom: 12, fontWeight: 600 }}>
          Check clinic website. Each row = one trigger. If ANY row says "NONE" - that is your
          specific opening hook.
        </div>
        {WEBSITE_TRIGGER_CHECKLIST.map((item, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ color: "#f97316", fontSize: 14, marginTop: 1, flexShrink: 0 }}>
                [ ]
              </span>
              <div>
                <div style={{ fontSize: 13, color: "#f0fdfa", fontWeight: 600 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{item.trigger}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* (g) Pre-call checklist */}
      <div style={sectionTitle}>(g) Pre-Call Checklist</div>
      <div
        style={{
          background: "#1a2a2a",
          border: "1px solid #134e4a",
          borderRadius: 8,
          padding: 14,
          marginBottom: 16,
        }}
      >
        {COLD_CALL_CHECKLIST.map((item, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}
          >
            <span style={{ color: "#f97316", fontSize: 14, marginTop: 1 }}>[ ]</span>
            <span style={{ fontSize: 13, color: "#cbd5e1" }}>{item}</span>
          </div>
        ))}
      </div>

      {/* (h) Intent signals */}
      <div style={sectionTitle}>(h) Dental Intent Signals - Who to Prioritize</div>
      <div
        style={{
          background: "#0b1e1e",
          border: "1px solid #134e4a",
          borderRadius: 8,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Prioritize clinics showing any of these - each one is a site-confirmed gap, not a guess:
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {DENTAL_INTENT_SIGNALS.map((s, i) => (
            <li key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* (i) Search queries */}
      <div style={sectionTitle}>(i) Google/Maps Lead-Finding Queries - Calgary Dental</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {DENTAL_SEARCH_QUERIES.map((q, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              background: "#1e293b",
              borderRadius: 6,
              padding: "7px 12px",
            }}
          >
            <span
              style={{ flex: 1, fontSize: 13, fontFamily: "monospace", color: "#2dd4bf" }}
            >
              {q}
            </span>
            <CopyButton text={q} />
          </div>
        ))}
      </div>

      {/* Offer reminder */}
      <div style={{ background: "#1a1200", border: "1px solid #78350f", borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>
          AUDIT FRAMING - LEAD WITH THIS, NOT THE PRODUCT
        </div>
        <div style={{ fontSize: 13, color: "#fef3c7", marginBottom: 10 }}>
          "Free Missed-Call Recovery Audit for your clinic. I check your current call flow, find
          where after-hours patients drop off, and send you a custom fix + ROI estimate in 24
          hours. No commitment. Reply yes to start."
        </div>
        <CopyButton text="Free Missed-Call Recovery Audit for your clinic. I check your current call flow, find where after-hours patients drop off, and send you a custom fix + ROI estimate in 24 hours. No commitment. Reply yes to start." />
      </div>
    </div>
  );
}
