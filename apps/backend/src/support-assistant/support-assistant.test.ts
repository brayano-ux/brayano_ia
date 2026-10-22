import { describe, expect, it } from "vitest";
import { BILLING_PLANS, TRIAL } from "../billing/billing-plans.js";
import { SUPPORT_KNOWLEDGE, SUPPORT_VIEWS } from "./knowledge.js";
import { buildSystemPrompt, checkSupportRateLimit, parseSupportReply, sanitizeHistory } from "./support-assistant.js";

const fmt = (value: number) => new Intl.NumberFormat("fr-FR").format(value).replace(/[  ]/g, " ");

describe("base de connaissances de l'assistant d'aide", () => {
  it("affiche les mêmes prix, quantités et essai que les forfaits (une seule vérité)", () => {
    for (const plan of Object.values(BILLING_PLANS)) {
      expect(SUPPORT_KNOWLEDGE).toContain(`${plan.name} : ${fmt(plan.amount)} FCFA`);
      expect(SUPPORT_KNOWLEDGE).toContain(`${fmt(plan.messages)} messages`);
    }
    expect(SUPPORT_KNOWLEDGE).toContain(`${TRIAL.messages} messages`);
  });

  it("nomme chaque page du menu du tableau de bord", () => {
    for (const label of Object.values(SUPPORT_VIEWS)) expect(SUPPORT_KNOWLEDGE).toContain(label);
  });

  it("explique les grandes étapes de configuration", () => {
    for (const phrase of ["Appareils liés", "Informations sur votre activité", "Tester l'agent", "Réactiver l'IA", "STOP", "Orange Money"]) {
      expect(SUPPORT_KNOWLEDGE).toContain(phrase);
    }
  });

  it("le prompt contient les règles, la situation du compte et la base", () => {
    const prompt = buildSystemPrompt("WhatsApp : connecté");
    expect(prompt).toContain("WhatsApp : connecté");
    expect(prompt).toContain("N'invente jamais");
    expect(prompt).toContain("+237 683 26 05 20");
    expect(prompt).toContain(SUPPORT_KNOWLEDGE);
  });
});

describe("réponse du modèle", () => {
  it("lit un JSON propre et refuse une page inconnue", () => {
    expect(parseSupportReply('{"reply":"Allez dans WhatsApp.","openView":"whatsapp"}')).toEqual({ reply: "Allez dans WhatsApp.", openView: "whatsapp" });
    expect(parseSupportReply('{"reply":"Bonjour","openView":"admin"}').openView).toBeNull();
    expect(parseSupportReply('{"reply":"Bonjour"}').openView).toBeNull();
  });

  it("accepte un JSON entouré de balises de code", () => {
    expect(parseSupportReply('```json\n{"reply":"Salut","openView":null}\n```').reply).toBe("Salut");
  });

  it("garde le texte tel quel quand ce n'est pas du JSON", () => {
    expect(parseSupportReply("Voici comment faire.")).toEqual({ reply: "Voici comment faire.", openView: null });
    expect(() => parseSupportReply("   ")).toThrow();
  });
});

describe("historique envoyé au modèle", () => {
  it("coupe les messages trop longs, garde les derniers et commence par l'utilisateur", () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? ("assistant" as const) : ("user" as const), content: `m${index}` }));
    const cleaned = sanitizeHistory(messages);
    expect(cleaned.length).toBeLessThanOrEqual(12);
    expect(cleaned[0]!.role).toBe("user");
    expect(cleaned.at(-1)!.content).toBe("m29");
    expect(sanitizeHistory([{ role: "user", content: "x".repeat(5000) }])[0]!.content).toHaveLength(1000);
    expect(sanitizeHistory([{ role: "assistant", content: "Bonjour" }, { role: "user", content: "  " }])).toEqual([]);
  });
});

describe("limite de questions", () => {
  it("bloque au-delà de la limite horaire puis libère", () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) checkSupportRateLimit("org-limit", now, 3);
    expect(() => checkSupportRateLimit("org-limit", now, 3)).toThrow(/beaucoup de questions/);
    expect(() => checkSupportRateLimit("org-limit", now + 3_700_000, 3)).not.toThrow();
  });
});
