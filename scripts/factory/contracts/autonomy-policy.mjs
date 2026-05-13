/**
 * AUTONOMY POLICY v1
 *
 * Defines what each module can do automatically vs what needs human approval.
 * Not just a level — a full policy with conditions.
 */

export const AUTONOMY_LEVELS = {
  automatic: "Module runs without any human intervention",
  automatic_if: "Module runs automatically if evidence threshold met",
  human_gate: "Module prepares output but waits for human approval before action",
  human_assisted: "Module provides materials, human executes the action",
  manual: "Human does everything, module only logs",
};

export const RISK_CLASSES = {
  low: "Internal processing, no external visibility",
  medium: "Creates artifacts that may be shown to human",
  high: "Sends messages or publishes content externally",
  critical: "Financial decisions, strategy changes, irreversible actions",
};

/**
 * Module autonomy policies.
 * Key = module_name, value = policy.
 */
export const MODULE_POLICIES = {
  // ═══ Fully automatic (internal processing) ═══
  "world-state-compiler": {
    level: "automatic", risk: "low",
    description: "Compiles state from truth tables — no external action",
  },
  "signal-scanner": {
    level: "automatic", risk: "low",
    description: "Scans external sources for signals — read-only",
  },
  "qualification-engine": {
    level: "automatic", risk: "low",
    description: "Scores and qualifies signals — internal decision",
  },
  "decision-engine": {
    level: "automatic", risk: "medium",
    description: "Decides promote/queue/defer/reject — but promote requires human gate",
  },
  "outcome-collector": {
    level: "automatic", risk: "low",
    description: "Collects reply rates, evidence stats — passive observation",
  },
  "hypothesis-generator": {
    level: "automatic", risk: "low",
    description: "Generates hypotheses from outcomes — internal reasoning",
  },

  // ═══ Automatic with conditions ═══
  "email-sender": {
    level: "automatic_if", risk: "high",
    conditions: { verified_target: true, template_approved: true, constraint_check: true },
    description: "Sends email automatically if target verified and template approved",
  },
  "behavior-adapter": {
    level: "automatic_if", risk: "medium",
    conditions: { evidence_threshold: 10, confidence_threshold: 70 },
    description: "Changes parameters automatically if enough evidence supports the change",
  },

  // ═══ Human gate (system prepares, human approves) ═══
  "opportunity-promoter": {
    level: "human_gate", risk: "high",
    approval_from: "kirill",
    description: "Promoting opportunity to active project — Kirill must press 🚀",
  },
  "content-publisher": {
    level: "human_gate", risk: "high",
    approval_from: "kirill",
    description: "Publishing any content — Kirill reviews and posts",
  },
  "strategy-changer": {
    level: "human_gate", risk: "critical",
    approval_from: "kirill",
    conditions: { requires_justification: true, min_evidence: 5 },
    description: "Major strategy shifts (new market, new ICP) — needs evidence + approval",
  },

  // ═══ Human assisted (system provides materials, human executes) ═══
  "linkedin-outreach": {
    level: "human_assisted", risk: "high",
    reason: "No LinkedIn API access, no Premium — copy-paste only",
    description: "System provides connection request text, Kirill sends manually",
  },
  "reddit-commenter": {
    level: "human_assisted", risk: "high",
    reason: "Playwright possible but risky for account",
    description: "System provides comment text, Kirill posts manually",
  },
  "facebook-poster": {
    level: "human_assisted", risk: "high",
    reason: "No API access to Facebook groups",
    description: "System provides post text, Kirill posts manually",
  },
};
