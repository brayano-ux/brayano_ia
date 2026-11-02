import Fastify, { type FastifyRequest } from "fastify";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { CHARIOW_PULSE_SECRET: "whsec_test_secret" as string | undefined },
  create: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("../config/env.js", () => ({ env: mocks.env }));
vi.mock("../database/client.js", () => ({
  prisma: { chariowPulseDelivery: { create: mocks.create, findUnique: mocks.findUnique } },
}));

import { chariowWebhookRoute } from "./chariow-webhook.route.js";

const SECRET = "whsec_test_secret";

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Reproduit uniquement la part JSON du parseur de `app.ts`, qui pose `request.rawBody`. */
async function createApp() {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = Buffer.from(body as Buffer);
    done(null, {});
  });
  await app.register(chariowWebhookRoute);
  return app;
}

function post(app: Awaited<ReturnType<typeof createApp>>, body: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/billing/chariow/pulse",
    headers: { "content-type": "application/json", ...headers },
    payload: body,
  });
}

const VALID_HEADERS = { "x-pulse-delivery-id": "del-1", "x-pulse-id": "pulse-1", "x-pulse-event": "successful.sale" };
const VALID_BODY = JSON.stringify({ sale: { id: "sale-1" } });

describe("POST /billing/chariow/pulse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.CHARIOW_PULSE_SECRET = SECRET;
  });

  it("refuse si le secret du Pulse n'est pas configuré", async () => {
    mocks.env.CHARIOW_PULSE_SECRET = undefined;
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { "x-chariow-signature": sign(VALID_BODY), ...VALID_HEADERS });
      expect(response.statusCode).toBe(503);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse une signature manquante ou mal formée", async () => {
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { ...VALID_HEADERS });
      expect(response.statusCode).toBe(401);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse une signature dont le HMAC ne correspond pas au corps reçu", async () => {
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, {
        "x-chariow-signature": sign(VALID_BODY, "wrong_secret"),
        ...VALID_HEADERS,
      });
      expect(response.statusCode).toBe(401);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse une notification à laquelle il manque un en-tête Pulse", async () => {
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, {
        "x-chariow-signature": sign(VALID_BODY),
        "x-pulse-delivery-id": "del-1",
        "x-pulse-id": "pulse-1",
        // x-pulse-event manquant
      });
      expect(response.statusCode).toBe(400);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse un corps dont la signature est valide mais qui n'est pas du JSON", async () => {
    const body = "ceci n'est pas du json";
    const app = await createApp();
    try {
      const response = await post(app, body, { "x-chariow-signature": sign(body), ...VALID_HEADERS });
      expect(response.statusCode).toBe(400);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse un JSON valide qui n'est pas un objet (ex. un tableau)", async () => {
    const body = JSON.stringify([1, 2, 3]);
    const app = await createApp();
    try {
      const response = await post(app, body, { "x-chariow-signature": sign(body), ...VALID_HEADERS });
      expect(response.statusCode).toBe(400);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("enregistre une notification valide et renvoie received:true", async () => {
    mocks.create.mockResolvedValue({ id: "row-1" });
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { "x-chariow-signature": sign(VALID_BODY), ...VALID_HEADERS });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true, duplicate: false });
      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          deliveryId: "del-1",
          pulseId: "pulse-1",
          event: "successful.sale",
          payload: { sale: { id: "sale-1" } },
        },
      });
    } finally {
      await app.close();
    }
  });

  it("répond 200 sans ré-enregistrer quand Chariow réessaie le même delivery ID", async () => {
    mocks.create.mockRejectedValue(new Error("unique constraint failed"));
    mocks.findUnique.mockResolvedValue({ id: "row-1", deliveryId: "del-1" });
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { "x-chariow-signature": sign(VALID_BODY), ...VALID_HEADERS });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true, duplicate: true });
      expect(mocks.findUnique).toHaveBeenCalledWith({ where: { deliveryId: "del-1" } });
    } finally {
      await app.close();
    }
  });

  it("répond 503 quand l'enregistrement échoue pour une vraie raison (pas un doublon)", async () => {
    mocks.create.mockRejectedValue(new Error("connexion base de données perdue"));
    mocks.findUnique.mockResolvedValue(null);
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { "x-chariow-signature": sign(VALID_BODY), ...VALID_HEADERS });
      expect(response.statusCode).toBe(503);
      expect(response.json().received).toBe(false);
    } finally {
      await app.close();
    }
  });
});
