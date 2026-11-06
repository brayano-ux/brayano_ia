import { describe, expect, it } from "vitest";
import { BUBBLES, TYPING, bubblePauseMs, humanReplyDelayMs, jitteredDelayMs, sendInBubbles, splitIntoBubbles, typingDurationMs, waitWhileTyping } from "./human-pacing.js";

const mid = () => 0.5;

describe("jitteredDelayMs", () => {
  it("reste dans une marge de ±20 % autour du délai configuré", () => {
    expect(jitteredDelayMs(5, () => 0)).toBeCloseTo(4_000);
    expect(jitteredDelayMs(5, () => 1)).toBeCloseTo(6_000);
    expect(jitteredDelayMs(5, mid)).toBeCloseTo(5_000);
  });
});

describe("typingDurationMs", () => {
  it("s'allonge avec la longueur du texte", () => {
    const short = typingDurationMs("Oui, c'est disponible.", mid);
    const long = typingDurationMs("x".repeat(200), mid);
    expect(long).toBeGreaterThan(short);
    expect(short).toBeCloseTo(TYPING.baseMs + 22 * TYPING.perCharMs);
  });

  it("est plafonnée : personne ne tape deux minutes d'affilée", () => {
    expect(typingDurationMs("x".repeat(5_000), mid)).toBeCloseTo(TYPING.maxMs);
    expect(typingDurationMs("x".repeat(5_000), () => 1)).toBeCloseTo(TYPING.maxMs * 1.2);
  });
});

describe("humanReplyDelayMs", () => {
  it("respecte un délai configuré long", () => {
    expect(humanReplyDelayMs({ configuredDelaySeconds: 60, replyText: "Bonjour !" }, mid)).toBeCloseTo(60_000);
  });

  it("allonge un délai court quand la réponse est longue à taper", () => {
    const delay = humanReplyDelayMs({ configuredDelaySeconds: 3, replyText: "x".repeat(300) }, mid);
    expect(delay).toBeGreaterThan(3_000);
    expect(delay).toBeCloseTo(TYPING.baseMs + 300 * TYPING.perCharMs);
  });
});

describe("waitWhileTyping", () => {
  it("affiche « en train d'écrire » puis attend la durée demandée", async () => {
    const calls: string[] = [];
    const waited: number[] = [];
    await waitWhileTyping(4_200, { sendTypingIndicator: async (jid) => { calls.push(jid); } }, "237600000000@s.whatsapp.net", async (ms) => { waited.push(ms); });
    expect(calls).toEqual(["237600000000@s.whatsapp.net"]);
    expect(waited).toEqual([4_200]);
  });

  it("ne fait rien pour une durée nulle", async () => {
    const calls: string[] = [];
    await waitWhileTyping(0, { sendTypingIndicator: async (jid) => { calls.push(jid); } }, "x", async () => { throw new Error("ne doit pas attendre"); });
    expect(calls).toEqual([]);
  });
});

describe("splitIntoBubbles", () => {
  it("laisse un message court en un seul bloc", () => {
    const text = "Bonjour ! La robe est disponible en M et L, à 15 000 FCFA. Vous la voulez en quelle taille ?";
    expect(splitIntoBubbles(text)).toEqual([text]);
  });

  it("coupe une longue réponse entre ses paragraphes et garde tout le texte", () => {
    const p1 = "Bonjour et merci pour votre message ! Oui, nous livrons à Douala et à Yaoundé, généralement sous 24 à 48 heures après confirmation.";
    const p2 = "Les frais de livraison sont de 1 500 FCFA à Douala et 2 500 FCFA à Yaoundé. Le paiement se fait à la livraison ou par Mobile Money.";
    const p3 = "Dites-moi votre quartier et je vous confirme l'heure de passage dès que possible.";
    const bubbles = splitIntoBubbles(`${p1}\n\n${p2}\n\n${p3}`);
    expect(bubbles.length).toBeGreaterThanOrEqual(2);
    expect(bubbles.length).toBeLessThanOrEqual(BUBBLES.max);
    expect(bubbles.join("\n\n")).toBe(`${p1}\n\n${p2}\n\n${p3}`);
  });

  it("ne dépasse jamais trois bulles, même avec beaucoup de paragraphes", () => {
    const text = Array.from({ length: 8 }, (_, i) => `Paragraphe numéro ${i + 1} avec assez de texte pour compter dans la longueur totale du message.`).join("\n\n");
    const bubbles = splitIntoBubbles(text);
    expect(bubbles).toHaveLength(3);
    expect(bubbles.join("\n\n")).toBe(text);
  });

  it("coupe un paragraphe unique entre ses phrases", () => {
    const text = "Merci pour votre intérêt ! Le sac existe en noir, en camel et en bordeaux. Il est en cuir véritable avec une doublure en coton. Le prix est de 25 000 FCFA, livraison comprise à Douala. Souhaitez-vous que je vous envoie une photo d'une couleur en particulier ?";
    const bubbles = splitIntoBubbles(text);
    expect(bubbles).toHaveLength(2);
    expect(bubbles.join(" ")).toBe(text);
    for (const bubble of bubbles) expect(bubble.length).toBeGreaterThanOrEqual(BUBBLES.minBubbleLength);
  });

  it("ne coupe jamais à l'intérieur d'une liste ou d'horaires sur plusieurs lignes", () => {
    const list = "Voici nos horaires de la semaine, pour que vous puissiez passer quand cela vous arrange le mieux :\n- Lundi : 9h à 18h\n- Mardi : 9h à 18h\n- Mercredi : 9h à 18h\n- Jeudi : 9h à 18h\n- Vendredi : 9h à 20h\n- Samedi : 10h à 20h\n- Dimanche : fermé";
    expect(splitIntoBubbles(list)).toEqual([list]);
    const withIntro = `Bonjour ! Avec plaisir, voici toutes les informations utiles pour nous rendre visite en boutique cette semaine.\n\n${list}`;
    const bubbles = splitIntoBubbles(withIntro);
    expect(bubbles[bubbles.length - 1]).toContain("- Dimanche : fermé");
    expect(bubbles.some((bubble) => bubble.includes("- Lundi") && !bubble.includes("- Dimanche"))).toBe(false);
  });

  it("recolle une bulle trop courte à sa voisine", () => {
    const text = `Bonjour !\n\n${"Nous avons bien reçu votre demande et nous vous répondons dans la journée avec tous les détails. ".repeat(3).trim()}`;
    const bubbles = splitIntoBubbles(text);
    expect(bubbles[0]).toMatch(/^Bonjour !\n\nNous avons/);
  });

  it("ne renvoie rien pour un texte vide", () => {
    expect(splitIntoBubbles("   ")).toEqual([]);
  });
});

describe("bubblePauseMs", () => {
  it("est courte, bornée et dépend de la bulle à venir", () => {
    expect(bubblePauseMs("Oui.", mid)).toBeCloseTo(BUBBLES.pauseBaseMs + 4 * BUBBLES.pausePerCharMs);
    expect(bubblePauseMs("x".repeat(1_000), mid)).toBeCloseTo(BUBBLES.pauseMaxMs);
  });
});

describe("sendInBubbles", () => {
  it("envoie les bulles dans l'ordre avec une pause et l'indicateur de frappe entre deux", async () => {
    const sent: string[] = [];
    const typing: string[] = [];
    const waited: number[] = [];
    const text = Array.from({ length: 3 }, (_, i) => `Paragraphe ${i + 1}, assez long pour que le message complet dépasse le seuil de découpage en plusieurs bulles.`).join("\n\n");
    const count = await sendInBubbles(
      { sendMessage: async (_jid, body) => { sent.push(body); }, sendTypingIndicator: async (jid) => { typing.push(jid); } },
      "jid",
      text,
      { wait: async (ms) => { waited.push(ms); }, random: mid },
    );
    expect(count).toBe(3);
    expect(sent.join("\n\n")).toBe(text);
    expect(typing).toHaveLength(2);
    expect(waited).toHaveLength(2);
    for (const ms of waited) expect(ms).toBeGreaterThan(0);
  });

  it("envoie un message court d'un seul coup, sans pause", async () => {
    const sent: string[] = [];
    const count = await sendInBubbles({ sendMessage: async (_jid, body) => { sent.push(body); } }, "jid", "Oui, c'est disponible !", { wait: async () => { throw new Error("pas de pause attendue"); } });
    expect(count).toBe(1);
    expect(sent).toEqual(["Oui, c'est disponible !"]);
  });
});
