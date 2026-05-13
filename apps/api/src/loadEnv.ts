import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ENV_FILES = [
  ".env",
  ".env.local",
  "apps/api/.env",
  "apps/api/.env.local"
];

export function loadBackendEnvFiles(
  cwd: string = process.cwd(),
  fileNames: string[] = DEFAULT_ENV_FILES
): void {
  const externalKeys = new Set(Object.keys(process.env));

  for (const fileName of fileNames) {
    const filePath = resolve(cwd, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const parsed = parseEnvFile(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!externalKeys.has(key)) {
        process.env[key] = value;
      }
    }
  }
}

function parseEnvFile(input: string): Record<string, string> {
  return input.split(/\r?\n/).reduce<Record<string, string>>((env, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return env;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return env;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      return env;
    }

    env[key] = unquote(rawValue);
    return env;
  }, {});
}

function unquote(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
