import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same aliases as tsconfig.json
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@plugins": fileURLToPath(new URL("./plugins", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
