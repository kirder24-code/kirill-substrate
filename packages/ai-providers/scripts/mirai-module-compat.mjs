import { existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

// This adapter is a real compatibility seam for module-mode execution.
// It does not claim to know Mirai's private runtime shape. Instead it supports
// a narrow set of explicit module contracts and a configurable target module.

export async function createMiraiRuntime(config = {}) {
  const targetSpecifier = resolveTargetModuleSpecifier(config);
  const importedModule = await import(targetSpecifier);
  const runtime = await resolveTargetRuntime(importedModule, config);

  return {
    async generateText(request) {
      return runtime.generateText({
        task: request.task,
        prompt: request.prompt,
        model: request.model ?? config.model,
        apiKey: request.apiKey ?? config.apiKey
      });
    }
  };
}

function resolveTargetModuleSpecifier(config) {
  const rawSpecifier =
    config.targetModule ??
    process.env.MIRAI_RUNTIME_TARGET_MODULE ??
    process.env.MIRAI_RUNTIME_MODULE;

  if (!rawSpecifier || rawSpecifier === "./packages/ai-providers/scripts/mirai-module-compat.mjs") {
    throw new Error(
      "MIRAI_RUNTIME_TARGET_MODULE must point to a real local Mirai-compatible module."
    );
  }

  if (rawSpecifier.startsWith(".") || rawSpecifier.startsWith("/") || rawSpecifier.startsWith("file:")) {
    if (rawSpecifier.startsWith("file:")) {
      return rawSpecifier;
    }

    const absolutePath = isAbsolute(rawSpecifier)
      ? rawSpecifier
      : resolve(process.cwd(), rawSpecifier);

    if (!existsSync(absolutePath)) {
      throw new Error(
        `Mirai target module does not exist at '${absolutePath}'.`
      );
    }

    return pathToFileURL(absolutePath).href;
  }

  return rawSpecifier;
}

async function resolveTargetRuntime(importedModule, config) {
  if (typeof importedModule.generateText === "function") {
    return {
      generateText: importedModule.generateText
    };
  }

  if (typeof importedModule.chat === "function") {
    return {
      async generateText(request) {
        return importedModule.chat(request);
      }
    };
  }

  if (typeof importedModule.createMiraiRuntime === "function") {
    const createdRuntime = await importedModule.createMiraiRuntime(config);
    if (createdRuntime && typeof createdRuntime.generateText === "function") {
      return createdRuntime;
    }
  }

  if (typeof importedModule.createClient === "function") {
    const client = await importedModule.createClient(config);
    if (client && typeof client.generateText === "function") {
      return client;
    }
    if (client && typeof client.chat === "function") {
      return {
        async generateText(request) {
          return client.chat(request);
        }
      };
    }
  }

  if (
    importedModule.default &&
    typeof importedModule.default.generateText === "function"
  ) {
    return importedModule.default;
  }

  if (importedModule.default && typeof importedModule.default.chat === "function") {
    return {
      async generateText(request) {
        return importedModule.default.chat(request);
      }
    };
  }

  throw new Error(
    "Mirai target module must expose generateText(request), chat(request), createClient(config), or createMiraiRuntime(config)."
  );
}
