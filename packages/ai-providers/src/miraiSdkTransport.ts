import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { MiraiTransportError, type MiraiTransportRequest, type MiraiTransportResponse } from "./miraiTransport";
import type { ProviderAvailability } from "./types";
import type { MiraiAdapterConfig } from "./miraiAdapter";

const require = createRequire(import.meta.url);
const UZU_MODULE_NAME = "@trymirai/uzu";

export interface MiraiSdkModule {
  default?: {
    load?: (apiKey: string) => Promise<MiraiSdkEngine>;
    create?: (apiKey: string) => Promise<MiraiSdkEngine>;
  };
  Engine?: {
    load?: (apiKey: string) => Promise<MiraiSdkEngine>;
    create?: (apiKey: string) => Promise<MiraiSdkEngine>;
  };
  Input?: {
    text?: (prompt: string) => unknown;
  };
  RunConfig?: {
    default?: () => {
      withTokensLimit?: (limit: number) => {
        withEnableThinking?: (enabled: boolean) => unknown;
      };
    };
  };
  Config?: {
    default?: () => unknown;
  };
}

interface MiraiSdkEngine {
  chatModel?: (repo: string) => Promise<unknown>;
  downloadChatModel?: (
    model: unknown,
    callback?: (event: unknown) => void
  ) => Promise<void>;
  chatSession?: (model: unknown, config?: unknown) => MiraiSdkSession;
  preset?: (name: string) => {
    session?: () => MiraiSdkSession;
  };
}

interface MiraiSdkSession {
  run?: (input: unknown, runConfig?: unknown) => unknown | Promise<unknown>;
  reply?: (prompt: string) => Promise<unknown>;
}

export type MiraiSdkLoader = () => Promise<MiraiSdkModule>;
export type MiraiSdkPackageProbe = () => boolean;

export class MiraiSdkTransport {
  private readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly modelRepo?: string;

  constructor(
    private readonly config: MiraiAdapterConfig,
    private readonly loader: MiraiSdkLoader = loadMiraiSdkModule,
    private readonly packageProbe: MiraiSdkPackageProbe = isMiraiSdkInstalled
  ) {
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.apiKey = config.apiKey;
    this.modelRepo = config.modelRepo ?? config.model;
  }

  getAvailability(): ProviderAvailability {
    if (!this.config.enabled) {
      return {
        available: false,
        reason: "Mirai transport is disabled."
      };
    }

    if (this.config.transport !== "sdk") {
      return {
        available: false,
        reason: "Mirai SDK transport is not selected."
      };
    }

    if (!this.apiKey) {
      return {
        available: false,
        reason: "MIRAI_API_KEY is not set for SDK transport."
      };
    }

    if (!this.modelRepo) {
      return {
        available: false,
        reason: "MIRAI_MODEL_REPO is not set for SDK transport."
      };
    }

    if (!this.packageProbe()) {
      return {
        available: false,
        reason: "Mirai SDK package '@trymirai/uzu' is not installed."
      };
    }

    return {
      available: true,
      reason: `Mirai SDK is configured for model repo '${this.modelRepo}'.`
    };
  }

  getSummary(): string {
    return `${this.modelRepo ?? "unconfigured"}@sdk`;
  }

  async generateText(
    request: MiraiTransportRequest
  ): Promise<MiraiTransportResponse> {
    const availability = this.getAvailability();
    if (!availability.available) {
      throw new MiraiTransportError(availability.reason, "MIRAI_UNAVAILABLE");
    }

    try {
      const sdk = await this.loader();
      const engine = await this.withTimeout(
        loadEngineFromSdk(sdk, this.apiKey as string),
        this.timeoutMs,
        "Mirai SDK engine load timed out."
      );
      const model = await this.withTimeout(
        loadChatModel(engine, this.modelRepo as string),
        this.timeoutMs,
        "Mirai SDK model load timed out."
      );
      await this.withTimeout(
        maybeDownloadModel(engine, model),
        this.timeoutMs,
        "Mirai SDK model download timed out."
      );
      const session = createSession(engine, model, sdk);
      const raw = await this.withTimeout(
        runMiraiSession(session, sdk, request.prompt),
        this.timeoutMs,
        "Mirai SDK request timed out."
      );
      return mapMiraiSdkOutput(request.task, raw);
    } catch (error) {
      if (error instanceof MiraiTransportError) {
        throw error;
      }

      const message = normalizeSdkErrorMessage(
        error,
        this.modelRepo ?? "unknown-model"
      );
      throw new MiraiTransportError(message, "MIRAI_EXECUTION_FAILED");
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new MiraiTransportError(message, "MIRAI_TIMEOUT"));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

async function loadMiraiSdkModule(): Promise<MiraiSdkModule> {
  // Direct import preserves static methods on Engine class
  return import(UZU_MODULE_NAME) as Promise<MiraiSdkModule>;
}

function isMiraiSdkInstalled(): boolean {
  try {
    require.resolve(UZU_MODULE_NAME);
    return true;
  } catch {
    return false;
  }
}

async function loadEngineFromSdk(
  sdk: MiraiSdkModule,
  apiKey: string
): Promise<MiraiSdkEngine> {
  console.log('[DEBUG loadEngineFromSdk] sdk keys:', Object.keys(sdk).slice(0, 10).join(', '));
  console.log('[DEBUG loadEngineFromSdk] sdk.Engine:', typeof sdk.Engine);
  console.log('[DEBUG loadEngineFromSdk] sdk.default:', typeof sdk.default);
  const engineFactory = sdk.Engine ?? sdk.default;
  console.log('[DEBUG loadEngineFromSdk] engineFactory:', typeof engineFactory);
  console.log('[DEBUG loadEngineFromSdk] engineFactory?.load:', typeof engineFactory?.load);
  console.log('[DEBUG loadEngineFromSdk] engineFactory?.create:', typeof engineFactory?.create);
  console.log('[DEBUG loadEngineFromSdk] engineFactory own props:', Object.getOwnPropertyNames(engineFactory).slice(0, 15).join(', '));
  console.log('[DEBUG loadEngineFromSdk] engineFactory.load direct:', typeof (engineFactory as any).load);
  console.log('[DEBUG loadEngineFromSdk] engineFactory.create direct:', typeof (engineFactory as any).create);

  // Try direct access without optional chaining
  if (engineFactory && typeof (engineFactory as any).load === 'function') {
    return (engineFactory as any).load(apiKey);
  }
  if (engineFactory && typeof (engineFactory as any).create === 'function') {
    return (engineFactory as any).create(apiKey);
  }

  throw new Error(
    "Mirai SDK did not expose Engine.load(apiKey) or Engine.create(apiKey)."
  );
}

async function loadChatModel(engine: MiraiSdkEngine, modelRepo: string): Promise<unknown> {
  if (!engine.chatModel) {
    throw new Error("Mirai SDK engine did not expose chatModel(modelRepo).");
  }

  return engine.chatModel(modelRepo);
}

async function maybeDownloadModel(engine: MiraiSdkEngine, model: unknown): Promise<void> {
  if (!engine.downloadChatModel) {
    return;
  }

  await engine.downloadChatModel(model);
}

function createSession(engine: MiraiSdkEngine, model: unknown, sdk: MiraiSdkModule): MiraiSdkSession {
  if (engine.chatSession) {
    const config = sdk.Config?.default ? sdk.Config.default() : undefined;
    return engine.chatSession(model, config);
  }

  const presetSession = engine.preset?.("chat")?.session?.();
  if (presetSession) {
    return presetSession;
  }

  throw new Error("Mirai SDK engine did not expose chatSession(model, config).");
}

async function runMiraiSession(
  session: MiraiSdkSession,
  sdk: MiraiSdkModule,
  prompt: string
): Promise<unknown> {
  if (session.run) {
    const input = sdk.Input?.text ? sdk.Input.text(prompt) : prompt;
    const runConfig = sdk.RunConfig?.default
      ? sdk.RunConfig.default()
          .withTokensLimit?.(1024)
          .withEnableThinking?.(false)
      : undefined;
    return Promise.resolve(session.run(input, runConfig));
  }

  if (session.reply) {
    return session.reply(prompt);
  }

  throw new Error("Mirai SDK session did not expose run(input, config) or reply(prompt).");
}

function mapMiraiSdkOutput(
  task: MiraiTransportRequest["task"],
  raw: unknown
): MiraiTransportResponse {
  const text = extractSdkText(raw);
  if (!text) {
    throw new MiraiTransportError(
      "Mirai SDK response did not include text output.",
      "MIRAI_INVALID_RESPONSE"
    );
  }

  const structured = extractStructuredSections(text);

  if (task === "refinePostDraft" || task === "generatePostFromIdea") {
    return {
      text,
      hook: structured.hook ?? deriveHook(text),
      body: structured.body ?? stripStructuredLabels(text),
      cta:
        structured.cta ??
        "Compare notes if this pattern is showing up in your team.",
      title: undefined,
      summary: undefined
    };
  }

  return {
    text,
    title: undefined,
    summary: undefined
  };
}

function extractSdkText(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const nestedText =
      readNestedString(record, ["text", "original"]) ??
      readNestedString(record, ["text"]) ??
      readNestedString(record, ["output", "text"]) ??
      readNestedString(record, ["response", "text"]) ??
      readNestedString(record, ["content"]);

    return nestedText?.trim() ?? null;
  }

  return null;
}

function readNestedString(record: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim().length > 0 ? current : null;
}

function extractStructuredSections(text: string): {
  hook?: string;
  body?: string;
  cta?: string;
} {
  const sections: { hook?: string; body?: string; cta?: string } = {};
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
  return sections;
}

function stripStructuredLabels(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^(hook|cta):/i.test(line.trim()))
    .map((line) => line.replace(/^body:/i, "").trim())
    .filter(Boolean)
    .join("\n");
}

function deriveHook(text: string): string {
  const firstLine = stripStructuredLabels(text).split("\n")[0] ?? text;
  return firstLine.split(/[.!?]/)[0]?.trim() || "Grounded Mirai output";
}

function normalizeSdkErrorMessage(
  error: unknown,
  modelRepo: string
): string {
  const rawMessage =
    error instanceof Error ? error.message : "Mirai SDK execution failed.";
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("project not active") ||
    normalized.includes("setup incomplete") ||
    normalized.includes("invalid api key") ||
    normalized.includes("unauthorized")
  ) {
    return "Mirai SDK setup is incomplete or the project is not active for the supplied API key.";
  }

  if (
    normalized.includes("model repo not found") ||
    normalized.includes("model not found") ||
    normalized.includes("repo not found") ||
    normalized.includes("unknown repo")
  ) {
    return `Mirai SDK could not find model repo '${modelRepo}'. Verify the official repo id format.`;
  }

  if (
    normalized.includes("download") &&
    (normalized.includes("failed") || normalized.includes("error"))
  ) {
    return `Mirai SDK failed while downloading model repo '${modelRepo}'. Check network access, local disk space, and SDK project setup.`;
  }

  if (
    normalized.includes("@trymirai/uzu") &&
    normalized.includes("cannot find package")
  ) {
    return "Mirai SDK package '@trymirai/uzu' is not installed.";
  }

  return rawMessage;
}
