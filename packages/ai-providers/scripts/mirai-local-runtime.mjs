// This file is a real Node runtime boundary for MIRAI_NODE_PATH execution.
// It supports a deterministic fixture mode for tests and a narrow module-based
// adapter for local Mirai installations without leaking provider details upward.

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SUPPORTED_TASKS = new Set(["generatePostFromIdea", "refinePostDraft"]);

export async function probeMiraiLocalRuntime(env = process.env) {
  const status = await loadMiraiLocalRuntime(env);
  return {
    available: status.available,
    reason: status.reason
  };
}

export function resolveMiraiRuntimeModuleSpecifier(env = process.env) {
  const moduleId = env.MIRAI_RUNTIME_MODULE ?? "mirai";
  if (
    moduleId.startsWith("file:") ||
    moduleId.startsWith("node:")
  ) {
    return moduleId;
  }

  if (moduleId.startsWith(".") || moduleId.startsWith("/")) {
    const absolutePath = isAbsolute(moduleId)
      ? moduleId
      : resolve(process.cwd(), moduleId);

    return pathToFileURL(absolutePath).href;
  }

  return moduleId;
}

export async function executeMiraiLocalTask(request, env = process.env) {
  const validation = validateGenerateRequest(request);
  if (!validation.ok) {
    return errorResult("INVALID_REQUEST", validation.message);
  }

  const runtimeStatus = await loadMiraiLocalRuntime(env);
  if (!runtimeStatus.available) {
    return errorResult("RUNTIME_UNAVAILABLE", runtimeStatus.reason);
  }

  try {
    const rawOutput = await runtimeStatus.runtime.generateText({
      task: request.task,
      prompt: request.prompt,
      model: request.model,
      apiKey: request.apiKey
    });

    return {
      ok: true,
      output: normalizeMiraiOutput(request.task, request.prompt, rawOutput)
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Mirai runtime execution failed.";
    return errorResult("RUNTIME_EXECUTION_FAILED", message);
  }
}

async function loadMiraiLocalRuntime(env) {
  const mode = env.MIRAI_LOCAL_MODE ?? "module";

  if (mode === "fixture") {
    return {
      available: true,
      reason: "Mirai fixture runtime is available.",
      runtime: createFixtureRuntime()
    };
  }

  if (mode !== "module") {
    return {
      available: false,
      reason: `Unsupported MIRAI_LOCAL_MODE '${mode}'.`
    };
  }

  const moduleId = env.MIRAI_RUNTIME_MODULE ?? "mirai";
  const moduleSpecifier = resolveMiraiRuntimeModuleSpecifier(env);

  if (
    (moduleId.startsWith(".") || moduleId.startsWith("/")) &&
    !existsSync(isAbsolute(moduleId) ? moduleId : resolve(process.cwd(), moduleId))
  ) {
    return {
      available: false,
      reason: `Mirai runtime module '${moduleId}' is unavailable: configured path does not exist.`
    };
  }

  try {
    const importedModule = await import(moduleSpecifier);
    const runtime = await resolveModuleRuntime(importedModule, moduleId, env);
    return {
      available: true,
      reason: `Mirai runtime module '${moduleId}' loaded.`,
      runtime
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown module load failure.";
    return {
      available: false,
      reason: `Mirai runtime module '${moduleId}' is unavailable: ${message}`
    };
  }
}

async function resolveModuleRuntime(importedModule, moduleId, env) {
  if (typeof importedModule.generateText === "function") {
    return {
      generateText: importedModule.generateText
    };
  }

  if (typeof importedModule.createMiraiRuntime === "function") {
    const created = await importedModule.createMiraiRuntime({
      model: env.MIRAI_MODEL,
      apiKey: env.MIRAI_API_KEY,
      targetModule: env.MIRAI_RUNTIME_TARGET_MODULE
    });
    if (created && typeof created.generateText === "function") {
      return created;
    }
  }

  if (
    importedModule.default &&
    typeof importedModule.default.generateText === "function"
  ) {
    return importedModule.default;
  }

  throw new Error(
    `Module '${moduleId}' does not expose generateText(request) or createMiraiRuntime(config).`
  );
}

function createFixtureRuntime() {
  return {
    async generateText(request) {
      if (request.task === "generatePostFromIdea") {
        const title = readPromptLine(request.prompt, "Title:") ?? "Operational post";
        const insight =
          readPromptLine(request.prompt, "Core insight:") ??
          "Ground the message in rollout work and operator ownership.";

        return {
          text: `${insight} Keep it practical, specific, and easy to act on.`,
          hook: `${stripTrailingPeriod(title)} without the hype`,
          body: `${insight} Focus on concrete rollout work, operator ownership, and business clarity.`,
          cta: "Compare notes if your team is working through the same rollout friction."
        };
      }

      if (request.task === "refinePostDraft") {
        const hook = readPromptLine(request.prompt, "Hook:") ?? "Ground the problem first";
        const body = readPromptLine(request.prompt, "Body:") ?? "Keep the language concrete.";
        const cta =
          readPromptLine(request.prompt, "CTA:") ??
          "Compare notes if this pattern looks familiar.";

        const refinedBody = cleanRoboticPhrases(body);
        return {
          text: refinedBody,
          hook: `${stripTrailingPeriod(cleanRoboticPhrases(hook))} in plain terms`,
          body: refinedBody,
          cta: cleanRoboticPhrases(cta)
        };
      }

      throw new Error(`Unsupported Mirai fixture task '${request.task}'.`);
    }
  };
}

function validateGenerateRequest(request) {
  if (!request || typeof request !== "object") {
    return { ok: false, message: "Request body must be an object." };
  }

  if (!SUPPORTED_TASKS.has(request.task)) {
    return {
      ok: false,
      message: `Request must include a supported task. Supported tasks: ${Array.from(
        SUPPORTED_TASKS
      ).join(", ")}.`
    };
  }

  if (typeof request.prompt !== "string" || request.prompt.trim().length === 0) {
    return { ok: false, message: "Request must include a non-empty prompt." };
  }

  return { ok: true };
}

function normalizeMiraiOutput(task, prompt, rawOutput) {
  const normalized = normalizeRawOutput(rawOutput);
  const baseText = normalized.text ?? normalized.body;
  if (!baseText) {
    throw new Error("Mirai runtime output did not include text or body.");
  }

  if (task === "generatePostFromIdea") {
    const title = readPromptLine(prompt, "Title:") ?? "Operational post";
    return {
      text: baseText,
      hook: normalized.hook ?? `${stripTrailingPeriod(title)} without the hype`,
      body: normalized.body ?? baseText,
      cta:
        normalized.cta ??
        "Compare notes if your team is working through the same rollout friction."
    };
  }

  if (task === "refinePostDraft") {
    const hook = readPromptLine(prompt, "Hook:") ?? "Ground the problem first";
    const cta =
      readPromptLine(prompt, "CTA:") ??
      "Compare notes if this pattern looks familiar.";

    return {
      text: baseText,
      hook: normalized.hook ?? cleanRoboticPhrases(hook),
      body: normalized.body ?? baseText,
      cta: normalized.cta ?? cleanRoboticPhrases(cta)
    };
  }

  throw new Error(`Unsupported Mirai task '${task}'.`);
}

function normalizeRawOutput(rawOutput) {
  if (typeof rawOutput === "string") {
    return { text: rawOutput };
  }

  if (rawOutput && typeof rawOutput === "object") {
    return {
      text: readString(rawOutput.text),
      hook: readString(rawOutput.hook),
      body: readString(rawOutput.body),
      cta: readString(rawOutput.cta)
    };
  }

  throw new Error("Mirai runtime returned an unsupported output shape.");
}

function cleanRoboticPhrases(input) {
  return input
    .replace(/AI is changing everything/gi, "AI changes outcomes only when the rollout work is clear")
    .replace(/game changer/gi, "useful shift")
    .replace(/\s+/g, " ")
    .trim();
}

function readPromptLine(prompt, label) {
  const line = prompt
    .split("\n")
    .find((entry) => entry.trim().startsWith(label));

  if (!line) return null;
  const value = line.slice(label.length).trim();
  return value.length > 0 ? value : null;
}

function readString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stripTrailingPeriod(value) {
  return value.replace(/[.?!]+$/, "").trim();
}

function errorResult(code, message) {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}
