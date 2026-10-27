import { describe, expect, it } from "vitest";
import { isLocationRequested } from "./location-request.js";

describe("isLocationRequested", () => {
  it("reconnaît une demande de localisation en français", () => {
    for (const message of [
      "Quelle est votre adresse ?",
      "Vous êtes où exactement ?",
      "Comment venir chez vous ?",
      "C'est où la boutique ?",
      "Vous pouvez m'envoyer votre position GPS ?",
      "Quel est l'itinéraire pour venir ?",
      "Où se trouve votre boutique ?",
    ]) {
      expect(isLocationRequested(message), message).toBe(true);
    }
  });

  it("reconnaît une demande de localisation en anglais", () => {
    for (const message of ["Where are you located?", "What's your address?", "How do I get there?"]) {
      expect(isLocationRequested(message), message).toBe(true);
    }
  });

  it("ne se déclenche pas sur un message sans rapport", () => {
    for (const message of [
      "Combien coûte la robe rouge ?",
      "Vous êtes ouverts demain ?",
      "Où est passée ma commande ?",
      "Bonjour",
    ]) {
      expect(isLocationRequested(message), message).toBe(false);
    }
  });
});
