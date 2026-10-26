import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { createTestOrganization, FakeWhatsApp, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { registerWhatsAppProviderForTests } from "../whatsapp/whatsapp.registry.js";
import { createLocation, createResponsible, registerQualifiedLead } from "./lead-routing.service.js";

/**
 * Avant correction, un prospect qualifié allait toujours au même commercial (le premier par ordre alphabétique) :
 * les autres commerciaux actifs d'une même zone ne recevaient jamais rien.
 */
describe.skipIf(!integrationEnabled)("routage vers les commerciaux : répartition entre plusieurs commerciaux d'une même zone", () => {
  afterAll(async () => prisma.$disconnect());
  beforeEach(resetDatabase);

  async function qualifiedConversation(organizationId: string, jid: string) {
    const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: jid, displayName: "Cliente" } });
    return prisma.conversation.create({ data: { organizationId, contactId: contact.id } });
  }

  it("fait tourner les prospects entre les commerciaux actifs de la même zone au lieu de tout envoyer au même", async () => {
    const { organization } = await createTestOrganization("Boutique Douala");
    registerWhatsAppProviderForTests(organization.id, new FakeWhatsApp());
    const location = await createLocation(organization.id, { name: "Akwa", city: "Douala" });
    // « Awa » et « Zara » : volontairement dans cet ordre alphabétique pour vérifier qu'on ne reste pas bloqué sur la première.
    const awa = await createResponsible(organization.id, { locationId: location.id, name: "Awa", whatsappNumber: "237690000001" });
    const zara = await createResponsible(organization.id, { locationId: location.id, name: "Zara", whatsappNumber: "237690000002" });

    const recipients: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const conversation = await qualifiedConversation(organization.id, `23769000100${i}@s.whatsapp.net`);
      const lead = await registerQualifiedLead({
        organizationId: organization.id,
        conversationId: conversation.id,
        leadData: { name: `Client ${i}`, city: "Douala", need: "Un devis" },
        leadScore: 90,
      });
      expect(lead!.isRouted).toBe(true);
      recipients.push(lead!.responsibleId!);
      // routedAt vient de Date.now() : un petit écart garantit un ordre strict entre les appels.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(recipients.filter((id) => id === awa.id)).toHaveLength(3);
    expect(recipients.filter((id) => id === zara.id)).toHaveLength(3);
    expect(recipients).toEqual([awa.id, zara.id, awa.id, zara.id, awa.id, zara.id]);
  });

  it("donne la priorité au commercial jamais servi, même s'il est ajouté après coup", async () => {
    const { organization } = await createTestOrganization("Boutique Yaoundé");
    registerWhatsAppProviderForTests(organization.id, new FakeWhatsApp());
    const location = await createLocation(organization.id, { name: "Bastos", city: "Yaoundé" });
    const first = await createResponsible(organization.id, { locationId: location.id, name: "Ali", whatsappNumber: "237690000003" });

    for (let i = 0; i < 2; i += 1) {
      const conversation = await qualifiedConversation(organization.id, `23769000200${i}@s.whatsapp.net`);
      const lead = await registerQualifiedLead({ organizationId: organization.id, conversationId: conversation.id, leadData: { name: `Client ${i}`, city: "Yaoundé", need: "x" }, leadScore: 90 });
      expect(lead!.responsibleId).toBe(first.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Un second commercial rejoint la zone : il doit recevoir le prochain prospect (il n'a jamais rien reçu).
    const second = await createResponsible(organization.id, { locationId: location.id, name: "Bello", whatsappNumber: "237690000004" });
    const conversation = await qualifiedConversation(organization.id, "237690002009@s.whatsapp.net");
    const lead = await registerQualifiedLead({ organizationId: organization.id, conversationId: conversation.id, leadData: { name: "Client 9", city: "Yaoundé", need: "x" }, leadScore: 90 });
    expect(lead!.responsibleId).toBe(second.id);
  });

  it("n'envoie rien à un commercial désactivé entre-temps", async () => {
    const { organization } = await createTestOrganization("Boutique Bafoussam");
    registerWhatsAppProviderForTests(organization.id, new FakeWhatsApp());
    const location = await createLocation(organization.id, { name: "Centre", city: "Bafoussam" });
    const active = await createResponsible(organization.id, { locationId: location.id, name: "Active", whatsappNumber: "237690000005" });
    await createResponsible(organization.id, { locationId: location.id, name: "Inactive", whatsappNumber: "237690000006", active: false });

    for (let i = 0; i < 3; i += 1) {
      const conversation = await qualifiedConversation(organization.id, `23769000300${i}@s.whatsapp.net`);
      const lead = await registerQualifiedLead({ organizationId: organization.id, conversationId: conversation.id, leadData: { name: `Client ${i}`, city: "Bafoussam", need: "x" }, leadScore: 90 });
      expect(lead!.responsibleId).toBe(active.id);
    }
  });
});
