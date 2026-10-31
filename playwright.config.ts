import { defineConfig, devices } from "@playwright/test";

function appServer(locale: "en" | "ja", port: number) {
  return {
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    env: {
      LOCALE: locale,
      // Relative to config/
      PROVIDERS_CONFIG: "../e2e/config/providers.yaml",
      FEATURES_CONFIG: "../e2e/config/features.yaml",
      // These would otherwise be read from .env
      LLM_PROVIDER: "ollama",
      TTS_PROVIDER: "voicevox",
      STT_PROVIDER: "web",
      // e2e/mock-backends.mjs empties this directory when it starts
      DATABASE_PATH: `e2e/.tmp/${locale}.db`,
    },
  };
}

export default defineConfig({
  testDir: "./e2e",
  // Tests share the mock's request log and the apps' databases
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    permissions: ["camera", "microphone"],
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/mock-backends.mjs",
      url: "http://127.0.0.1:11555/health",
    },
    appServer("en", 3100),
    appServer("ja", 3101),
  ],
});
