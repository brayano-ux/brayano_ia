import { defineConfig } from "vitest/config";

const integration = process.env.INTEGRATION_DB === "1";

export default defineConfig({
  test: {
    // Les tests d'intégration (INTEGRATION_DB=1) partagent UNE base : ils ne doivent pas tourner en parallèle.
    fileParallelism: !integration,
    // Sur une CI chargée, vider la base entre deux tests peut dépasser les 10 s par défaut : on laisse de la marge.
    hookTimeout: integration ? 30_000 : 10_000,
    testTimeout: integration ? 30_000 : 5_000,
  },
});
