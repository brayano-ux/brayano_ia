import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getConversationWithMessages: vi.fn(),
    listConversationSummaries: vi.fn(),
    markConversationRead: vi.fn(),
    setConversationStage: vi.fn(),
    listProspectsForExport: vi.fn(),
    recordOutboundMessage: vi.fn(),
    setConversationAiEnabled: vi.fn(),
    shouldReactivateAiAfterHandoff: vi.fn(),
    sendWhatsAppMessageForOrg: vi.fn(),
  },
}));

vi.mock("../conversations/conversations.service.js", () => mocks);
vi.mock("../whatsapp/whatsapp.registry.js", () => ({ sendWhatsAppMessageForOrg: mocks.sendWhatsAppMessageForOrg }));

vi.mock("../database/client.js", () => ({ prisma: { message: { findFirst: vi.fn() } } }));

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

  it("returns the conversation list as light summaries with the stage labels", async () => {
    mocks.listConversationSummaries.mockResolvedValue([{ id: "conversation-1", stage: "INTERESTED" }]);
    const app = await createApp();

    const response = await app.inject({ method: "GET", url: "/organizations/org-1/conversations?stage=INTERESTED&q=amina" });

    expect(response.statusCode).toBe(200);
    expect(mocks.listConversationSummaries).toHaveBeenCalledWith("org-1", { stage: "INTERESTED", search: "amina" });
    expect(response.json().stageLabels.CALLBACK).toBe("À rappeler");
    await app.close();
  });

  it("rejects an unknown stage filter", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/organizations/org-1/conversations?stage=VIP" });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("adds a signed link to the messages that have a file, without leaking the stored file name", async () => {
    mocks.getConversationWithMessages.mockResolvedValue({
      ...handoffConversation,
      messages: [{ id: "m1", content: "[Photo reçue]", type: "IMAGE", mediaFile: "22222222-2222-2222-2222-222222222222.jpg" }, { id: "m2", content: "Bonjour", mediaFile: null }],
    });
    const app = await createApp();

    const response = await app.inject({ method: "GET", url: "/organizations/org-1/conversations/conversation-1" });
    const [photo, text] = response.json().conversation.messages;

    expect(photo.mediaUrl).toMatch(/^\/media\/client\/org-1\/22222222-2222-2222-2222-222222222222\.jpg\?t=\d+:[0-9a-f]{64}$/);
    expect(photo.mediaFile).toBeUndefined();
    expect(text.mediaUrl).toBeNull();
    await app.close();
  });

  it("lets the owner set a stage by hand or give the choice back to the assistant", async () => {
    mocks.setConversationStage.mockResolvedValue({ id: "conversation-1", stage: "CALLBACK", stageLocked: true });
    const app = await createApp();

    const set = await app.inject({ method: "POST", url: "/organizations/org-1/conversations/conversation-1/stage", payload: { stage: "CALLBACK" } });
    const auto = await app.inject({ method: "POST", url: "/organizations/org-1/conversations/conversation-1/stage", payload: { stage: "AUTO" } });
    const invalid = await app.inject({ method: "POST", url: "/organizations/org-1/conversations/conversation-1/stage", payload: { stage: "VIP" } });

    expect(set.statusCode).toBe(200);
    expect(auto.statusCode).toBe(200);
    expect(invalid.statusCode).toBe(400);
    expect(mocks.setConversationStage).toHaveBeenNthCalledWith(1, "org-1", "conversation-1", "CALLBACK");
    expect(mocks.setConversationStage).toHaveBeenNthCalledWith(2, "org-1", "conversation-1", "AUTO");
    await app.close();
  });

  it("refuses a client file without a valid signed token", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/media/client/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg?t=1:abc" });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
