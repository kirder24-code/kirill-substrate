import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import type { ProviderAvailability } from "./types";

export type MiraiTransportKind = "node" | "cli" | "sdk";

export interface MiraiTransportConfig {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  transport?: MiraiTransportKind;
  nodePath?: string;
  execPath?: string;
}

export interface MiraiTransportRequest {
  task:
    | "translateToBusiness"
    | "generatePostFromIdea"
    | "refinePostDraft"
    | "summarizeSource"
    | "positionSignal"
    | "reviewContentAsset"
    | "enrichScoutOutput"
    | "generateMatchContent";
  prompt: string;
}

export interface MiraiTransportResponse {
  text: string;
  title?: string;
  hook?: string;
  body?: string;
  cta?: string;
  summary?: string;
}

export interface MiraiTransportRunnerRequest {
  execPath: string;
  scriptPath: string;
  timeoutMs: number;
  payload: Record<string, unknown>;
}

export interface MiraiTransportRunnerResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type MiraiTransportRunner = (
  request: MiraiTransportRunnerRequest
) => Promise<MiraiTransportRunnerResponse>;

export type MiraiTransportProbe = (
  request: MiraiTransportRunnerRequest
) => ProviderAvailability;

export class MiraiTransportError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MIRAI_UNAVAILABLE"
      | "MIRAI_TIMEOUT"
      | "MIRAI_INVALID_RESPONSE"
      | "MIRAI_EXECUTION_FAILED"
  ) {
    super(message);
  }
}

export class MiraiNodeTransport {
  private readonly timeoutMs: number;
  private readonly model: string;
  private readonly enabled: boolean;
  private readonly transport: MiraiTransportKind;
  private readonly nodePath?: string;
  private readonly execPath: string;

  constructor(
    private readonly config: MiraiTransportConfig = {},
    private readonly runner: MiraiTransportRunner = runNodeMiraiCommand,
    private readonly probe: MiraiTransportProbe = probeNodeMiraiCommand
  ) {
    this.timeoutMs = config.timeoutMs ?? 3_000;
    this.model = config.model ?? "mirai-default";
    this.enabled = config.enabled ?? false;
    this.transport = config.transport ?? "node";
    this.nodePath = config.nodePath;
    this.execPath = config.execPath ?? process.execPath;
  }

  getAvailability(): ProviderAvailability {
    if (!this.enabled) {
      return {
        available: false,
        reason: "Mirai transport is disabled."
      };
    }

    if (this.transport !== "node") {
      return {
        available: false,
        reason: `Mirai transport '${this.transport}' is not implemented yet.`
      };
    }

    if (!this.nodePath) {
      return {
        available: false,
        reason: "MIRAI_NODE_PATH is not set."
      };
    }

    if (!existsSync(this.nodePath)) {
      return {
        available: false,
        reason: `Mirai node path does not exist: ${this.nodePath}`
      };
    }

    return this.probe(this.createRequest({ action: "probe" }));
  }

  getSummary(): string {
    const target = this.transport === "node" ? this.nodePath ?? "unconfigured" : this.transport;
    return `${this.model}@${this.transport}:${target}`;
  }

  async generateText(
    request: MiraiTransportRequest
  ): Promise<MiraiTransportResponse> {
    const availability = this.getAvailability();
    if (!availability.available) {
      throw new MiraiTransportError(availability.reason, "MIRAI_UNAVAILABLE");
    }

    const response = await this.runner(
      this.createRequest({
        action: "generate",
        task: request.task,
        prompt: request.prompt,
        model: this.model,
        apiKey: this.config.apiKey
      })
    );

    if (response.exitCode !== 0) {
      throw new MiraiTransportError(
        readMiraiErrorMessage(response.stderr || response.stdout) ||
          "Mirai transport exited with a non-zero status.",
        "MIRAI_EXECUTION_FAILED"
      );
    }

    return mapMiraiTransportResponse(response.stdout);
  }

  private createRequest(
    payload: Record<string, unknown>
  ): MiraiTransportRunnerRequest {
    return {
      execPath: this.execPath,
      scriptPath: this.nodePath ?? "",
      timeoutMs: this.timeoutMs,
      payload
    };
  }
}

export function mapMiraiTransportResponse(stdout: string): MiraiTransportResponse {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new MiraiTransportError(
      "Mirai transport returned an empty response.",
      "MIRAI_INVALID_RESPONSE"
    );
  }

  const parsed = safeParseJson(trimmed);
  if (parsed && typeof parsed === "object") {
    const candidate = "output" in parsed && typeof parsed.output === "object"
      ? (parsed.output as Record<string, unknown>)
      : (parsed as Record<string, unknown>);

    const text = readString(candidate.text) ?? readString(candidate.body);
    if (!text) {
      throw new MiraiTransportError(
        "Mirai transport response did not include text output.",
        "MIRAI_INVALID_RESPONSE"
      );
    }

    return {
      text,
      title: readString(candidate.title),
      hook: readString(candidate.hook),
      body: readString(candidate.body),
      cta: readString(candidate.cta),
      summary: readString(candidate.summary)
    };
  }

  return { text: trimmed };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export const runNodeMiraiCommand: MiraiTransportRunner = (request) =>
  new Promise((resolve, reject) => {
    const child = spawn(request.execPath, [request.scriptPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new MiraiTransportError(
          `Mirai transport timed out after ${request.timeoutMs}ms.`,
          "MIRAI_TIMEOUT"
        )
      );
    }, request.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new MiraiTransportError(error.message, "MIRAI_EXECUTION_FAILED")
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1
      });
    });

    child.stdin.write(JSON.stringify(request.payload));
    child.stdin.end();
  });

export const probeNodeMiraiCommand: MiraiTransportProbe = (request) => {
  const result = spawnSync(request.execPath, [request.scriptPath], {
    input: JSON.stringify(request.payload),
    encoding: "utf8",
    timeout: request.timeoutMs
  });

  if (result.error) {
    return {
      available: false,
      reason: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      available: false,
      reason:
        readMiraiErrorMessage(
          `${result.stderr?.toString() ?? ""}\n${result.stdout?.toString() ?? ""}`
        ) || "Mirai probe failed."
    };
  }

  const parsed = safeParseJson(result.stdout?.toString() ?? "");
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.available === "boolean") {
      return {
        available: record.available,
        reason:
          readString(record.reason) ??
          (record.available ? "Mirai transport responded to probe." : "Mirai probe failed.")
      };
    }
  }

  return {
    available: true,
    reason: "Mirai transport responded to probe."
  };
};

function readMiraiErrorMessage(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = safeParseJson(trimmed);
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if ("error" in record && record.error && typeof record.error === "object") {
      const errorRecord = record.error as Record<string, unknown>;
      return readString(errorRecord.message) ?? trimmed;
    }
    return readString(record.message) ?? trimmed;
  }

  return trimmed;
}
