import { describe, expect, it } from "vitest";
import { buildClaimCorrection, describeUnbackedClaims, findUnbackedClaims, type ClaimCheckInput } from "./claim-guard.js";

const base: ClaimCheckInput = {
  reply: "",
  agendaEnabled: true,
  ordersEnabled: true,
  booking: null,
  order: null,
  hasUpcomingAppointment: false,
  hasRecentOrder: false,
  hasOpenNewOrder: false,
};
const check = (overrides: Partial<ClaimCheckInput>) => findUnbackedClaims({ ...base, ...overrides });

describe("findUnbackedClaims", () => {
  it("flags a booking confirmed in words with no booking action and no appointment (the re-booking bug)", () => {
    expect(check({ reply: "C'est fait, votre rendez-vous de samedi 10h30 est de nouveau confirmé !" })).toEqual(["booking_confirmed"]);
    expect(check({ reply: "Perfect, your appointment is booked for Saturday." })).toEqual(["booking_confirmed"]);
  });

  it("does not flag anything when the booking action is present", () => {
    expect(check({ reply: "Votre rendez-vous est confirmé.", booking: { action: "book" } })).toEqual([]);
  });

  it("does not flag a reminder about an existing appointment", () => {
    expect(check({ reply: "Votre rendez-vous est confirmé pour samedi.", hasUpcomingAppointment: true })).toEqual([]);
  });

  it("ignores present-tense verbs and infinitives (not a completed action)", () => {
    expect(check({ reply: "Je confirme votre rendez-vous dès que vous m'envoyez l'heure." })).toEqual([]);
    expect(check({ reply: "Je n'ai pas pu enregistrer le rendez-vous, voulez-vous réessayer ?" })).toEqual([]);
    expect(check({ reply: "Pour enregistrer la commande, donnez-moi votre adresse." })).toEqual([]);
  });

  it("ignores negations and questions", () => {
    expect(check({ reply: "Votre rendez-vous n'est pas encore confirmé, quelle heure préférez-vous ?" })).toEqual([]);
    expect(check({ reply: "Souhaitez-vous que je confirme le rendez-vous ?" })).toEqual([]);
  });

  it("flags a cancellation claimed while the appointment is still booked", () => {
    expect(check({ reply: "Votre rendez-vous a bien été annulé.", hasUpcomingAppointment: true })).toEqual(["booking_cancelled"]);
    expect(check({ reply: "Votre rendez-vous a bien été annulé.", booking: { action: "cancel" }, hasUpcomingAppointment: true })).toEqual([]);
  });

  it("flags an order recorded or cancelled in words only", () => {
    expect(check({ reply: "Votre commande est bien enregistrée." })).toEqual(["order_recorded"]);
    expect(check({ reply: "C'est annulé, votre commande est annulée.", hasOpenNewOrder: true, hasRecentOrder: true })).toEqual(["order_cancelled"]);
    expect(check({ reply: "Votre commande est annulée.", order: { action: "cancel" }, hasOpenNewOrder: true })).toEqual([]);
  });

  it("does nothing when the feature is disabled", () => {
    expect(check({ reply: "Votre rendez-vous est confirmé.", agendaEnabled: false })).toEqual([]);
    expect(check({ reply: "Votre commande est enregistrée.", ordersEnabled: false })).toEqual([]);
  });
});

describe("claim texts", () => {
  it("builds a correction prompt and an honest bilingual notice", () => {
    expect(buildClaimCorrection(["booking_confirmed"])).toContain('"action":"book"');
    expect(describeUnbackedClaims(["order_recorded"])).toContain("Je n'ai pas pu enregistrer cette commande");
  });
});

describe("payment confirmation claims", () => {
  const base = { agendaEnabled: false, ordersEnabled: false, hasUpcomingAppointment: false, hasRecentOrder: false, hasOpenNewOrder: false };

  it.each([
    "Votre paiement a bien été reçu, merci !",
    "Paiement confirmé, nous préparons votre commande.",
    "J'ai bien reçu votre paiement de 15 000 FCFA.",
    "Your payment has been received.",
    "Le virement est validé.",
  ])("flags « %s »", (reply) => {
    expect(findUnbackedClaims({ ...base, reply })).toContain("payment_confirmed");
  });

  it.each([
    "J'ai bien reçu votre photo. L'équipe va vérifier votre paiement et vous répondre.",
    "Je n'ai pas reçu votre paiement pour le moment.",
    "Dès que votre paiement sera confirmé, nous livrons.",
    "Une fois le paiement reçu par l'équipe, nous préparons la commande.",
    "Vous pouvez payer par Orange Money ou MTN MoMo.",
    "Le paiement s'effectue à la livraison, en espèces.",
    "Je ne peux pas confirmer le paiement moi-même.",
  ])("does not flag « %s »", (reply) => {
    expect(findUnbackedClaims({ ...base, reply })).not.toContain("payment_confirmed");
  });

  it("gives a correction and an honest notice", () => {
    expect(buildClaimCorrection(["payment_confirmed"])).toContain("JAMAIS confirmer un paiement");
    expect(describeUnbackedClaims(["payment_confirmed"])).toContain("l'équipe va le vérifier");
  });
});
