"use client";

import { useState } from "react";

const CALENDAR_LINK = "https://cal.com/kirill-d";

type Vertical = "dental" | "medspa" | "law";

const VERTICALS: { id: Vertical; label: string; color: string }[] = [
  { id: "dental", label: "Dental Clinics", color: "#38bdf8" },
  { id: "medspa", label: "Med Spa / Aesthetics", color: "#a78bfa" },
  { id: "law", label: "Law Firms", color: "#34d399" },
];

const VERTICAL_CONTENT: Record<
  Vertical,
  {
    headline: string;
    subline: string;
    proofClaims: string[];
    painLine: string;
    offerLine: string;
    ctaLabel: string;
  }
> = {
  dental: {
    headline: "Dental clinics lose 4-6 appointment calls every night to voicemail.",
    subline:
      "A patient with a toothache at 9pm calls three clinics. The one that answers live gets the appointment. The others get a dead voicemail.",
    proofClaims: [
      "Emergency dental calls spike evenings and weekends - exactly when your front desk is gone",
      "1 missed new-patient call = $400-1,200 CAD in lost treatment revenue",
      "Patients do not leave voicemails - they call the next clinic on the list",
      "Google reviews mentioning 'couldn't get through' drop your rating and your referrals",
      "A 24-hour AI receptionist qualifies the caller, confirms the appointment slot, and texts your team - no staff required",
    ],
    painLine: "Your after-hours line goes to voicemail. The patient calls the next clinic.",
    offerLine:
      "7-day pilot for dental clinics: we configure the AI receptionist for your practice, connect it to your phone line, and you run it live for one week. Setup in 24 hours. You pay only if the agent handles real calls.",
    ctaLabel: "Book a dental pilot call",
  },
  medspa: {
    headline: "Med spa clients browse at 10pm. Your phone is off. They book elsewhere.",
    subline:
      "High-value aesthetic appointments are decided in the moment. When a client wants Botox or a laser treatment tonight, they book whoever responds - not whoever has the nicest website.",
    proofClaims: [
      "Average med spa appointment value: $300-900 CAD - one unanswered call is one lost treatment",
      "Clients researching injectables and skin treatments browse after 8pm when your staff is offline",
      "A prospect who can't reach you books a competitor within 10 minutes",
      "AI receptionist qualifies the caller, captures their treatment interest, and books a consult slot",
      "No new software for your team - the agent works on your existing phone line via call forwarding",
    ],
    painLine: "High-value clients call, get voicemail, and book your competitor.",
    offerLine:
      "7-day pilot for med spas: we set up the AI receptionist on your line and configure it for your specific treatments. Setup in 24 hours. You pay only if the agent handles real calls.",
    ctaLabel: "Book a med spa pilot call",
  },
  law: {
    headline: "Legal clients call during crises. If no one answers, they hire someone else.",
    subline:
      "A person facing an emergency - custody dispute, accident, wrongful termination - calls a law firm at 7pm. If they reach voicemail, they call the next firm on the list. That case is gone.",
    proofClaims: [
      "Legal consultations requested evenings and weekends are the highest-intent leads you will ever get",
      "1 missed consultation request = $2,000-15,000+ CAD in lost retainer revenue",
      "Clients under stress do not wait for a callback - they need to feel heard immediately",
      "AI receptionist captures the case type, urgency level, and contact info - your attorney reviews it with full context",
      "Compliant intake script - no legal advice given, only triage and booking",
    ],
    painLine: "A high-value client calls after hours, reaches voicemail, and hires the firm that answered.",
    offerLine:
      "7-day pilot for law firms: we configure the AI intake receptionist for your practice areas and connect it to your after-hours line. Setup in 24 hours. You pay only if the agent handles real calls.",
    ctaLabel: "Book a law firm pilot call",
  },
};

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "We configure in 24 hours",
    detail:
      "You tell us your business type, hours, and what a qualified caller looks like. We build the agent script and connect it to your phone line via call forwarding. No hardware. No IT work on your end.",
  },
  {
    step: "2",
    title: "Pilot runs for 7 days",
    detail:
      "Your after-hours line (and optionally your main line during busy periods) forwards to the AI receptionist. It answers live - not a recording - qualifies the caller, and texts a summary to you or your team.",
  },
  {
    step: "3",
    title: "You pay only for handled calls",
    detail:
      "If the agent handles real inbound calls during the pilot, you pay a flat per-call rate. If no calls come through, you owe nothing. No subscription to start, no setup fee.",
  },
];

function VerticalTab({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 18px",
        fontSize: 13,
        fontWeight: active ? 700 : 400,
        cursor: "pointer",
        background: active ? color + "22" : "#1e293b",
        color: active ? color : "#94a3b8",
        border: active ? `1.5px solid ${color}` : "1.5px solid #334155",
        borderRadius: 8,
        transition: "all 0.1s",
      }}
    >
      {label}
    </button>
  );
}

export default function PilotPage() {
  const [active, setActive] = useState<Vertical>("dental");
  const content = VERTICAL_CONTENT[active];
  const vertColor = VERTICALS.find((v) => v.id === active)!.color;

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "40px 20px 60px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#e2e8f0",
        background: "#0f172a",
        minHeight: "100vh",
      }}
    >
      {/* Site label */}
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 32, letterSpacing: "0.05em" }}>
        LAUNCHSOLOAI.COM - MISSED-CALL RECOVERY PILOT
      </div>

      {/* Main offer block */}
      <div
        style={{
          background: "#0c1f3a",
          border: "1px solid #1e3a5f",
          borderRadius: 12,
          padding: "28px 32px",
          marginBottom: 32,
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: "#134e4a",
            color: "#6ee7b7",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "3px 10px",
            borderRadius: 4,
            marginBottom: 16,
          }}
        >
          7-DAY PILOT - SETUP IN 24 HOURS
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#f0f9ff",
            lineHeight: 1.25,
            marginBottom: 14,
          }}
        >
          We recover your missed calls.
          <br />
          Setup free. You pay only when it answers real calls.
        </h1>
        <p style={{ fontSize: 15, color: "#94a3b8", lineHeight: 1.6, marginBottom: 20 }}>
          Dental clinics, med spas, and law firms lose high-value clients every week to unanswered after-hours
          calls. We configure an AI receptionist on your line in 24 hours and run a 7-day live pilot - no
          subscription, no setup fee.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {[
            "Live answer - not a recording",
            "24-hour setup",
            "Call forwarding only - no hardware",
            "Pay per handled call",
            "7-day pilot - cancel anytime",
          ].map((badge) => (
            <span
              key={badge}
              style={{
                background: "#1e3a5f",
                border: "1px solid #2d5a8e",
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 12,
                color: "#bae6fd",
              }}
            >
              {badge}
            </span>
          ))}
        </div>
      </div>

      {/* Vertical selector */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, letterSpacing: "0.04em" }}>
          SELECT YOUR BUSINESS TYPE
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {VERTICALS.map((v) => (
            <VerticalTab
              key={v.id}
              label={v.label}
              active={active === v.id}
              color={v.color}
              onClick={() => setActive(v.id)}
            />
          ))}
        </div>
      </div>

      {/* Vertical-specific content */}
      <div
        style={{
          background: "#111827",
          border: `1px solid ${vertColor}33`,
          borderRadius: 12,
          padding: "24px 28px",
          marginBottom: 28,
        }}
      >
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: vertColor,
            lineHeight: 1.35,
            marginBottom: 10,
          }}
        >
          {content.headline}
        </h2>
        <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.6, marginBottom: 20 }}>
          {content.subline}
        </p>

        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#64748b",
            letterSpacing: "0.06em",
            marginBottom: 10,
          }}
        >
          WHY THIS MATTERS FOR YOUR PRACTICE
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {content.proofClaims.map((claim, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                background: "#1e293b",
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              <span style={{ color: vertColor, fontSize: 14, marginTop: 1, flexShrink: 0 }}>-</span>
              <span style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>{claim}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            background: "#0f172a",
            border: `1px solid ${vertColor}44`,
            borderRadius: 8,
            padding: "14px 18px",
            marginBottom: 20,
          }}
        >
          <div
            style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em", marginBottom: 6 }}
          >
            THE OFFER
          </div>
          <p style={{ fontSize: 14, color: "#e2e8f0", lineHeight: 1.6, margin: 0 }}>{content.offerLine}</p>
        </div>

        <a
          href={CALENDAR_LINK}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            background: vertColor,
            color: "#0f172a",
            fontWeight: 700,
            fontSize: 14,
            padding: "12px 24px",
            borderRadius: 8,
            textDecoration: "none",
            letterSpacing: "0.01em",
          }}
        >
          {content.ctaLabel} →
        </a>
      </div>

      {/* How it works */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#64748b",
            letterSpacing: "0.06em",
            marginBottom: 14,
          }}
        >
          HOW THE PILOT WORKS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {HOW_IT_WORKS.map((item) => (
            <div
              key={item.step}
              style={{
                display: "flex",
                gap: 14,
                background: "#1e293b",
                borderRadius: 10,
                padding: "14px 18px",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "#334155",
                  color: "#7dd3fc",
                  fontSize: 13,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {item.step}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f9ff", marginBottom: 4 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div
        style={{
          background: "#0c2340",
          border: "1px solid #1e4a7a",
          borderRadius: 12,
          padding: "24px 28px",
          textAlign: "center",
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#f0f9ff", marginBottom: 8 }}>
          Ready to run the pilot?
        </h3>
        <p style={{ fontSize: 13, color: "#7dd3fc", marginBottom: 18 }}>
          15-minute call to confirm fit. We configure your line the same day.
        </p>
        <a
          href={CALENDAR_LINK}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            background: "#0ea5e9",
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            padding: "12px 28px",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Book a 15-minute pilot call →
        </a>
        <div style={{ marginTop: 16, fontSize: 12, color: "#475569" }}>
          Kirill D. - launchsoloai.com - kirill@launchsoloai.com
        </div>
      </div>
    </div>
  );
}
