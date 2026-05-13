import { defineConfig } from "@playwright/test";

const apiPort = 4000;
const webPort = 5173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    trace: "on-first-retry"
  },
  webServer: [
    {
      command:
        "OPERATOR_USERNAME=operator OPERATOR_PASSWORD=operator-pass CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173 node apps/api/dist/index.js",
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command:
        "VITE_API_BASE_URL=http://127.0.0.1:4000 pnpm --filter @linkedin-brand-os/web exec vite --host 127.0.0.1 --port 5173",
      url: `http://127.0.0.1:${webPort}/`,
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
