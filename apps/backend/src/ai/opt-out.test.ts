import { describe, expect, it } from "vitest";
import { isOptOutRequest } from "./opt-out.js";

describe("isOptOutRequest", () => {
  it.each(["STOP", "stop", "Stop svp", "Arrêtez", "Ne m'écrivez plus", "ne me contactez plus svp", "Arrêtez de m'écrire", "Désabonnez-moi", "unsubscribe", "Do not contact me", "remove me", "Retirez-moi de la liste", "stop messaging me"])("reconnaît « %s »", (text) => {
    expect(isOptOutRequest(text)).toBe(true);
  });

  it.each([
    "Stop, je voudrais plutôt la robe rouge s'il vous plaît, pouvez-vous me la montrer ? Merci beaucoup",
    "Combien coûte le stop moteur ?",
    "Je veux commander",
    "Ok merci",
    "Ne cessez pas de me tenir informé",
    "Arrêt de bus à Bonamoussadi, vous êtes où ?",
    "",
  ])("ne confond pas « %s » avec un désabonnement", (text) => {
    expect(isOptOutRequest(text)).toBe(false);
  });
});
