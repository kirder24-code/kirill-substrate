import type { ProviderRouterConfig } from "./types";
import { ImageProvider } from "./imageProvider";
import { MiraiProvider, type MiraiProviderConfig } from "./miraiProvider";
import { MockTextProvider } from "./mockTextProvider";
import { MockVisualProvider } from "./mockVisualProvider";
import { ProviderRegistry } from "./providerRegistry";
import { ProviderRouter } from "./providerRouter";
import { StrongTextProvider, type StrongTextProviderConfig } from "./strongTextProvider";

export * from "./types";
export * from "./providerRegistry";
export * from "./providerRouter";
export * from "./executionPolicy";
export * from "./mockTextProvider";
export * from "./mockVisualProvider";
export * from "./miraiProvider";
export * from "./miraiAdapter";
export * from "./miraiTransport";
export * from "./miraiSdkTransport";
export * from "./strongTextProvider";
export * from "./imageProvider";

export function createDefaultProviderRegistry(options: {
  mirai?: MiraiProviderConfig;
  strongText?: StrongTextProviderConfig;
  strongTextWriter?: StrongTextProviderConfig;
  strongTextUtility?: StrongTextProviderConfig;
  strongTextTimeoutMs?: number;
} = {}): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.registerTextProvider(new MockTextProvider());
  registry.registerTextProvider(new MiraiProvider(options.mirai));

  // Register writer-tier provider (gpt-5.4-mini for publish-ready content)
  if (options.strongTextWriter) {
    registry.registerTextProvider(
      new StrongTextProvider(options.strongTextWriter, {
        timeoutMs: options.strongTextTimeoutMs,
        providerId: "strong-text-writer"
      })
    );
  }

  // Register utility-tier provider (gpt-5.4-nano for cheap tasks)
  if (options.strongTextUtility) {
    registry.registerTextProvider(
      new StrongTextProvider(options.strongTextUtility, {
        timeoutMs: options.strongTextTimeoutMs,
        providerId: "strong-text-utility"
      })
    );
  }

  // Legacy single strong-text provider for backward compatibility
  if (options.strongText && !options.strongTextWriter && !options.strongTextUtility) {
    registry.registerTextProvider(
      new StrongTextProvider(options.strongText, {
        timeoutMs: options.strongTextTimeoutMs
      })
    );
  }

  registry.registerVisualProvider(new MockVisualProvider());
  registry.registerVisualProvider(new MiraiProvider(options.mirai));
  registry.registerVisualProvider(new ImageProvider());
  return registry;
}

export function createProviderRouterFromEnv(
  env: Record<string, string | undefined> = process.env
): ProviderRouter {
  const mode = resolveModeFromEnv(env);

  // Tier-specific model configuration
  const writerModel = env.OPENAI_WRITER_MODEL;
  const utilityModel = env.OPENAI_UTILITY_MODEL;
  const baseModel = env.OPENAI_TEXT_MODEL ?? env.OPENAI_MODEL;

  const registry = createDefaultProviderRegistry({
    mirai: {
      enabled: env.MIRAI_ENABLED === "true",
      apiKey: env.MIRAI_API_KEY,
      model: env.MIRAI_MODEL,
      modelRepo: env.MIRAI_MODEL_REPO,
      timeoutMs: parseNumber(env.MIRAI_TIMEOUT_MS),
      transport: normalizeTransport(env.MIRAI_TRANSPORT),
      nodePath: env.MIRAI_NODE_PATH,
      execPath: env.MIRAI_EXEC_PATH
    },
    strongTextWriter: writerModel ? {
      apiKey: env.OPENAI_API_KEY,
      model: writerModel,
      baseUrl: env.OPENAI_BASE_URL,
      organization: env.OPENAI_ORGANIZATION,
      project: env.OPENAI_PROJECT
    } : undefined,
    strongTextUtility: utilityModel ? {
      apiKey: env.OPENAI_API_KEY,
      model: utilityModel,
      baseUrl: env.OPENAI_BASE_URL,
      organization: env.OPENAI_ORGANIZATION,
      project: env.OPENAI_PROJECT
    } : undefined,
    strongText: (!writerModel && !utilityModel) ? {
      apiKey: env.OPENAI_API_KEY,
      model: baseModel,
      baseUrl: env.OPENAI_BASE_URL,
      organization: env.OPENAI_ORGANIZATION,
      project: env.OPENAI_PROJECT
    } : undefined,
    strongTextTimeoutMs: parseNumber(env.OPENAI_TIMEOUT_MS)
  });

  const config: ProviderRouterConfig = {
    mode,
    textProvider: resolveTextProvider(mode, env.LBO_TEXT_PROVIDER),
    visualProvider: resolveVisualProvider(mode, env.LBO_VISUAL_PROVIDER),
    fallbackEnabled: env.LBO_PROVIDER_FALLBACK !== "false",
    writerProvider: writerModel ? "strong-text-writer" : undefined,
    utilityProvider: utilityModel ? "strong-text-utility" : undefined
  };

  return new ProviderRouter(registry, config);
}

function normalizeMode(value: string | undefined): ProviderRouterConfig["mode"] {
  if (value === "mock" || value === "local" || value === "external") {
    return value;
  }
  return "deterministic";
}

function resolveModeFromEnv(
  env: Record<string, string | undefined>
): ProviderRouterConfig["mode"] {
  const explicitMode = normalizeMode(env.LBO_PROVIDER_MODE);
  if (env.LBO_PROVIDER_MODE === "mock" || env.LBO_PROVIDER_MODE === "local" || env.LBO_PROVIDER_MODE === "external") {
    return explicitMode;
  }

  const openAIApiKey = env.OPENAI_API_KEY?.trim();
  if (openAIApiKey && openAIApiKey !== "PASTE_REAL_KEY_HERE") {
    return "external";
  }

  return "deterministic";
}

function resolveTextProvider(
  mode: ProviderRouterConfig["mode"],
  explicitProvider: string | undefined
): string | null {
  if (explicitProvider) return explicitProvider;
  if (mode === "mock") return "mock-text";
  if (mode === "local") return "mirai";
  if (mode === "external") return "strong-text";
  return null;
}

function resolveVisualProvider(
  mode: ProviderRouterConfig["mode"],
  explicitProvider: string | undefined
): string | null {
  if (explicitProvider) return explicitProvider;
  if (mode === "mock") return "mock-visual";
  if (mode === "local") return "mirai";
  if (mode === "external") return "image-provider";
  return null;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTransport(
  value: string | undefined
): "node" | "cli" | "sdk" | undefined {
  if (value === "node" || value === "cli" || value === "sdk") {
    return value;
  }
  return undefined;
}
