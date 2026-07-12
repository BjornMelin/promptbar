import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const host = process.env.PROMPTBAR_E2E_HOST ?? "::1";
if (!["::1", "127.0.0.1", "localhost"].includes(host)) {
  throw new Error("PROMPTBAR_E2E_HOST must be ::1, 127.0.0.1, or localhost");
}
const port = Number(process.env.PROMPTBAR_E2E_PORT ?? "4173");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PROMPTBAR_E2E_PORT must be an integer from 1 to 65535");
}
const urlHost = host.includes(":") ? `[${host}]` : host;
const baseURL = `http://${urlHost}:${port}`;
const runRoot = path.resolve(`test-results/e2e-${process.pid}`);
const runtimeRoot = path.join(runRoot, "runtime");
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  outputDir: path.join(runRoot, "artifacts"),
  workers: 1,
  reporter: [
    ["html", { open: "never", outputFolder: path.join(runRoot, "report") }],
    ["list"],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `bun run dev --hostname ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...inheritedEnv,
      PROMPTBAR_APP_ROOT: path.join(runtimeRoot, "app"),
      PROMPTBAR_DEFAULT_IMPORT_ROOT: path.join(runtimeRoot, "imports"),
      PROMPTBAR_OPENAI_API_KEY: "",
      PROMPTOPS_STATE_DIR: path.join(runtimeRoot, "promptops", "state"),
      PROMPTOPS_CONFIG_DIR: path.join(runtimeRoot, "promptops", "config"),
      PROMPTOPS_CACHE_DIR: path.join(runtimeRoot, "promptops", "cache"),
      PROMPTOPS_EMBED_API_KEY: "",
    },
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
