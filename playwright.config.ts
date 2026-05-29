import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
  },
});

