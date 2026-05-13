"use client";

const DELIVERABLES = [
  {
    title: "CRA filing prep automation",
    detail:
      "Client documents are collected via a structured intake form, categorized by type (T4, T5, receipts, invoices), and staged into a pre-built filing checklist. Nothing sits in an inbox waiting to be sorted. The preparer opens a ready package, not a pile.",
  },
  {
    title: "Invoice reconciliation workflow",
    detail:
      "Incoming invoices are matched against AP records automatically. Discrepancies are flagged with source references, not buried in email threads. The bookkeeper reviews exceptions - not every line item.",
  },
  {
    title: "Client follow-up sequences by status",
    detail:
      "Missing documents trigger automated follow-ups at defined intervals. Client gets a clear request with a deadline. Your team stops chasing the same client four times for the same T4 slip.",
  },
];

const PROBLEM_POINTS = [
  {
    label: "60% of bookkeeping time is document handling, not analysis",
    detail:
      "At most Canadian accounting firms, staff spend the majority of their day collecting, sorting, and moving documents - not interpreting them. CRA filing season amplifies this: the same intake process repeated for every client, manually, every year.",
  },
  {
    label: "Invoice reconciliation is high-volume and low-margin",
    detail:
      "Matching invoices to AP records is mechanical work. When it is done manually, a bookkeeper touches each line. When volume spikes - end of quarter, fiscal year close - the team either works overtime or falls behind. Neither is sustainable.",
  },
  {
    label: "Client communication for missing documents is a time sink",
    detail:
      "A firm with 80 tax clients will chase missing documents dozens of times per filing season. Each chase is a manual email, a reminder, a follow-up call. None of it requires judgment - just persistence and a system.",
  },
];

export default function AccountingAutomationPage() {
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
          AI Workflow Automation - Accounting and Bookkeeping Firms - Canada
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
          Your bookkeeping team spends 60% of their time on manual work. We automate the first
          bottleneck in 3 days.
        </h1>
        <p style={{ fontSize: 15, color: "#bae6fd", marginBottom: 22, lineHeight: 1.65 }}>
          CRA filing prep and invoice reconciliation - the two workflows that eat the most staff
          time at Canadian accounting firms - automated and running before the end of the week.
          Fixed price. No retainer.
        </p>
        <a
          href="mailto:kirill@launchsoloai.com"
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
        Canadian accounting and bookkeeping teams spend most of their hours on compliance-driven
        admin - not the advisory work that justifies their fees. Filing season makes it worse. The
        same manual process, repeated for every client, every year.
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

      {/* Section 2: Case Study */}
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
          3-day delivery - compliance-grade output - multi-vendor AI
        </div>
        <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.65, marginBottom: 14 }}>
          Apollo Finvest is a non-banking financial company (NBFC) with RBI compliance requirements
          - one of the more demanding regulatory environments for financial document workflows.
          We built their full AI-powered document processing pipeline in 3 days: intake,
          classification, validation against compliance rules, and output ready for regulatory
          submission. Multi-vendor AI stack, real compliance output, no manual review layer needed
          for clean submissions.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "3-day build - working system, not a prototype",
            "Document classification and validation against compliance rules",
            "Multi-vendor AI - best model for each step, not one-size-fits-all",
            "Handed off with documentation the client's team operates independently",
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
          CRA compliance is simpler than RBI. If we can deliver in 3 days for a regulated NBFC, we
          can deliver in 3 days for your firm.
        </div>
      </div>

      {/* Section 3: What You Get */}
      <div style={sectionTitle}>What You Get</div>
      <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14, lineHeight: 1.6 }}>
        Three specific deliverables scoped to CRA filing prep and invoice reconciliation - built
        and handed off within the first engagement:
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
          Fixed price - discovery plus first automation delivered
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            "Scoped to your existing tools - no software replacement required",
            "One bottleneck identified, automated, and handed off in the first engagement",
            "SR&ED-eligible work may qualify for federal tax credits on your end",
            "Follow-on automations available once the first one is running",
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
          Tell me which workflow costs your team the most hours per week. I will map the automation
          and tell you what is buildable in 3 days. No commitment, no pitch deck.
        </div>
        <a
          href="mailto:kirill@launchsoloai.com"
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
