import { createRequire } from "node:module";
import {
  buildAiRuntimeHealthSummary,
  buildProviderConfigSummary
} from "./ai-runtime-health.mjs";

const require = createRequire(import.meta.url);

function getSdkAvailability(env = process.env) {
  if (env.MIRAI_ENABLED !== "true") {
    return {
      available: false,
      reason: "MIRAI_ENABLED must be true for SDK smoke checks."
    };
  }

  if (!env.MIRAI_API_KEY) {
    return {
      available: false,
      reason: "MIRAI_API_KEY is not set for SDK smoke checks."
    };
  }

  if (!env.MIRAI_MODEL_REPO) {
    return {
      available: false,
      reason: "MIRAI_MODEL_REPO is not set for SDK smoke checks."
    };
  }

  try {
    require.resolve("@trymirai/uzu", {
      paths: [process.cwd(), new URL("../..", import.meta.url).pathname]
    });
  } catch {
    return {
      available: false,
      reason: "Mirai SDK package '@trymirai/uzu' is not installed."
    };
  }

  return {
    available: true,
    reason: `Mirai SDK is configured for model repo '${env.MIRAI_MODEL_REPO}'.`
  };
}

function determineProviderPath(input) {
  if (
    input.providerMode === "local" &&
    input.textProvider === "mirai" &&
    input.probeAvailable
  ) {
    return {
      selectedPath: "provider",
      reason: "Mirai SDK is configured and the provider path should execute."
    };
  }

  if (input.fallbackEnabled) {
    return {
      selectedPath: "fallback",
      reason: "Mirai SDK is unavailable, so deterministic fallback would run."
    };
  }

  return {
    selectedPath: "error",
    reason: "Mirai SDK is unavailable and fallback is disabled."
  };
}

async function runSdkGenerate(env = process.env) {
  const sdk = await import("@trymirai/uzu");
  const Engine = sdk.default ?? sdk.Engine;
  const engine = await Engine.load(env.MIRAI_API_KEY);
  const model = await engine.chatModel(env.MIRAI_MODEL_REPO);
  await engine.downloadChatModel(model);
  const session = engine.chatSession(model);
  const config = sdk.RunConfig.default()
    .withTokensLimit(1024)
    .withEnableThinking(false);
  const output = session.run(
    sdk.Input.text(
      [
        "Write a LinkedIn post for a B2B operator audience.",
        "Title: Operational AI rollout",
        "Core insight: Rollout work fails when nobody owns the operating system around the model.",
        "Business relevance: Operators need concrete rollout language, not hype.",
        "Return sections labeled Hook, Body, and CTA."
      ].join("\n")
    ),
    config
  );

  return {
    output: mapSdkOutput(output?.text?.original ?? "")
  };
}

function mapSdkOutput(text) {
  const sections = {
    text,
    hook: null,
    body: null,
    cta: null
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith("hook:")) {
      sections.hook = trimmed.slice(5).trim();
    } else if (trimmed.toLowerCase().startsWith("body:")) {
      sections.body = trimmed.slice(5).trim();
    } else if (trimmed.toLowerCase().startsWith("cta:")) {
      sections.cta = trimmed.slice(4).trim();
    }
  }

  if (!sections.body) {
    sections.body = text;
  }
  if (!sections.hook) {
    sections.hook = text.split(/[.!?]/)[0]?.trim() ?? "Mirai SDK output";
  }
  if (!sections.cta) {
    sections.cta = "Compare notes if this pattern is showing up in your team.";
  }

  return sections;
}

function printSection(title, value) {
  console.log(`\n${title}`);
  console.log(JSON.stringify(value, null, 2));
}

export function buildSdkSmokeReadinessSummary(input) {
  return buildAiRuntimeHealthSummary(
    buildProviderConfigSummary({
      mode: input.providerMode,
      textProvider: input.textProvider,
      fallbackEnabled: input.fallbackEnabled,
      textProviderStatus: {
        id: input.textProvider,
        available: input.availability.available,
        reason: input.availability.reason,
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
  const providerMode = process.env.LBO_PROVIDER_MODE ?? "local";
  const textProvider = process.env.LBO_TEXT_PROVIDER ?? "mirai";
  const fallbackEnabled = process.env.LBO_PROVIDER_FALLBACK !== "false";
  const availability = getSdkAvailability(process.env);
  const pathDecision = determineProviderPath({
    providerMode,
    textProvider,
    fallbackEnabled,
    probeAvailable: availability.available
  });
  const readinessSummary = buildSdkSmokeReadinessSummary({
    providerMode,
    textProvider,
    fallbackEnabled,
    availability
  });

  printSection("Provider Smoke Summary", {
    providerMode,
    textProvider,
    fallbackEnabled,
    miraiTransport: "sdk",
    miraiModelRepo: process.env.MIRAI_MODEL_REPO ?? null,
    note: "Model repo ids must use the official SDK repo format, for example Qwen/Qwen3-0.6B."
  });
  printSection("Startup Readiness Summary", readinessSummary);
  printSection("Probe Result", {
    status: 0,
    stdout: availability,
    stderr: null
  });
  printSection("Path Decision", pathDecision);

  if (!availability.available) {
    return;
  }

  try {
    const result = await runSdkGenerate(process.env);
    printSection("Generate Result", {
      status: 0,
      stdout: result,
      stderr: null
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Mirai SDK execution failed.";
    printSection("Generate Result", {
      status: 1,
      stdout: null,
      stderr: {
        error: {
          code: "MIRAI_SDK_EXECUTION_FAILED",
          message
        }
      }
    });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  void main();
}
