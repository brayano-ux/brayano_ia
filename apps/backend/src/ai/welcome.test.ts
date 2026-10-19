import { describe, expect, it } from "vitest";
import { decideWelcome, isPureGreeting } from "./welcome.js";

describe("isPureGreeting", () => {
  it.each(["Bonjour", "bonsoir !", "Salut", "hello", "Hi", "bjr", "Bonjour monsieur", "bonsoir madame svp", "Salut ça va ?", "Good morning", "cc"])("« %s » est une simple salutation", (text) => {
    expect(isPureGreeting(text)).toBe(true);
  });

  it.each(["Bonjour, c'est combien la robe ?", "Salut vous êtes où ?", "prix ?", "Je veux commander", "hello do you deliver", "", "Bonjour j'ai vu votre pub sur facebook"])("« %s » contient une vraie demande", (text) => {
    expect(isPureGreeting(text)).toBe(false);
  });
});

describe("decideWelcome", () => {
  it("n'envoie rien sans message d'accueil", () => {
    expect(decideWelcome({ welcomeMessage: "  ", outboundCount: 0, inboundText: "bonjour" })).toEqual({ welcome: null, welcomeOnly: false });
    expect(decideWelcome({ welcomeMessage: null, outboundCount: 0, inboundText: "bonjour" })).toEqual({ welcome: null, welcomeOnly: false });
  });

  it("n'envoie l'accueil qu'au premier échange", () => {
    expect(decideWelcome({ welcomeMessage: "Bienvenue", outboundCount: 1, inboundText: "bonjour" }).welcome).toBeNull();
  });

  it("répond seulement par l'accueil à une simple salutation", () => {
    expect(decideWelcome({ welcomeMessage: "Bienvenue", outboundCount: 0, inboundText: "Bonsoir" })).toEqual({ welcome: "Bienvenue", welcomeOnly: true });
  });

  it("envoie l'accueil puis laisse l'IA répondre à une vraie question", () => {
    expect(decideWelcome({ welcomeMessage: "Bienvenue", outboundCount: 0, inboundText: "Combien coûte la robe ?" })).toEqual({ welcome: "Bienvenue", welcomeOnly: false });
  });
});
