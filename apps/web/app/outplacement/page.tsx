"use client";

const DELIVERABLES = [
  {
    title: "Automated intake form + routing",
    detail:
      "Candidates submit one structured form. Responses are scored, tagged by stage, and routed to the right coordinator automatically. No inbox sorting, no copy-paste into spreadsheets.",
  },
  {
    title: "Candidate status dashboard with auto-notifications",
    detail:
      "Every candidate's stage is tracked in real time. When status changes - job offer submitted, coach session completed, placement confirmed - the candidate and coordinator both get an automated update. No manual follow-up required.",
  },
  {
    title: "Bulk email sequences by stage",
    detail:
      "Pre-written email sequences trigger automatically based on where each candidate is in the program. Week 1 onboarding, mid-program check-in, placement milestone - sent without touching a single email client.",
  },
];

const PROBLEM_POINTS = [
  {
    label: "60-70% of coordinator time goes to status tracking",
    detail:
      "Most outplacement teams run on spreadsheets and shared inboxes. Every status update is manual: pull the row, check the notes, send an email, update the cell. On a 30-person cohort this is 15-20 hours per week of pure overhead.",
  },
  {
    label: "Bulk communication is done one email at a time",
    detail:
      "Stage-based check-ins, document reminders, and placement confirmations get drafted and sent individually. A coordinator running 40 active candidates spends 6-8 hours per week on emails that follow an identical pattern every time.",
  },
  {
    label: "Document sorting has no consistent triage",
    detail:
      "Resumes, cover letters, references, and offer letters arrive by email, form, and shared drive with no standard routing. Coordinators spend time finding, sorting, and forwarding files before any actual coaching work begins.",
  },
];

export default function OutplacementPage() {
  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: "#7dd3fc",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    margin: "32px 0 12px",
  };

  return (
    <div
      style={{
        maxWidth: 680,
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
          padding: "28px 24px",
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
          AI Workflow Automation - Outplacement Firms and HR Directors - Canada
        </div>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#f0f9ff",
            marginBottom: 14,
            lineHeight: 1.35,
          }}
        >
          Cut outplacement admin by 60% - so your team focuses on people, not paperwork.
        </h1>
        <p style={{ fontSize: 15, color: "#bae6fd", marginBottom: 22, lineHeight: 1.65 }}>
          AI workflows built for outplacement coordinators. Automate the status tracking, bulk
          emails, and document sorting that consume your team's day - and let them handle 3x the
          caseload without adding headcount.
        </p>
        <a
          href="https://cal.com/kirill-d"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            background: "#1d4ed8",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            padding: "12px 28px",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Book a 20-min call with Kirill
        </a>
      </div>

      {/* Section 1: The Problem */}
      <div style={sectionTitle}>The Problem</div>
      <p
        style={{
          fontSize: 14,
          color: "#94a3b8",
          marginBottom: 14,
          lineHeight: 1.65,
        }}
      >
        HR and outplacement teams spend 60-70% of their program time on administration - not
        coaching. Status tracking, bulk emails, and document sorting are necessary, but none of
        them require a human every time they happen.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {PROBLEM_POINTS.map((p, i) => (
          <div
            key={i}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", marginBottom: 5 }}>
              {p.label}
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{p.detail}</div>
          </div>
        ))}
      </div>

      {/* Section 2: The Solution */}
      <div style={sectionTitle}>The Solution</div>
      <div
        style={{
          background: "#0f1f0f",
          border: "1px solid #166534",
          borderRadius: 8,
          padding: "18px 16px",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#86efac", marginBottom: 12 }}>
          AI workflows that run the admin layer automatically
        </div>
        <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.65, marginBottom: 14 }}>
          I build targeted automation for outplacement programs: candidate status updates trigger
          without a coordinator touching them, resume screening triage follows a consistent
          process, and bulk communication goes out by stage without manual drafting. Coordinators
          stay in the workflow - they just stop doing the parts that do not require judgment.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "Coordinators handle 3x the caseload at the same staffing level",
            "Status updates and notifications happen in real time, without reminders",
            "Resume triage follows a consistent rubric - not coordinator feel",
            "Bulk emails go out by stage automatically, not one at a time",
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ color: "#4ade80", fontSize: 13, flexShrink: 0, marginTop: 2 }}>
                -
              </span>
              <span style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Section 3: What You Get */}
      <div style={sectionTitle}>What You Get</div>
      <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14, lineHeight: 1.6 }}>
        Three specific deliverables, built and handed off in two weeks:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {DELIVERABLES.map((d, i) => (
          <div
            key={i}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "16px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  background: "#1d4ed8",
                  color: "#bfdbfe",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 4,
                  padding: "2px 8px",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>{d.title}</div>
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{d.detail}</div>
          </div>
        ))}
      </div>

      {/* Section 4: Pricing */}
      <div style={sectionTitle}>Pricing</div>
      <div
        style={{
          background: "#0c2340",
          border: "1px solid #1e4a7a",
          borderRadius: 8,
          padding: "18px 16px",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, color: "#f0f9ff", marginBottom: 6 }}>
          Starting at $1,500 CAD
        </div>
        <div style={{ fontSize: 13, color: "#7dd3fc", marginBottom: 14 }}>
          2-week build - all three deliverables included
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            "Scoped to your existing program structure - no platform replacement required",
            "Built on tools your team already has access to (or low-cost equivalents)",
            "Handed off with documentation so your coordinators can run it independently",
            "Follow-on support available if scope expands",
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ color: "#7dd3fc", fontSize: 13, flexShrink: 0, marginTop: 2 }}>
                -
              </span>
              <span style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Section 5: CTA */}
      <div
        style={{
          background: "#0c2340",
          border: "1px solid #1e4a7a",
          borderRadius: 10,
          padding: "28px 24px",
          marginTop: 36,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "#f0f9ff", marginBottom: 10 }}>
          Book a 20-min call with Kirill
        </div>
        <div style={{ fontSize: 13, color: "#7dd3fc", marginBottom: 22, lineHeight: 1.65 }}>
          Walk me through your current program setup. I will identify the two or three manual
          steps consuming the most coordinator time and show you exactly how automation removes
          them. No commitment, no pitch deck.
        </div>
        <a
          href="https://cal.com/kirill-d"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            background: "#1d4ed8",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            padding: "12px 36px",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Book a 20-min call with Kirill
        </a>
        <div style={{ marginTop: 16, fontSize: 12, color: "#475569" }}>
          Kirill D. - LaunchSoloAI - Calgary, AB - kirill@launchsoloai.com
        </div>
      </div>
    </div>
  );
}
