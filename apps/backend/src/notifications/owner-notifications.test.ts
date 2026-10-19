import { describe, expect, it } from "vitest";
import { buildHandoffEmail, buildMediaReceivedEmail, describeHandoffReason } from "./owner-notifications.js";

describe("buildHandoffEmail", () => {
  it("explique pourquoi l'IA a passé la main et montre les derniers messages", () => {
    const email = buildHandoffEmail({
      organizationName: "Salon Éclat",
      prospect: { name: "Amina", phone: "237655000001" },
      intent: "demande_contact_humain",
      recent: [
        { author: "CONTACT", text: "Je veux parler à la gérante" },
        { author: "AI", text: "Je préviens l'équipe." },
      ],
      leadData: { city: "Douala", need: "" },
    });
    expect(email.subject).toContain("Amina");
    expect(email.text).toContain("Salon Éclat");
    expect(email.text).toContain("parler à une personne");
    expect(email.text).toContain("Client : Je veux parler à la gérante");
    expect(email.text).toContain("Assistant : Je préviens l'équipe.");
    expect(email.text).toContain("+237655000001");
    expect(email.text).toContain("city : Douala");
    expect(email.text).not.toContain("need :");
  });

  it("garde une raison par défaut pour une intention inconnue", () => {
    expect(describeHandoffReason("autre")).toContain("personne de l'équipe");
    expect(describeHandoffReason(undefined)).toContain("personne de l'équipe");
  });
});

describe("buildMediaReceivedEmail", () => {
  it("prévient que le paiement n'est pas confirmé", () => {
    const email = buildMediaReceivedEmail({
      organizationName: "Boutique Zoé",
      prospect: { name: null, phone: "237655000002" },
      kind: "payment_proof",
      fileLabel: "une photo",
      caption: "Voilà le paiement",
      summary: "Capture d'un transfert Orange Money de 15 000 FCFA.",
    });
    expect(email.subject).toContain("Preuve de paiement");
    expect(email.text).toContain("PAS confirmé");
    expect(email.text).toContain("Voilà le paiement");
    expect(email.text).toContain("15 000 FCFA");
  });
});
