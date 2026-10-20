import { describe, expect, it } from "vitest";
import { formatWhatsAppNumber, normalizeWhatsAppNumber, sameWhatsAppNumber } from "./phone.js";

describe("normalizeWhatsAppNumber", () => {
  it.each([
    ["+237 690 00 00 00", "237690000000"],
    ["+237690000000", "237690000000"],
    ["00237 6 90 00 00 00", "237690000000"],
    ["237690000000", "237690000000"],
    ["690 00 00 00", "237690000000"],
    ["(+237) 690-00-00-00", "237690000000"],
    ["+33 6 12 34 56 78", "33612345678"],
  ])("accepte %s", (input, expected) => {
    expect(normalizeWhatsAppNumber(input)).toBe(expected);
  });

  it.each(["", "abc", "12345", "+0690000000", "690", "+237 69a 00 00 00", "++237690000000", "12345678901234567"])("refuse %s", (input) => {
    expect(normalizeWhatsAppNumber(input)).toBeNull();
  });

  it("n'ajoute pas l'indicatif à un numéro étranger saisi sans « + »", () => {
    expect(normalizeWhatsAppNumber("33612345678")).toBe("33612345678");
  });
});

describe("formatWhatsAppNumber", () => {
  it("met en forme un numéro camerounais et garde les autres tels quels", () => {
    expect(formatWhatsAppNumber("237690000000")).toBe("+237 6 90 00 00 00");
    expect(formatWhatsAppNumber("33612345678")).toBe("+33612345678");
  });
});

describe("sameWhatsAppNumber", () => {
  it("ignore la mise en forme, le suffixe d'appareil et le domaine WhatsApp", () => {
    expect(sameWhatsAppNumber("+237 690 00 00 00", "237690000000:12@s.whatsapp.net")).toBe(true);
    expect(sameWhatsAppNumber("237690000000", "237690000001")).toBe(false);
    expect(sameWhatsAppNumber(null, "237690000000")).toBe(false);
  });
});
