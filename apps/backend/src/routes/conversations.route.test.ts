import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getConversationWithMessages: vi.fn(),
    listConversations: vi.fn(),
    listProspectsForExport: vi.fn(),
    recordOutboundMessage: vi.fn(),
    setConversationAiEnabled: vi.fn(),
    shouldReactivateAiAfterHandoff: vi.fn(),
    sendWhatsAppMessageForOrg: vi.fn(),
  },
}));

vi.mock("../conversations/conversations.service.js", () => mocks);
vi.mock("../whatsapp/whatsapp.registry.js", () => ({ sendWhatsAppMessageForOrg: mocks.sendWhatsAppMessageForOrg }));

import { conversationsRoute } from "./conversations.route.js";

const handoffConversation = {
  id: "conversation-1",
  organizationId: "org-1",
  status: "HUMAN_HANDOFF",
  aiEnabled: false,
  updatedAt: new Date("2026-10-03T10:00:00.000Z"),
  contact: { whatsappJid: "contact@s.whatsapp.net" },
  messages: [],
};

async function createApp() {
  const app = Fastify();
  await app.register(conversationsRoute);
  return app;
}

describe("conversation handoff routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConversationWithMessages.mockResolvedValue(handoffConversation);
    mocks.setConversationAiEnabled.mockResolvedValue(handoffConversation);
    mocks.sendWhatsAppMessageForOrg.mockResolvedValue(undefined);
    mocks.recordOutboundMessage.mockResolvedValue({ id: "message-1", author: "HUMAN" });
  });

  it("disables the AI before sending a human reply", async () => {
    const order: string[] = [];
    mocks.setConversationAiEnabled.mockImplementation(async () => { order.push("disable"); return handoffConversation; });
    mocks.sendWhatsAppMessageForOrg.mockImplementation(async () => { order.push("send"); });
    mocks.recordOutboundMessage.mockImplementation(async () => { order.push("record"); return { id: "message-1" }; });
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/organizations/org-1/conversations/conversation-1/reply",
      payload: { text: "Je prends le relais." },
    });

    expect(response.statusCode).toBe(200);
    expect(order).toEqual(["disable", "send", "record"]);
    await app.close();
  });

  it("lets the owner reactivate the AI at any time, even right after a handoff", async () => {
    mocks.shouldReactivateAiAfterHandoff.mockReturnValue(false);
    mocks.setConversationAiEnabled.mockResolvedValue({ id: "conversation-1", aiEnabled: true, status: "OPEN" });
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/organizations/org-1/conversations/conversation-1/ai/enable",
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.setConversationAiEnabled).toHaveBeenCalledWith("conversation-1", true);
    await app.close();
  });
});
