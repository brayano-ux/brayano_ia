import { describe, expect, it } from "vitest";
import { isAllowedForRole } from "./permissions.js";

const org = "/organizations/11111111-1111-1111-1111-111111111111";

describe("isAllowedForRole", () => {
  it("laisse tout faire au propriétaire", () => {
    for (const [method, url] of [["PUT", `${org}/ai-settings`], ["POST", `${org}/whatsapp/disconnect`], ["POST", `${org}/broadcasts`], ["GET", `${org}/team`], ["DELETE", `${org}/products/x`]]) {
      expect(isAllowedForRole("ADMIN", method!, url!)).toBe(true);
    }
  });

  it.each([
    ["GET", "/me"],
    ["GET", "/organizations"],
    ["GET", `${org}/conversations`],
    ["GET", `${org}/conversations?stage=NEW&q=amina`],
    ["GET", `${org}/conversations/abc`],
    ["GET", `${org}/orders`],
    ["GET", `${org}/orders?payment=UNPAID`],
    ["GET", `${org}/appointments?from=2026-10-01`],
    ["GET", `${org}/products`],
    ["GET", `${org}/stats?days=7`],
    ["GET", `${org}/whatsapp/status`],
    ["GET", `${org}/routing/commercial-metrics`],
    ["POST", `${org}/conversations/abc/reply`],
    ["POST", `${org}/conversations/abc/read`],
    ["POST", `${org}/conversations/abc/stage`],
    ["POST", `${org}/conversations/abc/opt-out`],
    ["POST", `${org}/conversations/abc/payment-check`],
    ["POST", `${org}/conversations/abc/ai/enable`],
    ["POST", `${org}/conversations/abc/ai/disable`],
    ["POST", `${org}/conversations/abc/messages/def/correct`],
    ["POST", `${org}/ai-test/reply`],
    ["PUT", `${org}/orders/abc`],
    ["PUT", `${org}/orders/abc/payment`],
    ["POST", `${org}/appointments`],
    ["PUT", `${org}/appointments/abc`],
  ])("laisse l'employé faire %s %s", (method, url) => {
    expect(isAllowedForRole("AGENT", method, url)).toBe(true);
  });

  it.each([
    ["PUT", `${org}/ai-settings`],
    ["GET", `${org}/ai-settings`],
    ["GET", `${org}/onboarding`],
    ["POST", `${org}/whatsapp/connect`],
    ["POST", `${org}/whatsapp/disconnect`],
    ["GET", `${org}/whatsapp/qr`],
    ["GET", `${org}/whatsapp/pairing-code`],
    ["POST", `${org}/products`],
    ["PUT", `${org}/products/abc`],
    ["DELETE", `${org}/products/abc`],
    ["POST", `${org}/products/abc/image`],
    ["PUT", `${org}/orders/settings`],
    ["PUT", `${org}/appointments/settings`],
    ["POST", `${org}/broadcasts`],
    ["GET", `${org}/broadcasts`],
    ["GET", `${org}/team`],
    ["POST", `${org}/team`],
    ["PUT", `${org}/ai-corrections/abc`],
    ["DELETE", `${org}/ai-corrections/abc`],
    ["POST", `${org}/config-assistant/analyze`],
    ["POST", `${org}/support-assistant/chat`],
    ["PUT", `${org}/routing/fallback`],
    ["POST", `${org}/responsibles`],
    ["GET", `${org}/ignored-contacts`],
    ["POST", `${org}/ignored-contacts`],
    ["DELETE", `${org}/ignored-contacts/abc`],
    ["POST", `${org}/ai-settings/persona-seen`],
    ["GET", "/billing/account"],
    ["POST", "/billing/create-checkout"],
    ["POST", "/organizations"],
    ["DELETE", `${org}/conversations/abc`],
    ["GET", "/anything-else"],
  ])("refuse à l'employé %s %s", (method, url) => {
    expect(isAllowedForRole("AGENT", method, url)).toBe(false);
  });

  it("ne se laisse pas tromper par un identifiant d'entreprise glissé dans l'URL", () => {
    expect(isAllowedForRole("AGENT", "PUT", "/organizations/x/orders/settings?/orders/abc")).toBe(false);
    expect(isAllowedForRole("AGENT", "GET", "/health/organizations/x/orders")).toBe(false);
  });
});
