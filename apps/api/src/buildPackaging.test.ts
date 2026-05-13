import { describe, expect, it } from "vitest";
import type { Options } from "tsup";
import config, { internalWorkspaceNoExternal } from "../tsup.config";

describe("API packaged build config", () => {
  it("bundles internal workspace packages so the built API does not depend on raw TypeScript exports at runtime", () => {
    expect(internalWorkspaceNoExternal).toEqual(
      expect.arrayContaining([
        "@linkedin-brand-os/shared",
        "@linkedin-brand-os/db",
        "@linkedin-brand-os/orchestrator",
        "@linkedin-brand-os/agent-services",
        "@linkedin-brand-os/ai-providers",
        "@linkedin-brand-os/prompts"
      ])
    );
  });

  it("keeps better-sqlite3 external so the packaged ESM API can boot under plain Node", () => {
    const normalized = (Array.isArray(config) ? config[0] : config) as Options;
    expect(normalized.external).toEqual(expect.arrayContaining(["better-sqlite3"]));
  });
});
