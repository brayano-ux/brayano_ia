import { describe, expect, it } from "vitest";
import {
  floorPriceFor,
  isNegotiationState,
  nextNegotiationOffer,
  resolveDiscountLimit,
  startNegotiation,
} from "./price-negotiation.js";

describe("startNegotiation", () => {
  it("calcule le prix plancher depuis le pourcentage de remise maximale", () => {
    const state = startNegotiation("prod-1", 25000, 10);
    expect(state.basePrice).toBe(25000);
    expect(state.floorPrice).toBe(22500);
    expect(state.round).toBe(0);
    expect(state.currentPrice).toBe(25000);
  });

  it("plafonne le pourcentage de remise à 50 % même si une valeur aberrante est fournie", () => {
    const state = startNegotiation("prod-1", 10000, 90);
    expect(state.floorPrice).toBe(5000);
  });

  it("ne descend jamais sous zéro", () => {
    const state = startNegotiation("prod-1", 100, 100);
    expect(state.floorPrice).toBeGreaterThanOrEqual(0);
  });
});

describe("remise maximale en montant fixe", () => {
  it("fixe le plancher au prix moins le montant saisi par le marchand", () => {
    const state = startNegotiation("prod-1", 25000, { mode: "amount", value: 2000 });
    expect(state.floorPrice).toBe(23000);
    expect(state.currentPrice).toBe(25000);
  });

  it("suit les mêmes paliers progressifs que le pourcentage, jusqu'au plancher", () => {
    let state = startNegotiation("prod-1", 25000, { mode: "amount", value: 2000 });
    const prices: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      const offer = nextNegotiationOffer(state);
      prices.push(offer.price);
      state = offer.state;
    }
    // 45 % de l'écart restant à chaque tour, arrondi à la centaine, puis le plancher au troisième tour.
    expect(prices).toEqual([24100, 23600, 23000, 23000]);
  });

  it("donne exactement les mêmes offres qu'un pourcentage équivalent", () => {
    const byAmount = nextNegotiationOffer(startNegotiation("p", 20000, { mode: "amount", value: 2000 }));
    const byPercent = nextNegotiationOffer(startNegotiation("p", 20000, 10));
    expect(byAmount.price).toBe(byPercent.price);
    expect(byAmount.state.floorPrice).toBe(byPercent.state.floorPrice);
  });

  it("n'accorde jamais un franc de plus que le montant saisi, même avec un prix non rond", () => {
    // 12 550 − 2 000 = 10 550 : le plancher est arrondi à la centaine supérieure, pas inférieure.
    expect(floorPriceFor(12550, { mode: "amount", value: 2000 })).toBe(10600);
    expect(12550 - floorPriceFor(12550, { mode: "amount", value: 2000 })).toBeLessThanOrEqual(2000);
  });

  it("ne brade jamais plus de la moitié d'un petit article", () => {
    expect(floorPriceFor(3000, { mode: "amount", value: 5000 })).toBe(1500);
    expect(floorPriceFor(500, { mode: "amount", value: 100000 })).toBe(300);
  });

  it("ne change rien pour un montant nul ou négatif", () => {
    expect(floorPriceFor(10000, { mode: "amount", value: 0 })).toBe(10000);
    expect(floorPriceFor(10000, { mode: "amount", value: -500 })).toBe(10000);
  });
});

describe("resolveDiscountLimit", () => {
  it("utilise le montant fixe quand ce mode est choisi et qu'un montant est saisi", () => {
    expect(resolveDiscountLimit({ negotiationDiscountMode: "amount", negotiationMaxDiscountAmount: 1500, negotiationMaxDiscountPercent: 20 })).toEqual({ mode: "amount", value: 1500 });
  });

  it("retombe sur le pourcentage sans montant valide, et sur 10 % par défaut", () => {
    expect(resolveDiscountLimit({ negotiationDiscountMode: "amount", negotiationMaxDiscountAmount: null, negotiationMaxDiscountPercent: 20 })).toEqual({ mode: "percent", value: 20 });
    expect(resolveDiscountLimit({ negotiationDiscountMode: "percent", negotiationMaxDiscountAmount: 1500, negotiationMaxDiscountPercent: 15 })).toEqual({ mode: "percent", value: 15 });
    expect(resolveDiscountLimit({})).toEqual({ mode: "percent", value: 10 });
  });
});

describe("nextNegotiationOffer", () => {
  it("baisse progressivement le prix sans jamais dépasser le plancher", () => {
    const state0 = startNegotiation("prod-1", 25000, 10); // floor = 22500
    const offer1 = nextNegotiationOffer(state0);
    expect(offer1.price).toBeLessThan(25000);
    expect(offer1.price).toBeGreaterThanOrEqual(22500);
    expect(offer1.isFinal).toBe(false);

    const offer2 = nextNegotiationOffer(offer1.state);
    expect(offer2.price).toBeLessThanOrEqual(offer1.price);
    expect(offer2.price).toBeGreaterThanOrEqual(22500);
  });

  it("tient le prix plancher au bout du nombre maximal de tours et marque la négociation comme finale", () => {
    let state = startNegotiation("prod-1", 25000, 10);
    let lastOffer;
    for (let i = 0; i < 5; i += 1) {
      lastOffer = nextNegotiationOffer(state);
      state = lastOffer.state;
    }
    expect(lastOffer?.price).toBe(22500);
    expect(lastOffer?.isFinal).toBe(true);
  });

  it("reste arrondi à la centaine de FCFA près", () => {
    const state0 = startNegotiation("prod-1", 25000, 10);
    const offer = nextNegotiationOffer(state0);
    expect(offer.price % 100).toBe(0);
  });
});

describe("isNegotiationState", () => {
  it("reconnaît un état de négociation valide et rejette le reste", () => {
    const state = startNegotiation("prod-1", 25000, 10);
    expect(isNegotiationState(state)).toBe(true);
    expect(isNegotiationState(null)).toBe(false);
    expect(isNegotiationState(undefined)).toBe(false);
    expect(isNegotiationState({})).toBe(false);
    expect(isNegotiationState({ productId: "prod-1" })).toBe(false);
    expect(isNegotiationState([])).toBe(false);
  });
});
