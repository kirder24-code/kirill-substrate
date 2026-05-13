import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx"
    ],
    environmentMatchGlobs: [["apps/web/**/*.test.tsx", "jsdom"]],
    setupFiles: ["apps/web/src/test-setup.ts", "apps/api/src/test-setup.ts"]
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "@linkedin-brand-os/shared": path.resolve(
        __dirname,
        "packages/shared/src/index.ts"
      ),
      "@linkedin-brand-os/orchestrator": path.resolve(
        __dirname,
        "packages/orchestrator/src/index.ts"
      ),
      "@linkedin-brand-os/agent-services": path.resolve(
        __dirname,
        "packages/agent-services/src/index.ts"
      ),
      "@linkedin-brand-os/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@linkedin-brand-os/prompts": path.resolve(
        __dirname,
        "packages/prompts/src/index.ts"
      ),
      "@linkedin-brand-os/ai-providers": path.resolve(
        __dirname,
        "packages/ai-providers/src/index.ts"
      )
    }
  }
});
