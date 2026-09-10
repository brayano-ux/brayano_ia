import Fastify from "fastify";
import { describe, expect, it } from "vitest";
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
});
