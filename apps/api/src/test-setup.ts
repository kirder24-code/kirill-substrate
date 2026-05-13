/**
 * Global test setup for apps/api and packages tests.
 *
 * Problem: local .env contains MIRAI_ENABLED=true (operator's dev config), which
 * leaks into test environments and forces provider router into external mode.
 * Tests that expect deterministic fallback mode receive ai_active state instead,
 * producing ~300+ false-positive test failures.
 *
 * Fix: explicitly clear provider-env vars before each test so tests start from
 * deterministic-mode default. Tests that want AI-active mode set env vars
 * themselves inside their test body (then vi.unstubAllEnvs in afterEach
 * restores test isolation).
 */
import { afterEach, beforeEach, vi } from "vitest";

const PROVIDER_ENV_KEYS = [
  "LBO_PROVIDER_MODE",
  "LBO_TEXT_PROVIDER",
  "LBO_VISUAL_PROVIDER",
  "LBO_PROVIDER_FALLBACK",
  "MIRAI_ENABLED",
  "MIRAI_TRANSPORT",
  "MIRAI_LOCAL_MODE",
  "MIRAI_MODEL",
  "MIRAI_MODEL_REPO",
  "MIRAI_API_KEY",
  "MIRAI_NODE_PATH",
  "MIRAI_EXEC_PATH",
  "MIRAI_RUNTIME_MODULE",
  "MIRAI_TIMEOUT_MS",
  "STRONG_TEXT_API_KEY",
  "STRONG_TEXT_ENDPOINT",
  // OpenAI vars - presence forces strong-text provider activation
  "OPENAI_API_KEY",
  "OPENAI_TEXT_MODEL",
  "OPENAI_MODEL",
  "OPENAI_WRITER_MODEL",
  "OPENAI_UTILITY_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
];

beforeEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});
