import { describe, expect, it } from "vitest";
import {
  isNegotiationState,
  nextNegotiationOffer,
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
