import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { AIRuntimeHealthSummary } from "@linkedin-brand-os/shared";
import { SqliteDatabase } from "@linkedin-brand-os/db";
import { bootstrapMasterAutonomy, OrchestratorService } from "@linkedin-brand-os/orchestrator";
import { createOperatorAuthServiceFromEnv, type OperatorAuthService } from "./auth";
import {
  BackgroundSchedulerRuntime,
  createBackgroundSchedulerRuntimeFromEnv
} from "./backgroundSchedulerRuntime";
import { buildAiRuntimeHealthSummary, registerRoutes } from "./routes";

export interface BuildAppOptions {
  logger?: boolean;
  orchestrator?: OrchestratorService;
  backgroundSchedulerRuntime?: BackgroundSchedulerRuntime;
  readinessSummarySink?: (summary: AIRuntimeHealthSummary) => void;
  operatorAuthService?: OperatorAuthService;
  webDistDir?: string | false;
}

// Calculate project root from file location (works in both dev and built contexts)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const DEFAULT_WEB_DIST_DIR = resolve(PROJECT_ROOT, "apps/web/dist");

function getAllowedCorsOrigins(): Set<string> {
  const configuredOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (configuredOrigins && configuredOrigins.length > 0) {
    return new Set(configuredOrigins);
  }

  return new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173"
  ]);
}

export async function buildApp(
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true
  });
  const allowedCorsOrigins = getAllowedCorsOrigins();
  const operatorAuthService = options.operatorAuthService ?? createOperatorAuthServiceFromEnv();

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;

    if (origin && allowedCorsOrigins.has(origin)) {
      const requestedHeaders =
        request.headers["access-control-request-headers"] ?? "content-type, authorization";

      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      reply.header("Access-Control-Allow-Headers", requestedHeaders);
    }

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return reply;
    }

    return undefined;
  });

  if (options.orchestrator) {
    await registerRoutes(app, {
      orchestrator: options.orchestrator,
      backgroundSchedulerRuntime: options.backgroundSchedulerRuntime,
      operatorAuthService
    });
    if (options.backgroundSchedulerRuntime) {
      options.backgroundSchedulerRuntime.start();
      app.addHook("onClose", async () => {
        await options.backgroundSchedulerRuntime?.stop();
      });
    }
    emitStartupReadinessSummary(
      app,
      options.orchestrator,
      options.backgroundSchedulerRuntime,
      options.readinessSummarySink
    );
    registerLocalWebRuntime(app, options.webDistDir);
    return app;
  }

  const db = new SqliteDatabase();
  await db.initDatabase();
  const enableAutonomousAiDrafts = process.env.LBO_AUTONOMOUS_AI_DRAFTS === "true";
  const orchestrator = new OrchestratorService({
    db,
    enableAutonomousAiDrafts,
    watchlistFetch: fetch
  });

  // Bootstrap the autonomous factory on first startup (idempotent)
  bootstrapMasterAutonomy(orchestrator).catch((err) => {
    app.log.warn({ err }, "[MasterBootstrap] Bootstrap encountered an error");
  });

  const backgroundSchedulerRuntime =
    options.backgroundSchedulerRuntime ??
    createBackgroundSchedulerRuntimeFromEnv(orchestrator);

  await registerRoutes(app, { orchestrator, backgroundSchedulerRuntime, operatorAuthService });
  backgroundSchedulerRuntime.start();
  emitStartupReadinessSummary(
    app,
    orchestrator,
    backgroundSchedulerRuntime,
    options.readinessSummarySink
  );
  registerLocalWebRuntime(app, options.webDistDir);
  app.addHook("onClose", async () => {
    await backgroundSchedulerRuntime.stop();
  });
  return app;
}

function emitStartupReadinessSummary(
  app: FastifyInstance,
  orchestrator: OrchestratorService,
  backgroundSchedulerRuntime: BackgroundSchedulerRuntime | undefined,
  readinessSummarySink?: (summary: AIRuntimeHealthSummary) => void
): void {
  const summary = buildAiRuntimeHealthSummary(
    orchestrator.getProviderConfigSummary(),
    backgroundSchedulerRuntime?.getStatus().enabled ?? false
  );

  app.log.info({ readiness: summary }, "Startup readiness summary");
  readinessSummarySink?.(summary);
}

function registerLocalWebRuntime(
  app: FastifyInstance,
  webDistDirOption: BuildAppOptions["webDistDir"]
): void {
  const webDistDir = webDistDirOption === false ? null : webDistDirOption ?? DEFAULT_WEB_DIST_DIR;
  if (!webDistDir) {
    return;
  }

  const indexPath = resolve(webDistDir, "index.html");
  if (!existsSync(indexPath)) {
    app.log.warn({ webDistDir }, "Built web assets not found; local product surface serving is disabled.");
    return;
  }

  const sendStaticFile = async (filePath: string, reply: FastifyReply) => {
    const fileContents = await readFile(filePath);
    reply.type(getContentType(filePath)).send(fileContents);
  };

  app.get("/", async (_request, reply) => {
    await sendStaticFile(indexPath, reply);
  });

  app.get("/assets/*", async (request, reply) => {
    const assetPath = (request.params as { "*": string })["*"];
    const resolvedPath = resolve(webDistDir, "assets", assetPath);
    if (!resolvedPath.startsWith(resolve(webDistDir, "assets")) || !existsSync(resolvedPath)) {
      return reply.code(404).send({ error: "Asset not found." });
    }

    await sendStaticFile(resolvedPath, reply);
  });

  app.get("/*", async (request, reply) => {
    const requestPath = request.url.split("?", 1)[0];
    if (requestPath === "/") {
      await sendStaticFile(indexPath, reply);
      return;
    }

    const maybeFilePath = resolve(webDistDir, requestPath.slice(1));
    if (maybeFilePath.startsWith(webDistDir) && existsSync(maybeFilePath)) {
      await sendStaticFile(maybeFilePath, reply);
      return;
    }

    if (!extname(requestPath)) {
      await sendStaticFile(indexPath, reply);
      return;
    }

    return reply.code(404).send({ error: "Not found." });
  });
}

function getContentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
