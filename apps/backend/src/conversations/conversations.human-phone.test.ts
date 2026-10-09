import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messageFindUnique: vi.fn(),
  messageCreate: vi.fn(),
  conversationFindMany: vi.fn(),
  conversationCreate: vi.fn(),
  conversationUpdate: vi.fn(),
  findOrCreateContact: vi.fn(),
}));
vi.mock("../database/client.js", () => ({
  prisma: {
    message: { findUnique: mocks.messageFindUnique, create: mocks.messageCreate },
    conversation: { findMany: mocks.conversationFindMany, create: mocks.conversationCreate, update: mocks.conversationUpdate },
  },
}));
vi.mock("../contacts/contacts.service.js", () => ({ findOrCreateContact: mocks.findOrCreateContact }));

import { recordHumanReplyFromPhone, shouldReactivateAiAfterHandoff } from "./conversations.service.js";

const input = { organizationId: "org-1", toJid: "237600000000@s.whatsapp.net", externalId: "WA-1", text: "Je m'en occupe", timestamp: new Date("2026-10-09T10:00:00Z") };

describe("recordHumanReplyFromPhone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageFindUnique.mockResolvedValue(null);
    mocks.findOrCreateContact.mockResolvedValue({ id: "contact-1" });
    mocks.conversationFindMany.mockResolvedValue([{ id: "conv-1", status: "OPEN", aiEnabled: true }]);
    mocks.conversationUpdate.mockResolvedValue({});
    mocks.messageCreate.mockResolvedValue({});
  });

  it("pauses the AI for an unqualified prospect and records the human message", async () => {
    await expect(recordHumanReplyFromPhone(input)).resolves.toEqual({ duplicate: false, aiPaused: true });
    expect(mocks.messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: "conv-1", direction: "OUTBOUND", author: "HUMAN", content: "Je m'en occupe", externalId: "WA-1" }),
    });
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: expect.objectContaining({ aiEnabled: false, status: "HUMAN_HANDOFF", updatedAt: expect.any(Date) }),
    });
  });

  it("restarts the 24 hour countdown on every new human message", async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: "conv-1", status: "HUMAN_HANDOFF", aiEnabled: false }]);
    await recordHumanReplyFromPhone(input);
    expect(mocks.conversationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ updatedAt: expect.any(Date) }) }));
  });

  it("keeps a closed conversation closed but records the message", async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: "conv-1", status: "CLOSED", aiEnabled: false }]);
    await expect(recordHumanReplyFromPhone(input)).resolves.toEqual({ duplicate: false, aiPaused: false });
    expect(mocks.messageCreate).toHaveBeenCalled();
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
  });

  it("uses a placeholder for media without caption", async () => {
    await recordHumanReplyFromPhone({ ...input, text: null });
    expect(mocks.messageCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ content: "[Message envoyé depuis le téléphone]" }) });
  });

  it("ignores a message that was already recorded", async () => {
    mocks.messageFindUnique.mockResolvedValue({ id: "m" });
    await expect(recordHumanReplyFromPhone(input)).resolves.toEqual({ duplicate: true, aiPaused: false });
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
  });

  it("starts a handoff conversation when the human writes first to a new contact", async () => {
    mocks.conversationFindMany.mockResolvedValue([]);
    mocks.conversationCreate.mockResolvedValue({ id: "conv-new", status: "OPEN", aiEnabled: true });
    await recordHumanReplyFromPhone(input);
    expect(mocks.conversationUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conv-new" } }));
  });
});

describe("the 24 hour rule", () => {
  it("keeps the AI paused before 24 hours and resumes after", () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    expect(shouldReactivateAiAfterHandoff(hoursAgo(23.9))).toBe(false);
    expect(shouldReactivateAiAfterHandoff(hoursAgo(24.1))).toBe(true);
  });
});
