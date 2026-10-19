import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Les tests d'intégration (INTEGRATION_DB=1) partagent UNE base : ils ne doivent pas tourner en parallèle.
    fileParallelism: process.env.INTEGRATION_DB !== "1",
  },
});
