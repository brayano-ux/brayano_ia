import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { aiSettingsRoute } from "./ai-settings.route.js";
import { authRoute } from "./auth.route.js";

describe("authRoute", () => {
  it("authenticates valid credentials and returns a JWT-like token", async () => {
    const app = Fastify();
    await app.register(authRoute);

    const response = await app.inject({
      method: "POST",
      url: "/login",
      payload: { email: "admin@brayano.ai", password: "brayano123" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { email: "admin@brayano.ai" },
    });
    expect(response.json().token).toBeTypeOf("string");
    expect(response.json().organizationId).toBeTypeOf("string");
  });

  it("rejects invalid credentials", async () => {
    const app = Fastify();
    await app.register(authRoute);

    const response = await app.inject({
      method: "POST",
      url: "/login",
      payload: { email: "admin@brayano.ai", password: "wrong-pass" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      message: "Email ou mot de passe incorrect.",
    });
  });

  it("stores the configured AI response delay", async () => {
    const org = await prisma.organization.create({ data: { name: "Org test delay" } });
    await prisma.aiSettings.create({
      data: {
        organizationId: org.id,
        agentName: "Assistant test",
        systemPrompt: "Réponds simplement.",
      },
    });

    const app = Fastify();
    await app.register(aiSettingsRoute);

    const response = await app.inject({
      method: "PUT",
      url: `/organizations/${org.id}/ai-settings`,
      payload: { responseDelaySeconds: 7 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().settings.responseDelaySeconds).toBe(7);
  });
});
