#!/usr/bin/env node
// close-loop-cycle2064.mjs
// Closes three open loops synchronously: reply verdict action, outplacement page, scout resumption.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ── STEP 1: Reply verdict action ─────────────────────────────────────────────
const replyFile = path.join(ROOT, ".data/reply-action-cycle2064.md");

if (!fs.existsSync(replyFile)) {
  console.log("[step1] .data/reply-action-cycle2064.md not found - no verdict to act on");
} else {
  const content = fs.readFileSync(replyFile, "utf8");
  const verdictMatch = content.match(/VERDICT\s*=\s*([A-Z_]+)/);
  const verdict = verdictMatch ? verdictMatch[1] : null;
  const leadMatch = content.match(/LEAD[_\s]*NAME\s*[=:]\s*(.+)/i);
  const leadName = leadMatch ? leadMatch[1].trim() : "unknown";
  const scriptMatch = content.match(/REPLY[_\s]*SCRIPT\s*[=:]\s*([\s\S]+?)(?=\n##|\n[A-Z_]+=|$)/i);
  const replyScript = scriptMatch ? scriptMatch[1].trim() : "(no reply script in file)";

  if (verdict === "BUYING_SIGNAL_DETECTED") {
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error("[step1] BUYING_SIGNAL_DETECTED but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
    } else {
      const message = `BUYING SIGNAL - ${leadName}\n\nSuggested reply:\n${replyScript}`;
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: message }),
      });
      const json = await res.json();
      if (json.ok) {
        console.log(`[step1] Telegram sent for BUYING_SIGNAL_DETECTED - lead: ${leadName}`);
      } else {
        console.error("[step1] Telegram send failed:", JSON.stringify(json));
      }
    }
  } else if (verdict === "ALL_COLD") {
    console.log("[step1] all cold");
  } else {
    console.log(`[step1] verdict='${verdict}' - no action defined, skipping`);
  }
}

// ── STEP 2: Outplacement page ─────────────────────────────────────────────────
const outplacementPage = path.join(ROOT, "apps/web/app/outplacement/page.tsx");
const outplacementDir = path.dirname(outplacementPage);

if (fs.existsSync(outplacementPage)) {
  console.log("[step2] apps/web/app/outplacement/page.tsx already exists - skipping creation");
} else {
  fs.mkdirSync(outplacementDir, { recursive: true });
  const pageContent = `"use client";

const EMAIL = "kirill@launchsoloai.com";

const PAIN_POINTS = [
  {
    number: "01",
    title: "Manual job sourcing across 5+ boards for every candidate",
    detail:
      "Consultants copy-paste job listings by hand from LinkedIn, Indeed, and other boards for each candidate. At 50-100 active candidates, this is unsustainable.",
  },
  {
    number: "02",
    title: "Spreadsheet tracking breaks at scale",
    detail:
      "Each new cohort restarts the same spreadsheet chaos: intake forms emailed out, responses copied manually, status updated row by row. There is no pipeline - there is a pile.",
  },
  {
    number: "03",
    title: "50-100 candidate queues burning out your coaches",
    detail:
      "When consultants spend half their time on admin, coaching quality suffers. The 2026 layoff surge will push that queue higher, not lower.",
  },
];

export default function OutplacementPage() {
  return (
    <div
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "48px 24px 80px",
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
          borderRadius: 12,
          padding: "36px 36px 32px",
          marginBottom: 40,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#7dd3fc",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 16,
          }}
        >
          AI Workflow Automation for Outplacement Firms
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#f0f9ff",
            marginBottom: 16,
            lineHeight: 1.3,
          }}
        >
          AI-Powered Candidate Pipeline for Outplacement Firms
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "#93c5fd",
            marginBottom: 28,
            lineHeight: 1.7,
          }}
        >
          Cut manual intake time by 60%. Scale into the 2026 layoff surge without burning out your coaches.
        </p>
        <a
          href={\`mailto:\${EMAIL}\`}
          style={{
            display: "inline-block",
            background: "#2563eb",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            padding: "14px 28px",
            borderRadius: 8,
            textDecoration: "none",
            letterSpacing: "0.01em",
          }}
        >
          Book a 20-min Demo
        </a>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 10 }}>
          20 minutes. We map your intake and tracking process and show exactly what can be automated.
        </div>
      </div>

      {/* Pain */}
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#7dd3fc",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 20,
          }}
        >
          Where your consultants are losing time
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {PAIN_POINTS.map((p) => (
            <div
              key={p.number}
              style={{
                background: "#111827",
                border: "1px solid #1e293b",
                borderRadius: 10,
                padding: "20px 22px",
                display: "flex",
                gap: 18,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#1e3a5f",
                  minWidth: 36,
                  paddingTop: 2,
                }}
              >
                {p.number}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#e2e8f0",
                    marginBottom: 8,
                    lineHeight: 1.4,
                  }}
                >
                  {p.title}
                </div>
                <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
                  {p.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Offer */}
      <div
        style={{
          background: "#111827",
          border: "1px solid #334155",
          borderRadius: 12,
          padding: "32px 36px",
          marginBottom: 40,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#7dd3fc",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 16,
          }}
        >
          The offer
        </div>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "#f0f9ff",
            marginBottom: 6,
            lineHeight: 1.3,
          }}
        >
          Fixed-scope setup + monthly automation support
        </h2>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#2563eb",
            marginBottom: 8,
          }}
        >
          $1,500 CAD setup + $299/mo
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
          Setup covers intake automation, job-match queue, and candidate status tracking - delivered in 5 business days. Monthly covers maintenance, updates, and one new automation per quarter.
        </div>
      </div>

      {/* CTA */}
      <div
        style={{
          background: "#0c2340",
          border: "1px solid #2563eb",
          borderRadius: 12,
          padding: "32px 36px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "#f0f9ff",
            marginBottom: 10,
          }}
        >
          Ready to free your consultants from manual work?
        </div>
        <a
          href={\`mailto:\${EMAIL}\`}
          style={{
            display: "inline-block",
            background: "#2563eb",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            padding: "14px 32px",
            borderRadius: 8,
            textDecoration: "none",
            marginBottom: 16,
          }}
        >
          Book a 20-min Demo
        </a>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>
          Kirill D. - AI Workflow Automation - launchsoloai.com
        </div>
      </div>
    </div>
  );
}
`;
  fs.writeFileSync(outplacementPage, pageContent, "utf8");
  console.log("[step2] Created apps/web/app/outplacement/page.tsx");
}

// ── STEP 3: Remove scouts-paused flag ─────────────────────────────────────────
const scoutsFlag = path.join(ROOT, ".data/scouts-paused.flag");

if (fs.existsSync(scoutsFlag)) {
  fs.unlinkSync(scoutsFlag);
  console.log("[step3] Deleted .data/scouts-paused.flag - scouts unpaused");
} else {
  console.log("[step3] .data/scouts-paused.flag not found - already clear");
}
