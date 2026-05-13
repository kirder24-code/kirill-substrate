/**
 * scripts/lib/billing-guard.mjs
 *
 * Port of PAI's pulse.ts billing guard pattern (saved them $354/mo).
 *
 * When daemons spawn `claude` CLI, the CLI prefers ANTHROPIC_API_KEY env var
 * over OAuth login. API-key billing is direct $-per-token via Anthropic
 * Console; OAuth uses Kirill's Claude Max subscription quota (already paid).
 *
 * Calling enforceOAuthBilling() at the top of every daemon strips the API
 * key from process.env so any spawned claude-CLI subprocess inherits a
 * clean env and falls back to OAuth.
 *
 * Usage in any daemon entry-point (FIRST thing after imports):
 *   import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
 *   enforceOAuthBilling();
 *
 * Bypass for explicit API-key code paths (rare):
 *   ALLOW_ANTHROPIC_API_KEY=1 node scripts/whatever.mjs
 *
 * Code that legitimately needs the API key (direct fetch to api.anthropic.com,
 * NOT via claude CLI) should read it from .env via envMap() helpers BEFORE
 * the daemon process spawns child processes — once read into a local var,
 * the env can be safely cleared.
 */

export function enforceOAuthBilling({ silent = false } = {}) {
  if (process.env.ALLOW_ANTHROPIC_API_KEY === "1") {
    if (!silent) console.error("[billing-guard] ALLOW_ANTHROPIC_API_KEY=1 — keeping API key (will be billed direct)");
    return { stripped: false, reason: "explicit_allow" };
  }

  const had = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: !!process.env.ANTHROPIC_AUTH_TOKEN,
  };

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;

  if (!silent && (had.ANTHROPIC_API_KEY || had.ANTHROPIC_AUTH_TOKEN)) {
    console.error(`[billing-guard] stripped ANTHROPIC env (had: ${Object.entries(had).filter(([_, v]) => v).map(([k]) => k).join(", ")}) — claude CLI will use OAuth (Max plan quota)`);
  }

  return { stripped: had.ANTHROPIC_API_KEY || had.ANTHROPIC_AUTH_TOKEN, reason: "default_oauth" };
}

/**
 * Helper for explicit subprocess spawns: returns a clean env object that
 * does NOT include ANTHROPIC_API_KEY/AUTH_TOKEN. Pass to spawn options.env.
 *
 *   import { spawn } from "node:child_process";
 *   import { childEnvOAuth } from "../lib/billing-guard.mjs";
 *   spawn("claude", args, { env: childEnvOAuth() });
 */
export function childEnvOAuth(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}
