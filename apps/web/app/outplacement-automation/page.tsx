"use client";

const DELIVERABLES = [
  {
    title: "Automated candidate status emails",
    detail:
      "When a candidate's stage changes - resume submitted, interview scheduled, offer received - an email goes out automatically. The coordinator sets the trigger once. Status emails stop being a 3-hour weekly task and become a zero-touch background process.",
  },
  {
    title: "Employer follow-up sequences by placement milestone",
    detail:
      "When a placement is confirmed, a sequence starts: 30-day check-in request to the employer, 90-day satisfaction follow-up, renewal inquiry at program close. Each email goes out on schedule based on the placement date - no manual tracking required.",
  },
  {
    title: "Weekly reporting dashboard - no manual assembly",
    detail:
      "Placement rates, active candidates by stage, and employer response rates update automatically. The Friday report that takes 90 minutes to pull from three spreadsheets becomes a live dashboard the director opens directly. No export, no copy-paste, no formatting.",
  },
];

const PROBLEM_POINTS = [
  {
    label: "200 candidates tracked in spreadsheets means 200 manual status checks",
    detail:
      "Every row requires a human to open it, verify the stage, and decide whether a follow-up is needed. On a cohort of 200, that overhead compounds fast. Coordinators are not managing the program - they are managing the spreadsheet.",
  },
  {
    label: "Employer follow-up depends entirely on coordinator memory",
    detail:
      "Placement milestones trigger no automatic action. A coordinator has to remember that a placement happened 30 days ago, find the employer contact, draft an email, and send it. When caseloads are high, these follow-ups get missed - and retention data disappears with them.",
  },
  {
    label: "Weekly reports are assembled manually from multiple sources",
    detail:
      "Placement stats, active pipeline, employer feedback - each lives in a different file or inbox. Assembling the Friday report takes 60 to 90 minutes of coordinator time every single week. It is the same pull, the same format, every time.",
  },
];

export default function OutplacementAutomationPage() {
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
          AI Workflow Automation - Outplacement Firms - Canada
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
          Your coordinators are tracking 200 candidates in spreadsheets. Here is what you are losing.
        </h1>
        <p style={{ fontSize: 15, color: "#bae6fd", marginBottom: 22, lineHeight: 1.65 }}>
          Status emails, employer follow-ups, and weekly reports - three workflows that consume
          coordinator hours every week and require no human judgment to run. Automated and handed
          off in two weeks. Fixed price.
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
          Book a 30-min workflow audit
        </a>
      </div>

      {/* Before/After */}
      <div style={sectionTitle}>Before and After</div>
      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: "18px 16px",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" as const }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: "#ef4444", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Before
            </div>
            <div style={{ fontSize: 14, color: "#f8fafc", fontWeight: 700, marginBottom: 6 }}>
              3 hours/week on status emails
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              Coordinator opens each candidate row, checks last contact date, drafts an update,
              sends it. Repeated for every active candidate, every week.
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: "#4ade80", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              After
            </div>
            <div style={{ fontSize: 14, color: "#f8fafc", fontWeight: 700, marginBottom: 6 }}>
              0 hours/week on status emails
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              Stage change triggers email automatically. Coordinator is notified only when a
              candidate needs a human response - not to send a routine update.
            </div>
          </div>
        </div>
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
        Outplacement coordinators are not doing coordination work - they are doing data entry,
        email drafting, and report assembly. None of those tasks require a trained professional.
        All of them scale badly with caseload.
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

      {/* Section 2: What You Get */}
      <div style={sectionTitle}>What You Get</div>
      <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14, lineHeight: 1.6 }}>
        Three specific automations scoped to outplacement coordinator workflows - built and
        handed off within the first engagement:
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

      {/* Section 3: Pricing */}
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
          Fixed price - scoped to your program, delivered in two weeks
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            "Built on your existing tools - no platform replacement required",
            "Scoped to the workflows that consume the most coordinator hours",
            "SR&ED-eligible work may qualify for federal tax credits",
            "Handed off with documentation your team operates independently",
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

      {/* Section 4: CTA */}
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
          30-minute workflow audit - no commitment
        </div>
        <div style={{ fontSize: 13, color: "#7dd3fc", marginBottom: 22, lineHeight: 1.65 }}>
          Walk me through your current coordinator workflow. I will identify which manual steps
          are automatable, what the time savings look like, and what a scoped build would cost.
          No pitch deck. No obligation.
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
          Book a 30-min workflow audit
        </a>
        <div style={{ marginTop: 16, fontSize: 12, color: "#475569" }}>
          Kirill D. - LaunchSoloAI - Calgary, AB - kirill@launchsoloai.com
        </div>
      </div>
    </div>
  );
}
