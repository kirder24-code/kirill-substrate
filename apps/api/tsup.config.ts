import { defineConfig } from "tsup";

export const internalWorkspaceNoExternal = [
  "@linkedin-brand-os/shared",
  "@linkedin-brand-os/db",
  "@linkedin-brand-os/orchestrator",
  "@linkedin-brand-os/agent-services",
  "@linkedin-brand-os/ai-providers",
  "@linkedin-brand-os/prompts"
] as const;

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  noExternal: [...internalWorkspaceNoExternal],
  external: ["better-sqlite3"]
});
