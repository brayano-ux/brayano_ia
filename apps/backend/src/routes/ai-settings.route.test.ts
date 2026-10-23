import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../shared/errors.js";

const mocks = vi.hoisted(() => ({ getOrCreateAiSettings: vi.fn(), updateAiSettings: vi.fn(), getPlatformSuspension: vi.fn() }));
vi.mock("../ai/ai-settings.service.js", () => mocks);
vi.mock("../organizations/platform-suspension.service.js", () => ({ getPlatformSuspension: mocks.getPlatformSuspension }));

import { aiSettingsRoute } from "./ai-settings.route.js";

async function createApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) reply.status(error.statusCode).send({ message: error.message });
    else reply.status(500).send({ message: String(error) });
  });
  await app.register(aiSettingsRoute);
  return app;
}

describe("PUT /ai-settings : horaires et relances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAiSettings.mockResolvedValue({ id: "settings-1" });
  });

  it("transmet les horaires d'ouverture et les réglages de relance", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "PUT",
      url: "/organizations/org-1/ai-settings",
      payload: {
        businessHoursEnabled: true,
        businessHours: { mon: [{ start: "08:00", end: "18:00" }], sat: [{ start: "08:00", end: "13:00" }] },
        businessTimezone: "Africa/Douala",
        closedMessage: "Proposer de laisser un message.",
        followUpEnabled: true,
        followUpDelayHours: 24,
        followUpMax: 2,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.updateAiSettings).toHaveBeenCalledWith("org-1", {
      businessHoursEnabled: true,
      businessHours: { mon: [{ start: "08:00", end: "18:00" }], sat: [{ start: "08:00", end: "13:00" }] },
      businessTimezone: "Africa/Douala",
      closedMessage: "Proposer de laisser un message.",
      followUpEnabled: true,
      followUpDelayHours: 24,
      followUpMax: 2,
    });
    await app.close();
  });

  it.each([
    ["un fuseau inconnu", { businessTimezone: "Mars/Olympus" }],
    ["une heure invalide", { businessHours: { mon: [{ start: "25:00", end: "26:00" }] } }],
    ["une plage à l'envers", { businessHours: { mon: [{ start: "18:00", end: "08:00" }] } }],
    ["plus de 2 relances", { followUpMax: 3 }],
    ["un délai de relance trop court", { followUpDelayHours: 1 }],
  ])("refuse %s", async (_label, payload) => {
    const app = await createApp();
    const response = await app.inject({ method: "PUT", url: "/organizations/org-1/ai-settings", payload });
    expect(response.statusCode).toBe(400);
    expect(mocks.updateAiSettings).not.toHaveBeenCalled();
    await app.close();
  });
});


describe("PUT /ai-settings : informations d’entreprise longues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAiSettings.mockImplementation(async (_orgId, input) => ({ id: "settings-1", ...input }));
  });

  it.each([8_001, 50_000])("enregistre et retourne %i caractères sans couper la fin", async (length) => {
    const ending = "Conditions finales : FIN.";
    const businessInfo = "Présentation : école de formation à Douala.\n".repeat(1_200).slice(0, length - ending.length) + ending;
    expect(businessInfo).toHaveLength(length);
    const app = await createApp();
    try {
      const response = await app.inject({ method: "PUT", url: "/organizations/org-1/ai-settings", payload: { businessInfo } });
      expect(response.statusCode).toBe(200);
      expect(mocks.updateAiSettings).toHaveBeenCalledWith("org-1", { businessInfo });
      expect(response.json().settings.businessInfo).toBe(businessInfo);
    } finally {
      await app.close();
    }
  });

  it("refuse un dépassement sans écrire ni tronquer les informations", async () => {
    const app = await createApp();
    try {
      const response = await app.inject({ method: "PUT", url: "/organizations/org-1/ai-settings", payload: { businessInfo: "é".repeat(50_001) } });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain("50 000");
      expect(mocks.updateAiSettings).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
