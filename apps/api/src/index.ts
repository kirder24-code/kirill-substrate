import { loadBackendEnvFiles } from "./loadEnv";
import { buildApp } from "./app";

loadBackendEnvFiles();

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  const app = await buildApp({ logger: true });
  await app.listen({ port, host });
} catch (error) {
  console.error(error);
  process.exit(1);
}
