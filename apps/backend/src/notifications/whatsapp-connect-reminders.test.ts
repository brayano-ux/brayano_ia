import { describe, expect, it } from "vitest";
import { buildWhatsAppConnectReminderEmail, dueReminderStep, isDaytime } from "./whatsapp-connect-reminders.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("dueReminderStep", () => {
  it("rien avant 24 h", () => {
    expect(dueReminderStep(23 * HOUR, 0)).toBeNull();
  });

  it("premier rappel après 1 jour, deuxième après 3 jours, troisième après 7 jours", () => {
    expect(dueReminderStep(1 * DAY + HOUR, 0)).toBe(1);
    expect(dueReminderStep(3 * DAY + HOUR, 1)).toBe(2);
    expect(dueReminderStep(7 * DAY + HOUR, 2)).toBe(3);
  });

  it("n'envoie jamais deux fois le même rappel", () => {
    expect(dueReminderStep(1 * DAY + HOUR, 1)).toBeNull();
    expect(dueReminderStep(7 * DAY + HOUR, 3)).toBeNull();
  });

  it("un rappel manqué n'est pas rattrapé en rafale : seul le plus récent part", () => {
    expect(dueReminderStep(3 * DAY + HOUR, 0)).toBe(2);
  });

  it("un compte ancien ne reçoit rien", () => {
    expect(dueReminderStep(30 * DAY, 0)).toBeNull();
    expect(dueReminderStep(11 * DAY + HOUR, 0)).toBeNull();
  });
});

describe("isDaytime", () => {
  it("n'envoie qu'entre 8 h et 20 h, heure du Cameroun", () => {
    expect(isDaytime(new Date("2026-11-18T09:00:00Z"))).toBe(true); // 10 h à Douala
    expect(isDaytime(new Date("2026-11-18T06:30:00Z"))).toBe(false); // 7 h 30
    expect(isDaytime(new Date("2026-11-18T19:00:00Z"))).toBe(false); // 20 h
  });
});

describe("buildWhatsAppConnectReminderEmail", () => {
  it("explique comment relier le numéro et donne le support, avec un texte différent à chaque rappel", () => {
    const emails = [1, 2, 3].map((step) => buildWhatsAppConnectReminderEmail({ organizationName: "Boutique Awa", step }));
    expect(new Set(emails.map((email) => email.subject)).size).toBe(3);
    for (const email of emails) {
      expect(email.text).toContain("Boutique Awa");
      expect(email.text).toContain("Appareils connectés → Connecter un appareil");
      expect(email.text).toContain("« Afficher le QR code »");
      expect(email.text).toContain("+237 683 26 05 20");
    }
    expect(emails[2]!.text).toContain("dernier rappel");
  });
});
