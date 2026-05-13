"use client";

const MAILTO_CTA =
  "mailto:kirill@launchsoloai.com?subject=RCIC%20Workflow%20Review";

const PAIN_ITEMS = [
  {
    title: "IRCC form version changes break your document checklists mid-case",
    detail:
      "IRCC updates form versions with short notice. Your checklist for an active file becomes outdated overnight. Staff cross-references the old checklist against the new requirements by hand, finds the gaps, and updates the tracker - one file at a time. On a 15-case practice that rework surfaces 3-4 times per year per affected stream.",
  },
  {
    title: "Excel and email tracking breaks down at 15+ active cases",
    detail:
      "Below 10 files a shared spreadsheet and inbox folder work. Above 15 they break. Which client sent their police certificate last week? Which file is waiting on the employer letter? Who got the status update on Monday? Staff spend the first 30-40 minutes of every morning reconstructing the current state of each case before any new work can begin.",
  },
  {
    title: "Staff spend 40% of time on intake admin instead of billable consultation",
    detail:
      "Intake means collecting documents, logging what arrived, flagging what is missing, chasing the client, updating the checklist, and filing correctly. On a 20-case practice with two staff members, roughly 16 hours per week - 40% of a full-time role - goes to this cycle before a single minute of substantive case work or client consultation.",
  },
];

const SOLUTION_ITEMS = [
  "Automated intake forms that adapt to IRCC updates - when IRCC revises a form version, the intake checklist updates automatically for all active files in the affected stream",
  "Document checklist automation that reads incoming files, identifies document type, maps to the correct checklist item, and flags gaps - no manual logging required",
  "Case status dashboard showing every active file: current stage, missing documents, last action date, and next required step - one view replaces the morning spreadsheet review",
];

const TRUST_ITEMS = [
  "Built workflow automation for Parliament of Canada - document accuracy and audit trails are baseline requirements, not afterthoughts",
  "Specializes in regulated-industry service firms where a missed document or wrong form version has professional consequences",
  "Based in Calgary, working with Canadian regulated professionals - immigration, legal, and financial services",
  "Custom-built systems, not generic SaaS - the workflow fits your existing practice structure",
];

export default function RcicPage() {
  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: "#7dd3fc",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    margin: "28px 0 12px",
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
          background: "#0c2340",
          border: "1px solid #1e4a7a",
          borderRadius: 10,
          padding: "28px 28px",
          marginBottom: 28,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#7dd3fc",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 10,
          }}
        >
          AI Workflow Automation - Licensed Canadian RCICs
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: "#f0f9ff",
            marginBottom: 12,
            lineHeight: 1.3,
          }}
        >
          Stop losing 4 hours per case to manual intake and document tracking.
        </h1>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "#7dd3fc",
            marginBottom: 16,
            lineHeight: 1.4,
          }}
        >
          AI workflow automation built specifically for licensed Canadian RCICs.
        </div>
        <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 20, lineHeight: 1.7 }}>
          Every case requires intake, document collection, checklist tracking,
          status updates, and compliance verification. At 15+ active files none
          of that fits in a spreadsheet anymore - and IRCC form changes make it
          worse. The administrative load compounds until it crowds out the
          consultation work you were licensed to do.
        </p>
        <a
          href={MAILTO_CTA}
          style={{
            display: "inline-block",
            background: "#1d4ed8",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            padding: "12px 28px",
            borderRadius: 8,
            textDecoration: "none",
            letterSpacing: "0.01em",
          }}
        >
          Book a free 30-min workflow review
        </a>
        <div style={{ marginTop: 12, fontSize: 13, color: "#475569" }}>
          I will show you exactly where your hours are going.
        </div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            "IRCC-aware intake forms",
            "Document checklist automation",
            "Case status dashboard",
            "Compliance gap detection",
          ].map((tag) => (
            <span
              key={tag}
              style={{
                background: "#1e3a5f",
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 12,
                color: "#bae6fd",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Pain section */}
      <div style={sectionTitle}>Where the hours actually go</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {PAIN_ITEMS.map((p, i) => (
          <div
            key={i}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#f8fafc",
                marginBottom: 8,
              }}
            >
              {p.title}
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              {p.detail}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          background: "#0f1f0f",
          border: "1px solid #166534",
          borderRadius: 8,
          padding: "12px 16px",
          marginTop: 12,
        }}
      >
        <div style={{ fontSize: 13, color: "#4ade80", fontWeight: 700 }}>
          Combined: 4+ hours per case in admin overhead before billable work begins.
        </div>
        <div style={{ fontSize: 12, color: "#86efac", marginTop: 4 }}>
          That figure compounds as case volume grows. At 20 active files it is the majority of every working day.
        </div>
      </div>

      {/* Solution section */}
      <div style={sectionTitle}>What the workflow replaces it with</div>
      <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12, lineHeight: 1.6 }}>
        A custom AI pipeline built around your application streams and document
        types. Not a generic CRM. A system that removes the manual work from
        your existing process without requiring new software your staff has to
        learn.
      </p>
      <div
        style={{
          background: "#0c1a2e",
          border: "1px solid #1e3a5f",
          borderRadius: 8,
          padding: "14px 16px",
          marginBottom: 12,
        }}
      >
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {SOLUTION_ITEMS.map((item, i) => (
            <li key={i} style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div
        style={{
          background: "#0c2340",
          border: "1px solid #1e4a7a",
          borderRadius: 8,
          padding: "14px 16px",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "#bae6fd", marginBottom: 6 }}>
          The result: your morning case review takes 20 minutes instead of half the day.
        </div>
        <div style={{ fontSize: 13, color: "#7dd3fc", lineHeight: 1.6 }}>
          One dashboard. Every file shows current status, pending documents,
          compliance flags, and a draft status email ready to review and send.
          The system processed it overnight. You review and approve.
        </div>
      </div>

      {/* Trust / credibility */}
      <div style={sectionTitle}>Who builds this</div>
      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: "16px 16px",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", marginBottom: 8 }}>
          Kirill D. - LaunchSoloAI, Calgary AB
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {TRUST_ITEMS.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span
                style={{ color: "#7dd3fc", fontSize: 13, flexShrink: 0, marginTop: 2 }}
              >
                -
              </span>
              <span style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
                {item}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA block */}
      <div
        style={{
          background: "#0c2340",
          border: "1px solid #1e4a7a",
          borderRadius: 10,
          padding: "24px 24px",
          marginTop: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#f0f9ff", marginBottom: 8 }}>
          Book a free 30-min workflow review.
        </div>
        <div style={{ fontSize: 13, color: "#7dd3fc", marginBottom: 20, lineHeight: 1.6 }}>
          I will show you exactly where your hours are going - intake, checklist
          tracking, status updates, compliance checks. You leave with a
          specific list of what can be automated and what it would take.
        </div>
        <a
          href={MAILTO_CTA}
          style={{
            display: "inline-block",
            background: "#1d4ed8",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            padding: "12px 32px",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Book the 30-min review
        </a>
        <div style={{ marginTop: 16, fontSize: 12, color: "#475569" }}>
          Kirill D. - LaunchSoloAI - Calgary, AB - kirill@launchsoloai.com
        </div>
      </div>
    </div>
  );
}
