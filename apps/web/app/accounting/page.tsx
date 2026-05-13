"use client";

const PAIN_POINTS = [
  {
    label: "Staff using personal ChatGPT on client tax files - no audit trail",
    detail:
      "When a preparer pastes a client's T4 or financial summary into ChatGPT to draft a memo, that data leaves your firm's control. There is no log, no consent record, and no way to prove it did not happen in a CRA audit. Most partners do not know it is occurring.",
  },
  {
    label: "No data governance policy when AI tools are already in use",
    detail:
      "Most accounting firms have not updated their engagement letters or internal policies to address AI tools. Staff are making their own decisions about what to share with which tool. The gap between what leadership assumes and what is actually happening on the ground is significant.",
  },
  {
    label: "Partners unaware of the exposure until a CRA audit surfaces it",
    detail:
      "Shadow AI risk is invisible until it is not. A CRA audit that touches document handling, or a client who asks how their data was processed, can expose practices that were never approved. The discovery happens at the worst possible time.",
  },
];

const DELIVERABLES = [
  {
    title: "Discover every AI touchpoint in your firm in 48 hours",
    detail:
      "Staff interviews and a structured intake process identify every tool being used on client data - ChatGPT, Copilot, Otter, and anything else in the workflow. You get a complete map of where AI is touching your client files, approved or not.",
  },
  {
    title: "Document the compliance gaps",
    detail:
      "We document what is happening against CPA Canada guidance and your existing engagement letter language. Each gap is categorized by risk level so you know which ones to address first and what to tell clients if asked.",
  },
  {
    title: "Automate one high-risk workflow as working proof",
    detail:
      "We take the highest-risk manual process identified - the one most likely to involve unsanctioned AI use - and rebuild it as a compliant, auditable workflow. You leave with a working system, not a report.",
  },
];

export default function AccountingPage() {
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
          Shadow AI Risk - Canadian Accounting Firms
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
          Is your team using ChatGPT with client data?
        </h1>
        <p style={{ fontSize: 15, color: "#bae6fd", marginBottom: 22, lineHeight: 1.65 }}>
          Shadow AI is already in your office. We help Canadian accounting firms find it, contain
          it, and turn it into a compliant workflow - in 48 hours.
        </p>
        <a
          href="mailto:kirill@launchsoloai.com?subject=Shadow%20AI%20Audit%20Request"
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
          Book a 30-min shadow AI audit
        </a>
      </div>

      {/* Section 1: The Risk */}
      <div style={sectionTitle}>The Risk</div>
      <p
        style={{
          fontSize: 14,
          color: "#94a3b8",
          marginBottom: 14,
          lineHeight: 1.65,
        }}
      >
        AI tools are being used inside accounting firms right now - by staff who are trying to
        work faster. The problem is not the tools. The problem is that no one approved them, no
        one documented them, and no one knows what client data has already been shared.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {PAIN_POINTS.map((p, i) => (
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

      {/* Section 2: Proof */}
      <div style={sectionTitle}>Proof - Apollo Finvest</div>
      <div
        style={{
          background: "#0f1f0f",
          border: "1px solid #166534",
          borderRadius: 8,
          padding: "18px 16px",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#86efac", marginBottom: 12 }}>
          3-day delivery - RBI-compliant AI system - multi-vendor stack
        </div>
        <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.65, marginBottom: 14 }}>
          Apollo Finvest is an NBFC operating under RBI compliance requirements - one of the more
          demanding regulatory environments for financial data handling. We built their full
          AI-powered document processing pipeline in 3 days: intake, classification, validation
          against compliance rules, and output ready for regulatory submission. Multi-vendor AI,
          real compliance output, full audit trail.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "3-day build - working system delivered, not a slide deck",
            "Every AI decision logged and traceable for regulatory review",
            "Multi-vendor AI stack - best model for each step in the workflow",
            "Client team operates it independently after handoff",
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ color: "#4ade80", fontSize: 13, flexShrink: 0, marginTop: 2 }}>
                -
              </span>
              <span style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{item}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: "#4ade80",
            borderTop: "1px solid #166534",
            paddingTop: 12,
          }}
        >
          CRA compliance is simpler than RBI. If we can deliver a compliant AI system in 3 days
          for a regulated NBFC, we can do it in 48 hours for your firm.
        </div>
        <a
          href="/"
          style={{
            display: "inline-block",
            marginTop: 14,
            fontSize: 13,
            color: "#86efac",
            textDecoration: "underline",
          }}
        >
          See how we built an RBI-compliant AI system in 3 days
        </a>
      </div>

      {/* Section 3: What We Do */}
      <div style={sectionTitle}>What We Do</div>
      <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14, lineHeight: 1.6 }}>
        Three deliverables in 48 hours - discovery, documentation, and one working fix:
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
          $1,500 CAD - fixed scope
        </div>
        <div style={{ fontSize: 13, color: "#7dd3fc", marginBottom: 14 }}>
          No retainer. No commitment. One engagement with a defined output.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            "48-hour turnaround from first call to deliverables",
            "AI touchpoint map of your entire firm",
            "Compliance gap report with CPA Canada reference points",
            "One high-risk workflow rebuilt as a compliant, auditable process",
            "SR&ED-eligible work may qualify for federal tax credits on your end",
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
          Book a 30-min shadow AI audit
        </div>
        <div style={{ fontSize: 13, color: "#7dd3fc", marginBottom: 22, lineHeight: 1.65 }}>
          Tell me how your team is currently using AI tools - or if you are not sure. I will walk
          through your workflow and tell you exactly where the exposure is. 30 minutes. No pitch
          deck.
        </div>
        <a
          href="mailto:kirill@launchsoloai.com?subject=Shadow%20AI%20Audit%20Request"
          style={{
            display: "inline-block",
            background: "#1d4ed8",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            padding: "12px 36px",
            borderRadius: 8,
            textDecoration: "none",
            marginBottom: 16,
          }}
        >
          Book a 30-min shadow AI audit
        </a>
        <div style={{ marginBottom: 12 }}>
          <a
            href="/"
            style={{
              fontSize: 13,
              color: "#94a3b8",
              textDecoration: "underline",
            }}
          >
            See how we built an RBI-compliant AI system in 3 days
          </a>
        </div>
        <div style={{ fontSize: 12, color: "#475569" }}>
          Kirill D. - LaunchSoloAI - Calgary, AB - kirill@launchsoloai.com
        </div>
      </div>
    </div>
  );
}
