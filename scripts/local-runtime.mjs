#!/usr/bin/env node

import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNTIME_DIR = resolve(ROOT, ".local-runtime");
const PID_FILE = resolve(RUNTIME_DIR, "app.pid.json");
const LOG_FILE = resolve(RUNTIME_DIR, "app.log");
const APP_URL = "http://127.0.0.1:4000";
const HEALTH_URL = `${APP_URL}/health`;
const API_ENTRY = resolve(ROOT, "apps/api/dist/index.js");
const WEB_ENTRY = resolve(ROOT, "apps/web/dist/index.html");
const LAUNCH_AGENT_ID = "com.linkedin-brand-os.local";
const LAUNCH_AGENT_PATH = resolve(
  homedir(),
  "Library/LaunchAgents",
  `${LAUNCH_AGENT_ID}.plist`
);

const command = process.argv[2] ?? "start";

try {
  if (command === "start") {
    await startRuntime();
  } else if (command === "run") {
    await runForeground();
  } else if (command === "stop") {
    await stopRuntime();
  } else if (command === "restart") {
    await stopRuntime({ quiet: true });
    await startRuntime();
  } else if (command === "status") {
    await printStatus();
  } else if (command === "install-autostart") {
    installMacOsAutostart();
  } else if (command === "remove-autostart") {
    removeMacOsAutostart();
  } else {
    printUsage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function startRuntime() {
  ensureBuildArtifacts();
  ensureRuntimeDir();

  if (await isHealthy()) {
    writePidFile({ pid: readPidFile()?.pid ?? null });
    console.log(`LinkedIn Brand OS is already running at ${APP_URL}`);
    return;
  }

  cleanupStalePidFile();
  const outputFd = openSync(LOG_FILE, "a");

  const child = spawn(process.execPath, [API_ENTRY], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", outputFd, outputFd]
  });
  child.unref();

  writePidFile({ pid: child.pid });

  const ready = await waitForHealthy(15_000);
  if (!ready) {
    throw new Error(
      `Local runtime did not become healthy at ${HEALTH_URL}. Check ${LOG_FILE}.`
    );
  }

  console.log(`LinkedIn Brand OS started at ${APP_URL}`);

  // Auto-open browser to the frontend UI
  try {
    if (process.platform === "darwin") {
      spawn("open", [APP_URL], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "linux") {
      spawn("xdg-open", [APP_URL], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", APP_URL], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (error) {
    // Silently fail if browser open fails - not critical
  }
}

async function runForeground() {
  ensureBuildArtifacts();

  if (await isHealthy()) {
    console.log(`LinkedIn Brand OS is already running at ${APP_URL}`);
    return;
  }

  await import(pathToFileUrl(API_ENTRY));
}

async function stopRuntime(options = { quiet: false }) {
  const pidState = readPidFile();
  if (!pidState?.pid) {
    if (!options.quiet) {
      console.log("No local runtime pid file found.");
    }
    return;
  }

  if (isProcessAlive(pidState.pid)) {
    process.kill(pidState.pid, "SIGTERM");
  }

  rmSync(PID_FILE, { force: true });

  const stopped = await waitForUnhealthy(10_000);
  if (!options.quiet) {
    console.log(stopped ? "LinkedIn Brand OS stopped." : "Stop signal sent. Process may still be shutting down.");
  }
}

async function printStatus() {
  const healthy = await isHealthy();
  const pidState = readPidFile();

  if (healthy) {
    console.log(`running ${APP_URL}${pidState?.pid ? ` pid=${pidState.pid}` : ""}`);
    return;
  }

  console.log("not running");
}

function installMacOsAutostart() {
  if (process.platform !== "darwin") {
    throw new Error("Auto-start installer is only implemented for macOS.");
  }

  ensureBuildArtifacts();
  ensureRuntimeDir();
  mkdirSync(dirname(LAUNCH_AGENT_PATH), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${resolve(ROOT, "scripts/local-runtime.mjs")}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
`;

  writeFileSync(LAUNCH_AGENT_PATH, plist);
  spawnSync("launchctl", ["unload", LAUNCH_AGENT_PATH], { stdio: "ignore" });
  const loadResult = spawnSync("launchctl", ["load", "-w", LAUNCH_AGENT_PATH], {
    stdio: "inherit"
  });
  if (loadResult.status !== 0) {
    throw new Error(`Failed to load LaunchAgent ${LAUNCH_AGENT_PATH}.`);
  }

  console.log(`Auto-start installed: ${LAUNCH_AGENT_PATH}`);
}

function removeMacOsAutostart() {
  if (process.platform !== "darwin") {
    throw new Error("Auto-start remover is only implemented for macOS.");
  }

  if (!existsSync(LAUNCH_AGENT_PATH)) {
    console.log("Auto-start is not installed.");
    return;
  }

  spawnSync("launchctl", ["unload", LAUNCH_AGENT_PATH], { stdio: "ignore" });
  rmSync(LAUNCH_AGENT_PATH, { force: true });
  console.log("Auto-start removed.");
}

function ensureBuildArtifacts() {
  if (existsSync(API_ENTRY) && existsSync(WEB_ENTRY)) {
    return;
  }

  const result = spawnSync("pnpm", ["build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error("Build failed while preparing the local runtime.");
  }
}

function ensureRuntimeDir() {
  mkdirSync(RUNTIME_DIR, { recursive: true });
}

function cleanupStalePidFile() {
  const pidState = readPidFile();
  if (!pidState?.pid) {
    return;
  }

  if (!isProcessAlive(pidState.pid)) {
    rmSync(PID_FILE, { force: true });
  }
}

function readPidFile() {
  if (!existsSync(PID_FILE)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(PID_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writePidFile({ pid }) {
  ensureRuntimeDir();
  writeFileSync(
    PID_FILE,
    JSON.stringify(
      {
        pid,
        url: APP_URL,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isHealthy() {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthy()) {
      return true;
    }
    await sleep(300);
  }
  return false;
}

async function waitForUnhealthy(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isHealthy())) {
      return true;
    }
    await sleep(300);
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function pathToFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function printUsage() {
  console.log("Usage: pnpm local:start | local:stop | local:status | local:restart | local:install-autostart | local:remove-autostart");
}
