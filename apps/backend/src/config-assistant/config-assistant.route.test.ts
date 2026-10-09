import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suspended: { suspended: false, reason: null as string | null, suspendedAt: null },
  generate: vi.fn(),
}));
vi.mock("../organizations/platform-suspension.service.js", () => ({ getPlatformSuspension: async () => mocks.suspended }));
vi.mock("../ai/ai.factory.js", () => ({
  getRawProviders: () => [{ name: "fake", transcribeAudio: async () => "", generateResponse: mocks.generate }],
}));

import { AppError } from "../shared/errors.js";
import { configAssistantRoute } from "./config-assistant.route.js";

async function build() {
  const app = Fastify();
  app.addContentTypeParser("application/pdf", { parseAs: "buffer" }, (_r, body, done) => done(null, body));
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) reply.status(error.statusCode).send({ error: error.code, message: error.message });
    else reply.status(500).send({ message: "boom" });
  });
  await app.register(configAssistantRoute);
  return app;
}

describe("config assistant routes", () => {
  beforeEach(() => {
    mocks.suspended = { suspended: false, reason: null, suspendedAt: null };
    mocks.generate.mockReset();
    mocks.generate.mockResolvedValue({
      rawText: JSON.stringify({ name: { value: "Salon Zoé", quote: "Salon Zoé" }, phones: [{ value: "699 00 00 00", quote: "Salon Zoé" }] }),
      latencyMs: 1,
    });
  });

  it("returns a draft built only from verifiable facts and saves nothing", async () => {
    const app = await build();
    const response = await app.inject({
      method: "POST",
      url: "/organizations/org-route-1/config-assistant/analyze",
      payload: { kind: "text", text: "Bienvenue au Salon Zoé, coiffure à Douala, ouvert tous les jours." },
    });
    expect(response.statusCode).toBe(200);
    const { analysis } = response.json();
    expect(analysis.businessInfo).toContain("Salon Zoé");
    expect(analysis.businessInfo).not.toContain("699"); // numéro inventé retiré
    expect(analysis.missing).toContain("Adresse");
  });

  it("refuses to run for a suspended company", async () => {
    mocks.suspended = { suspended: true, reason: "Impayé", suspendedAt: null };
    const app = await build();
    const response = await app.inject({ method: "POST", url: "/organizations/org-route-2/config-assistant/analyze", payload: { kind: "text", text: "x".repeat(50) } });
    expect(response.statusCode).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects local addresses sent as a website", async () => {
    const app = await build();
    const response = await app.inject({ method: "POST", url: "/organizations/org-route-3/config-assistant/analyze", payload: { kind: "url", url: "http://169.254.169.254/latest/meta-data/" } });
    expect(response.statusCode).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects an invalid body and a non-PDF upload", async () => {
    const app = await build();
    expect((await app.inject({ method: "POST", url: "/organizations/org-route-4/config-assistant/analyze", payload: { kind: "nope" } })).statusCode).toBe(400);
    const pdf = await app.inject({ method: "POST", url: "/organizations/org-route-4/config-assistant/analyze-pdf", headers: { "content-type": "application/pdf" }, payload: Buffer.from("ceci n'est pas un pdf") });
    expect(pdf.statusCode).toBe(400);
  });
});
