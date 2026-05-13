/**
 * scripts/survival/llm-think.mjs
 *
 * Single point where survival_loop calls Claude. Wraps the CLI call,
 * estimates token usage, records cost into resource-ledger, and enforces
 * budget-guard before the call. If budget denies, returns
 * { ok: false, reason: "budget_block" }.
 *
 * Other parts of survival_loop must NEVER call Claude directly. All
 * cognition flows through this module so cost is accountable.
 */

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { authorizeNextCall } from "./budget-guard.mjs";
import { recordLlmCall, costOfLife } from "./resource-ledger.mjs";

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

export async function think({ prompt, model = "claude-sonnet-4-6", caller, strategy_id, max_input_tokens = 8000, max_output_tokens = 1500 }) {
  const projected_cost = costOfLife({
    model,
    in_tokens: max_input_tokens,
    out_tokens: max_output_tokens,
  });
  const auth = authorizeNextCall({ projected_cost_usd: projected_cost });
  if (!auth.permitted) {
    return { ok: false, reason: "budget_block", auth };
  }

  // Use temp file for prompt to avoid shell argument-length limits.
  const tmpPromptFile = resolve(tmpdir(), `survival-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  let output;
  try {
    writeFileSync(tmpPromptFile, prompt);
    const cmd = `cat "${tmpPromptFile}" | "${CLAUDE_BIN}" -p --model ${model} --max-turns 5 --output-format text 2>&1`;
    output = execSync(cmd, { encoding: "utf-8", timeout: 300_000, maxBuffer: 20 * 1024 * 1024 });
  } catch (e) {
    try { unlinkSync(tmpPromptFile); } catch {}
    return { ok: false, reason: "claude_call_failed", error: String(e.message || e).slice(0, 500) };
  }
  try { unlinkSync(tmpPromptFile); } catch {}

  // Approximate token counts (Claude CLI doesn't return exact usage).
  // Use conservative overestimate to stay safe under budget.
  const approx_in_tokens = Math.ceil(prompt.length / 4);
  const approx_out_tokens = Math.ceil(output.length / 4);
  const actual_cost = recordLlmCall({
    model,
    in_tokens: approx_in_tokens,
    out_tokens: approx_out_tokens,
    caller: caller || "survival",
    strategy_id,
    notes: `prompt_len=${prompt.length} output_len=${output.length}`,
  });

  return {
    ok: true,
    output: output.trim(),
    cost_usd: actual_cost,
    approx_in_tokens,
    approx_out_tokens,
  };
}
