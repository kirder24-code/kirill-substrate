import { fileURLToPath } from "node:url";
import {
  executeMiraiLocalTask,
  probeMiraiLocalRuntime
} from "./mirai-local-runtime.mjs";

export async function handleMiraiLocalRequest(
  payload,
  options = { env: process.env }
) {
  const env = options.env ?? process.env;

  if (!payload || typeof payload !== "object") {
    return toErrorResponse("INVALID_REQUEST", "Request body must be a JSON object.");
  }

  if (payload.action === "probe") {
    const availability = await probeMiraiLocalRuntime(env);
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(availability)}\n`,
      stderr: ""
    };
  }

  if (payload.action !== "generate") {
    return toErrorResponse(
      "INVALID_REQUEST",
      "Request action must be 'probe' or 'generate'."
    );
  }

  const result = await executeMiraiLocalTask(payload, env);
  if (!result.ok) {
    return toErrorResponse(result.error.code, result.error.message);
  }

  return {
    exitCode: 0,
    stdout: `${JSON.stringify({ output: result.output })}\n`,
    stderr: ""
  };
}

export async function runMiraiLocalEntrypoint() {
  try {
    const stdin = await readStdin();
    const payload = safeParseJson(stdin);

    if (payload === null) {
      const response = toErrorResponse(
        "INVALID_REQUEST",
        "Request body must be valid JSON."
      );
      writeResponse(response);
      process.exitCode = response.exitCode;
      return;
    }

    const response = await handleMiraiLocalRequest(payload, {
      env: process.env
    });
    writeResponse(response);
    process.exitCode = response.exitCode;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Mirai entrypoint failure.";
    const response = toErrorResponse("UNEXPECTED_ERROR", message);
    writeResponse(response);
    process.exitCode = response.exitCode;
  }
}

function writeResponse(response) {
  if (response.stdout) {
    process.stdout.write(response.stdout);
  }
  if (response.stderr) {
    process.stderr.write(response.stderr);
  }
}

function toErrorResponse(code, message) {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${JSON.stringify({
      error: {
        code,
        message
      }
    })}\n`
  };
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      resolve(input);
    });
    process.stdin.on("error", (error) => {
      reject(error);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runMiraiLocalEntrypoint();
}
