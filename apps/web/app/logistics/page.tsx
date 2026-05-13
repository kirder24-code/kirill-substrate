"use client";

import { useState } from "react";

const CALENDAR_LINK = "https://cal.com/kirill-d";

const PAIN_POINTS = [
  {
    title: "Manual HS code lookup",
    detail:
      "Every new product line means hours cross-referencing tariff schedules. One wrong 6-digit code triggers a customs hold or a penalty that wipes the margin on the shipment.",
  },
  {
    title: "Tariff rate changes with no warning",
    detail:
      "The February 2026 IEEPA ruling and ongoing Section 232 steel/aluminum adjustments changed rates mid-quarter. Most brokers found out when clients called angry about unexpected duties.",
  },
  {
    title: "Document prep time per shipment",
    detail:
      "Commercial invoices, packing lists, certificates of origin, B3 forms - each shipment requires the same document assembly. At 30-60 min per file, a 40-shipment month buries your team.",
  },
];

const ROI_MATH = [
  { label: "Avg time per shipment (manual)", value: "45 min" },
  { label: "Shipments per month (typical broker)", value: "40-80" },
  { label: "Time recovered per month", value: "30-60 hrs" },
  { label: "At $80/hr burdened cost", value: "$2,400-4,800 saved" },
  { label: "Service fee", value: "$500-1,500 CAD/month" },
  { label: "ROI", value: "5-6x on time cost alone" },
];

const WHAT_IT_DOES = [
  "Automated HS code classification from product description or image",
  "Real-time tariff rate lookup across CBSA, USITC, and Section 232/301 schedules",
  "Document assembly: B3, commercial invoice cross-check, certificate of origin draft",
  "Tariff change alerts pushed to your team when a ruling affects active shipments",
  "Audit trail: every classification decision logged with source and confidence score",
];

const WHO_IT_FITS = [
  "Licensed customs brokers handling 20+ shipments per month",
  "Canadian importers sourcing from the US, China, or Mexico post-CUSMA/USMCA",
  "Freight forwarders doing light customs work in-house",
  "Manufacturers managing their own import compliance for raw materials",
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
        flexShrink: 0,
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function LogisticsPage() {
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
          AI Workflow Automation - Customs and Trade Compliance
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: "#f0f9ff",
            marginBottom: 14,
            lineHeight: 1.3,
          }}
        >
          AI Workflow for Calgary Customs Brokers and Importers
        </h1>
        <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 20, lineHeight: 1.7 }}>
          Tariff schedules changed three times in Q1 2026. Your team is still looking up HS codes
          by hand, assembling the same documents for every shipment, and finding out about duty
          changes from angry client calls. There is a faster way.
        </p>
        <a
          href={CALENDAR_LINK}
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
            letterSpacing: "0.01em",
          }}
        >
          Book a 20-min call
        </a>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span
            style={{
              background: "#1e3a5f",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 12,
              color: "#bae6fd",
            }}
          >
            No software to install
          </span>
          <span
            style={{
              background: "#1e3a5f",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 12,
              color: "#bae6fd",
            }}
          >
            Works with your current TMS
          </span>
          <span
            style={{
              background: "#1e3a5f",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 12,
              color: "#bae6fd",
            }}
          >
            $500-1,500 CAD/month retainer
          </span>
          <span
            style={{
              background: "#1e3a5f",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 12,
              color: "#bae6fd",
            }}
          >
            2-week setup
          </span>
        </div>
      </div>

      {/* Pain points */}
      <div style={sectionTitle}>What this solves</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
            <div
              style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", marginBottom: 6 }}
            >
              {p.title}
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{p.detail}</div>
          </div>
        ))}
      </div>

      {/* What it does */}
      <div style={sectionTitle}>What the workflow does</div>
      <div
        style={{
          background: "#0c1a2e",
          border: "1px solid #1e3a5f",
          borderRadius: 8,
          padding: "14px 16px",
        }}
      >
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          {WHAT_IT_DOES.map((item, i) => (
            <li key={i} style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* ROI math */}
      <div style={sectionTitle}>ROI breakdown</div>
      <div
        style={{
          background: "#0f1f0f",
          border: "1px solid #166534",
          borderRadius: 8,
          padding: "14px 16px",
        }}
      >
        <div style={{ fontSize: 12, color: "#86efac", marginBottom: 12, fontWeight: 700 }}>
          CONSERVATIVE ESTIMATE - MANUAL BURDEN ONLY
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ROI_MATH.map((row, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderBottom: i < ROI_MATH.length - 1 ? "1px solid #14532d" : "none",
                paddingBottom: i < ROI_MATH.length - 1 ? 8 : 0,
              }}
            >
              <span style={{ fontSize: 13, color: "#94a3b8" }}>{row.label}</span>
              <span
                style={{
                  fontSize: 13,
                  color: i === ROI_MATH.length - 1 ? "#4ade80" : "#e2e8f0",
                  fontWeight: i === ROI_MATH.length - 1 ? 700 : 400,
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Who it fits */}
      <div style={sectionTitle}>Who this is for</div>
      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: "14px 16px",
        }}
      >
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {WHO_IT_FITS.map((item, i) => (
            <li key={i} style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Pricing */}
      <div style={sectionTitle}>Pricing</div>
      <div
        style={{
          background: "#1a1200",
          border: "1px solid #78350f",
          borderRadius: 8,
          padding: "16px 16px",
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 10 }}>
          RETAINER - MONTH TO MONTH
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#fef3c7" }}>Starter (up to 40 shipments/mo)</span>
            <span style={{ fontSize: 13, color: "#fbbf24", fontWeight: 700 }}>$500 CAD/month</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#fef3c7" }}>Growth (up to 100 shipments/mo)</span>
            <span style={{ fontSize: 13, color: "#fbbf24", fontWeight: 700 }}>$1,000 CAD/month</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#fef3c7" }}>
              Scale (100+ shipments/mo, custom alerts)
            </span>
            <span style={{ fontSize: 13, color: "#fbbf24", fontWeight: 700 }}>$1,500 CAD/month</span>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "#92400e" }}>
          No long-term contracts. Cancel with 30 days notice. Setup fee waived for first 3 clients.
        </div>
      </div>

      {/* CTA bottom */}
      <div
        style={{
          background: "#0c2340",
          border: "1px solid #1e4a7a",
          borderRadius: 10,
          padding: "24px 24px",
          marginTop: 28,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#f0f9ff", marginBottom: 8 }}>
          Ready to cut 30-60 hrs/month from your compliance burden?
        </div>
        <div style={{ fontSize: 13, color: "#7dd3fc", marginBottom: 20 }}>
          20-minute call. No pitch deck. You describe your current workflow, I show you exactly
          where the AI slots in.
        </div>
        <a
          href={CALENDAR_LINK}
          target="_blank"
          rel="noopener noreferrer"
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
          Book a 20-min call
        </a>
        <div style={{ marginTop: 14, fontSize: 12, color: "#475569" }}>
          Kirill D. - LaunchSoloAI - Calgary, AB - kirill@launchsoloai.com
        </div>
      </div>
    </div>
  );
}
