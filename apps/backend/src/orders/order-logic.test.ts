import { describe, expect, it } from "vitest";
import { aiReplySchema } from "../ai/schemas.js";
import { buildAppointmentEmail, buildOrderCancellationEmail, buildOrderEmail } from "../notifications/owner-notifications.js";
import { decideOrder, decideOrderCancellation, describeOrderOutcome, orderSignature, parsePrice } from "./order-logic.js";

const A = "191e4567-e89b-42d3-a456-426614174000";
const B = "291e4567-e89b-42d3-a456-426614174000";
const catalog = [
  { id: A, name: "Chaise", price: "25 000 FCFA" },
  { id: B, name: "Table", price: "de 40 000 à 60 000 FCFA" },
];

describe("parsePrice", () => {
  it("reads common FCFA formats", () => {
    expect(parsePrice("25 000 FCFA")).toBe(25000);
    expect(parsePrice("25.000F")).toBe(25000);
    expect(parsePrice("1 500 000 XAF")).toBe(1500000);
    expect(parsePrice("25000")).toBe(25000);
  });
  it("refuses ranges and missing prices instead of guessing", () => {
    expect(parsePrice("de 40 000 à 60 000")).toBeNull();
    expect(parsePrice("sur devis")).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe("decideOrder", () => {
  const base = { catalog, fallbackName: null, fallbackPhone: "237650000000" };

  it("builds an order with totals from the real catalogue prices", () => {
    const decision = decideOrder({ ...base, request: { action: "create", items: [{ productId: A, quantity: 2 }], customerName: "Awa", address: "Bonamoussadi" } });
    expect(decision).toMatchObject({ kind: "create", total: 50000, customerName: "Awa", phone: "237650000000" });
  });

  it("leaves the total empty when a price cannot be computed", () => {
    const decision = decideOrder({ ...base, request: { action: "create", items: [{ productId: A, quantity: 1 }, { productId: B, quantity: 1 }], customerName: "Awa", address: "Akwa" } });
    expect(decision).toMatchObject({ kind: "create", total: null });
  });

  it("merges duplicate lines", () => {
    const decision = decideOrder({ ...base, request: { action: "create", items: [{ productId: A, quantity: 1 }, { productId: A, quantity: 2 }], customerName: "Awa", address: "Akwa" } });
    expect(decision.kind === "create" && decision.items).toHaveLength(1);
    expect(decision.kind === "create" && decision.items[0]?.quantity).toBe(3);
  });

  it("rejects a product that is not in the catalogue", () => {
    const decision = decideOrder({ ...base, request: { action: "create", items: [{ productId: "391e4567-e89b-42d3-a456-426614174000", quantity: 1 }], customerName: "Awa", address: "Akwa" } });
    expect(decision.kind).toBe("unknown_product");
  });

  it("asks for the missing address or name instead of saving an incomplete order", () => {
    expect(decideOrder({ ...base, request: { action: "create", items: [{ productId: A, quantity: 1 }], customerName: "Awa" } })).toEqual({ kind: "missing", fields: ["address"] });
    expect(decideOrder({ ...base, request: { action: "create", items: [{ productId: A, quantity: 1 }], address: "Akwa" } })).toEqual({ kind: "missing", fields: ["customerName"] });
    expect(decideOrder({ ...base, fallbackName: "Awa", request: { action: "create", items: [{ productId: A, quantity: 1 }], address: "Akwa" } }).kind).toBe("create");
  });
});

describe("order helpers", () => {
  it("builds the same signature whatever the line order", () => {
    expect(orderSignature([{ productId: A, quantity: 1 }, { productId: B, quantity: 2 }])).toBe(orderSignature([{ productId: B, quantity: 2 }, { productId: A, quantity: 1 }]));
  });

  it("describes what was really recorded", () => {
    const text = describeOrderOutcome({
      kind: "create", total: 50000, customerName: "Awa", address: "Akwa", phone: null, notes: null,
      items: [{ productId: A, name: "Chaise", quantity: 2, unitPrice: "25 000 FCFA", lineTotal: 50000 }],
    });
    expect(text.appendToReply).toContain("2 × Chaise");
    expect(text.appendToReply).toContain("50 000 FCFA");
    expect(describeOrderOutcome({ kind: "missing", fields: ["address"] }).replaceReply).toContain("adresse");
  });
});

describe("order field in the AI reply", () => {
  const reply = { reply: "ok", intent: "achat", confidence: 0.9, needsHuman: false, leadScore: 0, qualificationStatus: "not_qualified", nextAction: "continue", leadData: {} };

  it("is optional, parses quantities sent as text, and drops malformed requests without invalidating the reply", () => {
    expect(aiReplySchema.safeParse(reply).success).toBe(true);
    const ok = aiReplySchema.parse({ ...reply, order: { action: "create", items: [{ productId: A, quantity: "2" }], address: "Akwa" } });
    expect(ok.order?.action === "create" && ok.order.items[0]?.quantity).toBe(2);
    const bad = aiReplySchema.safeParse({ ...reply, order: { action: "create", items: [{ productId: "pas-un-uuid", quantity: 1 }] } });
    expect(bad.success).toBe(true);
    expect(bad.success && bad.data.order).toBeUndefined();
  });
});

describe("order cancellation", () => {
  const at = (iso: string) => new Date(iso);
  const order = (id: string, status: "NEW" | "CONFIRMED" | "DELIVERED" | "CANCELLED", iso: string) => ({ id, status, createdAt: at(iso) });

  it("parses a cancel request, without needing any item", () => {
    const reply = { reply: "ok", intent: "annulation", confidence: 0.9, needsHuman: false, leadScore: 0, qualificationStatus: "not_qualified", nextAction: "continue", leadData: {} };
    const parsed = aiReplySchema.parse({ ...reply, order: { action: "cancel" } });
    expect(parsed.order).toEqual({ action: "cancel" });
  });

  it("cancels the most recent open order while it is still NEW", () => {
    const decision = decideOrderCancellation([
      order("old", "DELIVERED", "2026-10-01T10:00:00Z"),
      order("recent", "NEW", "2026-10-12T10:00:00Z"),
      order("gone", "CANCELLED", "2026-10-13T10:00:00Z"),
    ]);
    expect(decision).toEqual({ kind: "cancel", orderId: "recent" });
    expect(describeOrderOutcome(decision).appendToReply).toContain("annulée");
  });

  it("refuses to cancel an order the owner already confirmed and asks the owner to step in", () => {
    const decision = decideOrderCancellation([order("c", "CONFIRMED", "2026-10-12T10:00:00Z")]);
    expect(decision).toMatchObject({ kind: "cancel_too_late", orderId: "c" });
    expect(describeOrderOutcome(decision).replaceReply).toContain("prévenu l'équipe");
  });

  it("says so when there is nothing to cancel", () => {
    const decision = decideOrderCancellation([order("x", "CANCELLED", "2026-10-12T10:00:00Z")]);
    expect(decision).toEqual({ kind: "nothing_to_cancel" });
    expect(describeOrderOutcome(decision).replaceReply).toContain("aucune commande");
  });

  it("builds an owner email that differs for a cancellation and a request on a confirmed order", () => {
    const base = { organizationName: "Boutique Zoé", prospect: { name: "Awa", phone: "237650000001" }, items: [{ quantity: 2, name: "Kit" }], totalLabel: "36 000 FCFA" };
    expect(buildOrderCancellationEmail({ ...base, kind: "cancelled" }).subject).toContain("Commande annulée");
    expect(buildOrderCancellationEmail({ ...base, kind: "requested" }).subject).toContain("Demande d'annulation");
  });
});

describe("owner notification emails", () => {
  it("contains the prospect information and the order details", () => {
    const mail = buildOrderEmail({
      organizationName: "Boutique Zoé",
      prospect: { name: "Awa", phone: "237650000000" },
      items: [{ quantity: 2, name: "Chaise", unitPrice: "25 000 FCFA" }],
      totalLabel: "50 000 FCFA", address: "Bonamoussadi", notes: null,
    });
    expect(mail.subject).toContain("Awa");
    for (const expected of ["Boutique Zoé", "+237650000000", "2 × Chaise", "50 000 FCFA", "Bonamoussadi"]) {
      expect(mail.text).toContain(expected);
    }
  });

  it("describes appointments without printing empty fields", () => {
    const mail = buildAppointmentEmail({ organizationName: "Salon", kind: "booked", prospect: { name: null, phone: "237650000000" }, whenLabel: "mar. 13 oct. 10:00", service: null });
    expect(mail.text).toContain("10:00");
    expect(mail.text).not.toContain("Service");
    expect(mail.text).not.toContain("Nom :");
  });
});
