/**
 * scripts/cortex/predict-emit.mjs
 *
 * Substrate makes ONE prediction about the external counter (number of
 * new r/AskReddit posts that will appear in the next WINDOW minutes).
 * The prediction is the only LLM call in the whole loop. Recorded
 * BEFORE observation, append-only.
 *
 * The substrate is given:
 *   - the source description
 *   - the current Laplace policy weights (history of past errors per
 *     bucket: 'too_low', 'close', 'too_high'), if any
 *   - the deadline
 *
 * It returns: predicted integer + one-sentence reasoning.
 * Reasoning is stored in `notes` but does NOT feed into the error fn.
 */

import { execSync } from "node:child_process";
import { appendPrediction } from "./outcome-ledger.mjs";
import { openPolicyStore } from "../policy/policy-store.mjs";
import { probabilities } from "../policy/select-action.mjs";
import { getMaxItemId } from "./hn-counter.mjs";

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const WINDOW_MIN = Number(process.env.WINDOW_MIN ?? 20);
const ACTION = "predict_hn_delta";
const CONTEXT = `hn:maxitem:window_${WINDOW_MIN}min`;
const BUCKETS = ["too_low", "close", "too_high"];

function getPolicyHistory() {
  const store = openPolicyStore();
  for (const b of BUCKETS) store.registerVariant(ACTION, b, CONTEXT);
  const rows = store.listVariants(ACTION, CONTEXT);
  const probs = probabilities({ store, action_id: ACTION, context_bucket: CONTEXT });
  store.close();
  return rows.map(r => ({
    bucket: r.variant_id,
    n_attempts: r.n_attempts,
    n_successes: r.n_successes,
    p_close: r.variant_id === "close" ? probs[r.variant_id] : null,
  }));
}

function buildPrompt(history, baseline_maxitem) {
  const summary = history
    .map(h => `${h.bucket}: ${h.n_attempts} attempts, ${h.n_successes} successes`)
    .join("\n");
  return `You are substrate. You make ONE numeric prediction.

TASK: HackerNews maxitem id is currently ${baseline_maxitem}. It grows
with every new comment, post, or poll on HN. Predict how much this
number will grow over the next ${WINDOW_MIN} minutes (the DELTA).

PAST PERFORMANCE (Laplace-smoothed counters from prior cycles):
${summary}

Reference: HN typically produces a few hundred items per hour during
active periods, fewer late at night UTC. Predict an INTEGER delta.

Output ONLY this JSON, nothing else:
{"predicted":<integer>,"reasoning":"<one sentence, <=20 words>"}`;
}

async function callClaude(prompt) {
  const escaped = prompt.replace(/'/g, "'\\''");
  const cmd = `echo '${escaped}' | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 1 --output-format text 2>&1`;
  const out = execSync(cmd, { encoding: "utf-8", timeout: 60_000 });
  return out.trim();
}

function parseJsonLoose(s) {
  const match = s.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`[predict-emit] no JSON in response: ${s.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

const history = getPolicyHistory();
const baseline_maxitem = await getMaxItemId();
const prompt = buildPrompt(history, baseline_maxitem);
const claudeResponse = await callClaude(prompt);
const parsed = parseJsonLoose(claudeResponse);
const predicted = Number.parseInt(parsed.predicted, 10);
if (!Number.isFinite(predicted)) {
  throw new Error(`[predict-emit] predicted not an integer: ${JSON.stringify(parsed)}`);
}
const reasoning = String(parsed.reasoning ?? "").slice(0, 200);

const row = appendPrediction({
  source: `hn:maxitem_delta:window_${WINDOW_MIN}min`,
  predicted_value: predicted,
  deadline_minutes: WINDOW_MIN,
  notes: `baseline_maxitem=${baseline_maxitem} | reasoning: ${reasoning}`,
});

console.log(JSON.stringify({
  emitted: true,
  id: row.id,
  baseline_maxitem,
  predicted_value: predicted,
  reasoning,
  deadline: row.deadline,
  history,
}, null, 2));
