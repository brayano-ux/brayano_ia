import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), reply: vi.fn(), mark: vi.fn() }));
vi.mock("./ai-settings.service.js", () => ({ getOrCreateAiSettings: mocks.settings }));
vi.mock("./ai.factory.js", () => ({ getAiOrchestrator: () => ({ getReply: mocks.reply }) }));
vi.mock("../onboarding/onboarding.service.js", () => ({ markAgentTested: mocks.mark }));
vi.mock("../appointments/appointments.service.js", () => ({ loadAgendaPrompt: vi.fn().mockResolvedValue(null), previewAiBooking: vi.fn() }));
vi.mock("../orders/orders.service.js", () => ({ loadOrderPrompt: vi.fn().mockResolvedValue(null), previewAiOrder: vi.fn() }));
vi.mock("../products/products.service.js", () => ({ listProductsForAssistant: vi.fn().mockResolvedValue([]) }));
vi.mock("./memory.service.js", () => ({ loadMemorySections: vi.fn().mockResolvedValue({ corrections: null, examples: null }) }));
import { simulateAssistantReply } from "./tester.service.js";
const input = { message: "Quels sont vos services ?", history: [] };
const reply = { reply: "Nous proposons des formations en bureautique.", intent: "information", needsHuman: false, qualificationStatus: "qualifying", leadScore: 20, leadData: {}, nextAction: "continue", productId: "" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ organizationId: "org-1", agentName: "Awa", businessInfo: "Formations en bureautique", systemPrompt: "Réponds aux questions", welcomeMessage: null, aiEnabled: true });
  mocks.reply.mockResolvedValue(reply);
  mocks.mark.mockResolvedValue(undefined);
});
describe("testeur et progression du démarrage", () => {
  it("valide les réglages après une réponse IA réussie", async () => {
    expect((await simulateAssistantReply("org-1", input)).reply).toContain("bureautique");
    expect(mocks.mark).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
  });
  it("ne valide pas un échec des fournisseurs IA", async () => {
    mocks.reply.mockResolvedValue({ ...reply, intent: "erreur_traitement", reply: "Merci pour votre message.", needsHuman: true });
    await simulateAssistantReply("org-1", input);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("conserve le résultat du test même si la progression ne peut pas être sauvegardée", async () => {
    mocks.mark.mockRejectedValue(new Error("indisponible"));
    expect((await simulateAssistantReply("org-1", input)).reply).toContain("bureautique");
  });
});
