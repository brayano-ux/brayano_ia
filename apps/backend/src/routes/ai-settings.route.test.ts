import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, PlanLimitError } from "../shared/errors.js";

const mocks = vi.hoisted(() => ({ getOrCreateAiSettings: vi.fn(), updateAiSettings: vi.fn(), getPlatformSuspension: vi.fn(), assertFeature: vi.fn() }));
vi.mock("../ai/ai-settings.service.js", () => mocks);
vi.mock("../organizations/platform-suspension.service.js", () => ({ getPlatformSuspension: mocks.getPlatformSuspension }));
vi.mock("../billing/subscription.service.js", () => ({ assertFeature: mocks.assertFeature }));

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
    mocks.assertFeature.mockResolvedValue(undefined);
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

  it("refuse d'activer les relances quand le forfait ne les inclut pas", async () => {
    mocks.assertFeature.mockRejectedValue(
      new PlanLimitError("Les relances automatiques ne sont pas incluses dans votre forfait actuel. Elles sont disponibles à partir du forfait Pro (page « Mon forfait »)."),
    );
    const app = await createApp();
    try {
      const response = await app.inject({ method: "PUT", url: "/organizations/org-1/ai-settings", payload: { followUpEnabled: true } });
      expect(response.statusCode).toBe(402);
      expect(response.json().message).toContain("forfait Pro");
      expect(mocks.assertFeature).toHaveBeenCalledWith("org-1", "followUps");
      expect(mocks.updateAiSettings).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("n'appelle pas assertFeature quand on désactive les relances ou qu'on ne touche pas au réglage", async () => {
    const app = await createApp();
    try {
      await app.inject({ method: "PUT", url: "/organizations/org-1/ai-settings", payload: { followUpEnabled: false } });
      await app.inject({ method: "PUT", url: "/organizations/org-1/ai-settings", payload: { followUpMax: 2 } });
      expect(mocks.assertFeature).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("laisse passer l'activation des relances quand le forfait les inclut", async () => {
    const app = await createApp();
    try {
      const response = await app.inject({ method: "PUT", url: "/organizations/org-1/ai-settings", payload: { followUpEnabled: true } });
      expect(response.statusCode).toBe(200);
      expect(mocks.assertFeature).toHaveBeenCalledWith("org-1", "followUps");
      expect(mocks.updateAiSettings).toHaveBeenCalledWith("org-1", { followUpEnabled: true });
    } finally {
      await app.close();
    }
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

describe("PUT /ai-settings : remise maximale de la négociation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAiSettings.mockResolvedValue({ id: "settings-1" });
    mocks.getOrCreateAiSettings.mockResolvedValue({ negotiationMaxDiscountAmount: null });
    mocks.assertFeature.mockResolvedValue(undefined);
  });

  async function put(payload: object) {
    const app = await createApp();
    try {
      return await app.inject({ method: "PUT", url: "/organizations/org-1/ai-settings", payload });
    } finally {
      await app.close();
    }
  }

  it("enregistre une remise en montant fixe saisie par le marchand", async () => {
    const response = await put({ negotiationEnabled: true, negotiationDiscountMode: "amount", negotiationMaxDiscountAmount: 2000 });
    expect(response.statusCode).toBe(200);
    expect(mocks.updateAiSettings).toHaveBeenCalledWith("org-1", expect.objectContaining({ negotiationDiscountMode: "amount", negotiationMaxDiscountAmount: 2000 }));
  });

  it("enregistre un pourcentage saisi librement entre 1 et 50", async () => {
    const response = await put({ negotiationEnabled: true, negotiationDiscountMode: "percent", negotiationMaxDiscountPercent: 12 });
    expect(response.statusCode).toBe(200);
    expect(mocks.updateAiSettings).toHaveBeenCalledWith("org-1", expect.objectContaining({ negotiationDiscountMode: "percent", negotiationMaxDiscountPercent: 12 }));
  });

  it("refuse le mode montant fixe sans montant", async () => {
    const response = await put({ negotiationEnabled: true, negotiationDiscountMode: "amount", negotiationMaxDiscountAmount: null });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("montant maximal");
    expect(mocks.updateAiSettings).not.toHaveBeenCalled();
  });

  it("accepte de passer en montant fixe quand un montant est déjà enregistré", async () => {
    mocks.getOrCreateAiSettings.mockResolvedValue({ negotiationMaxDiscountAmount: 3000 });
    const response = await put({ negotiationDiscountMode: "amount" });
    expect(response.statusCode).toBe(200);
  });

  it("refuse un montant trop faible, un montant à virgule et un pourcentage hors limites", async () => {
    expect((await put({ negotiationMaxDiscountAmount: 50 })).statusCode).toBe(400);
    expect((await put({ negotiationMaxDiscountAmount: 1500.5 })).statusCode).toBe(400);
    expect((await put({ negotiationMaxDiscountPercent: 80 })).statusCode).toBe(400);
    expect((await put({ negotiationMaxDiscountPercent: 0 })).statusCode).toBe(400);
  });
});
