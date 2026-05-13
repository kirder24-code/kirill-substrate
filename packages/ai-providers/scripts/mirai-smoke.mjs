import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildAiRuntimeHealthSummary,
  buildProviderConfigSummary
} from "./ai-runtime-health.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultEntrypointPath = resolve(currentDir, "mirai-local-entrypoint.mjs");

export function buildSmokeEnvironment(
  env = process.env,
  options = { fixture: false }
) {
  return {
    providerMode: env.LBO_PROVIDER_MODE ?? "local",
    textProvider: env.LBO_TEXT_PROVIDER ?? "mirai",
    fallbackEnabled: env.LBO_PROVIDER_FALLBACK !== "false",
    miraiEnabled: env.MIRAI_ENABLED !== "false",
    miraiTransport: env.MIRAI_TRANSPORT ?? "node",
    miraiNodePath: env.MIRAI_NODE_PATH ?? defaultEntrypointPath,
    miraiLocalMode:
      env.MIRAI_LOCAL_MODE ?? (options.fixture ? "fixture" : "module"),
    miraiRuntimeModule:
      env.MIRAI_RUNTIME_MODULE ??
      (options.fixture
        ? null
        : "./packages/ai-providers/scripts/mirai-module-compat.mjs"),
    miraiRuntimeTargetModule: env.MIRAI_RUNTIME_TARGET_MODULE ?? null,
    miraiModel: env.MIRAI_MODEL ?? (options.fixture ? "fixture-model" : "")
  };
}

export function determineProviderPath(input) {
  if (
    input.providerMode === "local" &&
    input.textProvider === "mirai" &&
    input.probeAvailable
  ) {
    return {
      selectedPath: "provider",
      reason: "Mirai is configured and the local entry script probe succeeded."
    };
  }

  if (input.fallbackEnabled) {
    return {
      selectedPath: "fallback",
      reason: "Mirai is selected but unavailable, so deterministic fallback would run."
    };
  }

  return {
    selectedPath: "error",
    reason: "Mirai is unavailable and fallback is disabled."
  };
}

export function runSmokeCommand(
  payload,
  smokeEnvironment,
  commandRunner = defaultRunner
) {
  return commandRunner({
    payload,
    smokeEnvironment
  });
}

export function defaultRunner({ payload, smokeEnvironment }) {
  return spawnSync(process.execPath, [smokeEnvironment.miraiNodePath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      LBO_PROVIDER_MODE: smokeEnvironment.providerMode,
      LBO_TEXT_PROVIDER: smokeEnvironment.textProvider,
      LBO_PROVIDER_FALLBACK: smokeEnvironment.fallbackEnabled ? "true" : "false",
      MIRAI_ENABLED: smokeEnvironment.miraiEnabled ? "true" : "false",
      MIRAI_TRANSPORT: smokeEnvironment.miraiTransport,
      MIRAI_NODE_PATH: smokeEnvironment.miraiNodePath,
      MIRAI_LOCAL_MODE: smokeEnvironment.miraiLocalMode,
      MIRAI_RUNTIME_MODULE: smokeEnvironment.miraiRuntimeModule ?? "",
      MIRAI_RUNTIME_TARGET_MODULE: smokeEnvironment.miraiRuntimeTargetModule ?? "",
      MIRAI_MODEL: smokeEnvironment.miraiModel
    }
  });
}

export function normalizeSmokeResult(result) {
  return {
    status: result.status ?? 1,
    stdout: parseMaybeJson(result.stdout),
    stderr: parseMaybeJson(result.stderr)
  };
}

function parseMaybeJson(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function printSection(title, value) {
  console.log(`\n${title}`);
  console.log(JSON.stringify(value, null, 2));
}

export function buildSmokeReadinessSummary(smokeEnvironment, probeResult) {
  return buildAiRuntimeHealthSummary(
    buildProviderConfigSummary({
      mode: smokeEnvironment.providerMode,
      textProvider: smokeEnvironment.textProvider,
      fallbackEnabled: smokeEnvironment.fallbackEnabled,
      textProviderStatus: {
        id: smokeEnvironment.textProvider,
        available: probeResult.stdout?.available === true,
        reason:
          probeResult.stdout?.reason ??
          "Provider availability probe did not return a reason.",
        capabilities: {
          text: true,
          visual: false,
          live: true
        }
      }
    }),
    false
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const fixture = args.has("--fixture");
  const providersOnly = args.has("--providers-only");
  const smokeEnvironment = buildSmokeEnvironment(process.env, { fixture });

  const probeResult = normalizeSmokeResult(
    runSmokeCommand({ action: "probe" }, smokeEnvironment)
  );
  const pathDecision = determineProviderPath({
    providerMode: smokeEnvironment.providerMode,
    textProvider: smokeEnvironment.textProvider,
    fallbackEnabled: smokeEnvironment.fallbackEnabled,
    probeAvailable: probeResult.stdout?.available === true
  });
  const readinessSummary = buildSmokeReadinessSummary(
    smokeEnvironment,
    probeResult
  );

  printSection("Provider Smoke Summary", {
    providerMode: smokeEnvironment.providerMode,
    textProvider: smokeEnvironment.textProvider,
    fallbackEnabled: smokeEnvironment.fallbackEnabled,
    miraiTransport: smokeEnvironment.miraiTransport,
    miraiNodePath: smokeEnvironment.miraiNodePath,
    miraiLocalMode: smokeEnvironment.miraiLocalMode,
    miraiRuntimeModule: smokeEnvironment.miraiRuntimeModule,
    miraiRuntimeTargetModule: smokeEnvironment.miraiRuntimeTargetModule,
    miraiModel: smokeEnvironment.miraiModel || null
  });
  printSection("Startup Readiness Summary", readinessSummary);
  printSection("Probe Result", probeResult);
  printSection("Path Decision", pathDecision);

  if (providersOnly) {
    return;
  }

  const generatePayload = {
    action: "generate",
    task: "generatePostFromIdea",
    prompt: [
      "Write a LinkedIn post for a B2B operator audience.",
      "Title: Operational AI rollout",
      "Core insight: Rollout work fails when nobody owns the operating system around the model.",
      "Business relevance: Operators need concrete rollout language, not hype."
    ].join("\n"),
    model: smokeEnvironment.miraiModel || "fixture-model"
  };
  const generateResult = normalizeSmokeResult(
    runSmokeCommand(generatePayload, smokeEnvironment)
  );

  printSection("Generate Result", generateResult);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
