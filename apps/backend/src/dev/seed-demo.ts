/**
 * Données de démonstration pour le développement local et les captures d'écran de la page d'accueil :
 * une boutique fictive (« Boutique Awa ») avec catalogue, conversations, commandes, rendez-vous, équipe…
 *
 *   DATABASE_URL=postgresql://…@localhost/… npx tsx src/dev/seed-demo.ts
 *
 * ATTENTION : le script VIDE la base avant de la remplir. Il refuse donc de tourner ailleurs que sur une base
 * locale (localhost / 127.0.0.1). Il n'est jamais chargé par le serveur.
 */
import sharp from "sharp";
import { prisma } from "../database/client.js";
import { env } from "../config/env.js";
import { hashPassword } from "../auth/password.js";
import { saveClientMedia } from "../media/client-media.service.js";
import { settingsFingerprint } from "../onboarding/onboarding.service.js";
import { saveProductImage } from "../products/products.service.js";

export const DEMO_ACCOUNT = { email: "awa@brayano.test", password: "DemoPassword123" } as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms);

function assertLocalDatabase() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusé : ce script vide la base, il ne tourne jamais en production.");
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`Refusé : ce script vide la base et ne tourne que sur une base locale (hôte reçu : ${url.hostname}).`);
  }
}

/** Générateur pseudo-aléatoire déterministe : les mêmes données à chaque exécution. */
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = createRandom(20261122);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

/* ------------------------------------------------------------------ images */

const SILHOUETTES: Record<string, string> = {
  robe: '<path d="M330 150h140l18 96-40 40 92 330H260l92-330-40-40z"/>',
  sac: '<path d="M300 330a100 110 0 0 1 200 0" fill="none" stroke-width="26"/><rect x="230" y="320" width="340" height="300" rx="46"/>',
  chaussure: '<path d="M180 520c60-10 120-70 170-150l70 60c50 40 130 60 200 70 40 6 60 30 60 60v40H180z"/>',
  chemise: '<path d="M300 170l-130 90 50 90 60-34v300h240V316l60 34 50-90-130-90c-20 34-56 50-100 50s-80-16-100-50z"/>',
  foulard: '<path d="M210 250c120-60 260-60 380 0l-60 120c-80-40-180-40-260 0zM330 380l-60 250 130-90 130 90-60-250z"/>',
  collier: '<path d="M250 190c0 190 60 330 150 330s150-140 150-330" fill="none" stroke-width="24"/><circle cx="400" cy="560" r="54"/>',
};

async function productPhoto(kind: keyof typeof SILHOUETTES, from: string, to: string, ink: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
      <radialGradient id="light" cx="0.3" cy="0.25" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="800" height="800" fill="url(#bg)"/>
    <rect width="800" height="800" fill="url(#light)"/>
    <ellipse cx="400" cy="690" rx="230" ry="26" fill="#000" opacity="0.10"/>
    <g fill="${ink}" stroke="${ink}" stroke-linejoin="round" stroke-linecap="round">${SILHOUETTES[kind]}</g>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}

async function paymentProofPhoto(amount: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="900" viewBox="0 0 540 900" font-family="Arial, Helvetica, sans-serif">
    <rect width="540" height="900" fill="#f4f4f4"/>
    <rect width="540" height="150" fill="#ff7900"/>
    <text x="270" y="92" text-anchor="middle" font-size="34" font-weight="700" fill="#fff">Orange Money</text>
    <rect x="30" y="190" width="480" height="520" rx="22" fill="#fff"/>
    <circle cx="270" cy="290" r="50" fill="#16a34a"/>
    <path d="M246 290l18 18 34-38" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="270" y="390" text-anchor="middle" font-size="28" font-weight="700" fill="#111">Transfert réussi</text>
    <text x="270" y="450" text-anchor="middle" font-size="44" font-weight="700" fill="#111">${amount}</text>
    <text x="270" y="510" text-anchor="middle" font-size="22" fill="#666">Vers : BOUTIQUE AWA</text>
    <text x="270" y="550" text-anchor="middle" font-size="22" fill="#666">Réf. : PP261122.1042.C58213</text>
    <text x="270" y="640" text-anchor="middle" font-size="20" fill="#999">Exemple fictif — données de démonstration</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 84 }).toBuffer();
}

/* --------------------------------------------------------------- catalogue */

const PRODUCTS = [
  { key: "robe-wax", name: "Robe wax « Élégance »", category: "Robes", price: "25 000 FCFA", kind: "robe", colors: ["#fde68a", "#f59e0b", "#7c2d12"], description: "Robe mi-longue en wax 100 % coton, coupe cintrée, manches courtes. Tailles S à XL. Lavage à 30°. Disponible en jaune soleil, bleu roi et rouge bordeaux." },
  { key: "robe-soiree", name: "Robe de soirée satin", category: "Robes", price: "38 000 FCFA", kind: "robe", colors: ["#fbcfe8", "#db2777", "#500724"], description: "Robe longue en satin, dos nu, fente sur le côté. Tailles S à L. Idéale pour les mariages et cérémonies. Housse offerte." },
  { key: "ensemble-pagne", name: "Ensemble pagne 2 pièces", category: "Ensembles", price: "30 000 FCFA", kind: "robe", colors: ["#bbf7d0", "#16a34a", "#14532d"], description: "Haut péplum et jupe droite en pagne. Tailles M à XXL. Couture sur mesure possible sous 5 jours (+5 000 FCFA)." },
  { key: "sac-cuir", name: "Sac à main cuir marron", category: "Sacs", price: "18 000 FCFA", kind: "sac", colors: ["#fed7aa", "#c2410c", "#431407"], description: "Sac à main en cuir véritable, fermeture éclair, deux anses et une bandoulière amovible. Dimensions : 32 × 24 × 12 cm." },
  { key: "sandales", name: "Sandales cuir tressé", category: "Chaussures", price: "12 000 FCFA", kind: "chaussure", colors: ["#e7e5e4", "#a8a29e", "#44403c"], description: "Sandales artisanales en cuir tressé, semelle souple. Pointures 36 à 42. Coloris marron ou noir." },
  { key: "escarpins", name: "Escarpins noirs", category: "Chaussures", price: "22 000 FCFA", kind: "chaussure", colors: ["#e2e8f0", "#64748b", "#0f172a"], description: "Escarpins vernis noirs, talon de 8 cm, bout pointu. Pointures 36 à 41. Boîte et sachet de protection inclus." },
  { key: "chemise-wax", name: "Chemise homme wax", category: "Homme", price: "15 000 FCFA", kind: "chemise", colors: ["#bfdbfe", "#2563eb", "#172554"], description: "Chemise manches courtes en wax, coupe droite. Tailles M à XXL. Motifs géométriques bleus." },
  { key: "boubou", name: "Boubou brodé", category: "Homme", price: "35 000 FCFA", kind: "chemise", colors: ["#e9d5ff", "#7c3aed", "#2e1065"], description: "Boubou trois pièces en bazin brodé main. Tailles L à XXL. Coloris blanc, bleu ciel ou bordeaux." },
  { key: "foulard", name: "Foulard en soie", category: "Accessoires", price: "6 500 FCFA", kind: "foulard", colors: ["#a5f3fc", "#0891b2", "#083344"], description: "Foulard carré 90 × 90 cm, toucher soie. Plusieurs motifs disponibles en boutique." },
  { key: "collier", name: "Collier perles dorées", category: "Accessoires", price: "9 000 FCFA", kind: "collier", colors: ["#fef9c3", "#ca8a04", "#422006"], description: "Collier en perles dorées, longueur réglable 40 à 46 cm. Rupture de stock momentanée.", active: false },
] as const;

const BUSINESS_INFO = `PRÉSENTATION
Boutique Awa est une boutique de mode à Douala : robes, ensembles en pagne, chaussures, sacs et accessoires pour femme et homme.

ADRESSE
Rue Joss, Akwa, Douala — à 50 m de la pharmacie du Centre. Parking devant la boutique.

HORAIRES
Du lundi au samedi, de 8 h 30 à 19 h. Fermé le dimanche et les jours fériés.

LIVRAISON
Douala : 1 000 FCFA (Akwa, Bonanjo, Bali), 1 500 FCFA (Bonamoussadi, Makepe, Kotto, Logpom), 2 000 FCFA (Bonabéri, Yassa). Livraison le jour même pour toute commande avant 14 h.
Yaoundé et autres villes : expédition par agence de voyage, 2 500 FCFA, délai 24 à 48 h.

PAIEMENT
Orange Money et MTN MoMo au 6 90 11 22 33 (nom : Boutique Awa), ou en espèces à la livraison à Douala.

ÉCHANGES ET RETOURS
Échange possible sous 3 jours, article non porté et avec son étiquette. Pas de remboursement en espèces.

ESSAYAGE
Essayage en boutique sur rendez-vous, du lundi au samedi.`;

const SYSTEM_PROMPT = "L'entreprise est une boutique : elle vend des produits à ses clients à partir d'un catalogue. Donne toujours les prix exacts du catalogue, sans jamais en inventer. Tu es un commercial. Ton objectif est d'informer le prospect, de comprendre son besoin par quelques questions, puis de recueillir ses coordonnées et son besoin pour que l'équipe le recontacte. N'invente jamais un prix, une caractéristique ou un délai qui n'est pas indiqué. Adopte un ton amical et chaleureux : sois accueillant et bienveillant, tu peux utiliser quelques emojis avec modération, tout en restant clair.";

const WEEK_HOURS = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [day, [{ start: "08:30", end: "19:00" }]]).concat([["sun", []]]));

/* ------------------------------------------------------------ conversations */

type Author = "C" | "A" | "H";
type Line = [minutesAgo: number, author: Author, text: string, meta?: Record<string, unknown>];

interface ConversationSeed {
  name: string | null;
  phone: string;
  stage: "NEW" | "INTERESTED" | "ORDERED" | "CALLBACK";
  status?: "OPEN" | "HUMAN_HANDOFF" | "CLOSED";
  aiEnabled?: boolean;
  unread?: boolean;
  fromAd?: boolean;
  paymentCheck?: boolean;
  optedOut?: boolean;
  qualification?: "NOT_QUALIFIED" | "QUALIFYING" | "QUALIFIED";
  leadScore?: number;
  leadData?: Record<string, string>;
  lines: Line[];
}

const ai = (intent: string, extra: Record<string, unknown> = {}) => ({
  intent, confidence: 0.92, leadScore: 40, qualificationStatus: "qualifying", needsHuman: false, nextAction: "continue",
  imageSent: false, photosSent: 0, actions: [], claimRetried: false, claimsUnresolved: [], correctionsUsed: 0, examplesUsed: 0,
  closedHours: false, welcomeSent: false, answeringFile: false, ...extra,
});

function featuredConversations(productIds: Record<string, string>): ConversationSeed[] {
  const product = (key: string) => ({ discussedProductId: productIds[key], discussedProductName: PRODUCTS.find((item) => item.key === key)!.name });
  return [
    {
      name: "Marie Ngo Bassa", phone: "237677450012", stage: "ORDERED", qualification: "QUALIFIED", leadScore: 92, unread: true,
      leadData: { name: "Marie Ngo Bassa", quartier: "Bonamoussadi", product: "Robe wax « Élégance » taille M" },
      lines: [
        [26, "C", "Bonjour, vous avez la robe wax jaune en taille M ?"],
        [25, "A", "Bonjour Marie 😊 Oui, la robe wax « Élégance » est disponible en jaune soleil, taille M : 25 000 FCFA. Je vous envoie la photo ?", ai("demande_disponibilite", { ...product("robe-wax"), welcomeSent: true })],
        [24, "C", "Oui je veux voir"],
        [23, "A", "Voici la robe. Elle est en wax 100 % coton, coupe cintrée.", ai("demande_information", { ...product("robe-wax"), imageSent: true, photosSent: 1, productNames: ["Robe wax « Élégance »"] })],
        [20, "C", "Elle est belle mais c'est un peu cher, vous faites à combien ?"],
        [19, "A", "Pour vous, je peux vous la laisser à 23 900 FCFA 😊 C'est une très belle pièce.", ai("demande_prix", { ...product("robe-wax"), negotiationRequested: true, negotiation: { productName: "Robe wax « Élégance »", price: 23900, round: 1, isFinal: false } })],
        [15, "C", "D'accord je la prends. Livraison à Bonamoussadi, carrefour Maçon"],
        [14, "A", "Parfait Marie ! Votre commande est enregistrée : 1 robe wax « Élégance » taille M, livraison à Bonamoussadi (1 500 FCFA). Vous serez livrée aujourd'hui 🙏", ai("demande_commande", { ...product("robe-wax"), leadScore: 92, qualificationStatus: "qualified", actions: [{ type: "order", result: "create" }] })],
        [6, "C", "Merci beaucoup 🙏 je paie à la livraison"],
        [5, "A", "Avec plaisir Marie ! C'est noté, paiement en espèces à la livraison. À tout à l'heure 😊", ai("remerciement", { leadScore: 92, qualificationStatus: "qualified" })],
      ],
    },
    {
      name: "Aïcha Bello", phone: "237699871245", stage: "CALLBACK", status: "HUMAN_HANDOFF", aiEnabled: false, unread: true, qualification: "QUALIFIED", leadScore: 60,
      leadData: { name: "Aïcha Bello", quartier: "Makepe" },
      lines: [
        [95, "C", "Bonsoir. J'ai reçu ma commande hier mais la fermeture du sac est cassée"],
        [94, "A", "Bonsoir Aïcha, je suis vraiment désolée pour ce désagrément. Je préviens tout de suite la responsable : elle vous répond très vite pour organiser l'échange.", ai("reclamation", { needsHuman: true, nextAction: "handoff", leadScore: 60 })],
        [41, "C", "Vous pouvez m'appeler svp ? Je veux un échange aujourd'hui"],
      ],
    },
    {
      name: "Christelle Fotso", phone: "237655908877", stage: "ORDERED", unread: true, paymentCheck: true, qualification: "QUALIFIED", leadScore: 88,
      leadData: { name: "Christelle Fotso", quartier: "Akwa", product: "Escarpins noirs 38" },
      lines: [
        [130, "C", "Bonjour, les escarpins noirs en 38 svp"],
        [129, "A", "Bonjour Christelle 😊 Les escarpins noirs sont disponibles en 38 : 22 000 FCFA. Vous les voulez en livraison ou vous passez en boutique ?", ai("demande_disponibilite", product("escarpins"))],
        [126, "C", "Livraison à Akwa. Je paie par Orange Money"],
        [125, "A", "Très bien ! Commande enregistrée : escarpins noirs 38, livraison à Akwa (1 000 FCFA). Vous pouvez envoyer 23 000 FCFA par Orange Money au 6 90 11 22 33 (Boutique Awa).", ai("demande_commande", { ...product("escarpins"), actions: [{ type: "order", result: "create" }], leadScore: 88, qualificationStatus: "qualified" })],
        [58, "C", "__PAYMENT_PROOF__"],
        [57, "A", "Merci Christelle, j'ai bien reçu votre capture. La boutique vérifie le paiement et vous confirme la livraison dans un instant 🙏", ai("demande_paiement", { answeringFile: true, leadScore: 88, qualificationStatus: "qualified" })],
      ],
    },
    {
      name: "Paul Tchoua", phone: "237670336541", stage: "INTERESTED", unread: true, qualification: "QUALIFYING", leadScore: 64,
      leadData: { name: "Paul Tchoua", product: "Boubou brodé XL" },
      lines: [
        [47, "C", "Bonjour"],
        [47, "A", "Bonjour 👋 Bienvenue chez Boutique Awa ! Dites-moi ce que vous cherchez, je vous réponds tout de suite.", { kind: "welcome" }],
        [45, "C", "Le boubou brodé existe en XL ?"],
        [44, "A", "Oui Paul, le boubou brodé est disponible en XL, en blanc, bleu ciel ou bordeaux : 35 000 FCFA les trois pièces. Quelle couleur vous intéresse ?", ai("demande_disponibilite", product("boubou"))],
        [18, "C", "Bleu ciel. Vous faites la retouche des manches sur place ?"],
        [17, "A", "Bonne question Paul. Je me renseigne auprès de la couturière et je vous confirme rapidement. En attendant, je peux vous réserver le boubou bleu ciel en XL ?", ai("demande_information", { ...product("boubou"), missingInfo: "retouche des manches sur place (prix et délai)", leadScore: 64 })],
      ],
    },
    {
      name: "Jean-Marc Etoundi", phone: "237691204578", stage: "NEW", fromAd: true, qualification: "NOT_QUALIFIED", leadScore: 35,
      lines: [
        [72, "C", "Bonjour ! Puis-je en savoir plus à ce sujet ?"],
        [71, "A", "Bonjour 👋 Bienvenue chez Boutique Awa ! Vous avez vu notre chemise homme en wax : elle est à 15 000 FCFA, tailles M à XXL. Quelle taille portez-vous ?", ai("demande_information", { ...product("chemise-wax"), welcomeSent: false })],
        [69, "C", "L, c'est du coton ?"],
        [68, "A", "Oui, c'est du wax 100 % coton, coupe droite, très agréable à porter. Je vous envoie la photo ?", ai("demande_information", product("chemise-wax"))],
      ],
    },
    {
      name: "Nadège Mballa", phone: "237677889023", stage: "INTERESTED", qualification: "QUALIFIED", leadScore: 78,
      leadData: { name: "Nadège Mballa", product: "Robe de soirée satin" },
      lines: [
        [190, "C", "Bonjour je voudrais essayer la robe de soirée avant d'acheter"],
        [189, "A", "Bonjour Nadège 😊 Avec plaisir ! L'essayage se fait en boutique sur rendez-vous. Samedi, il me reste 10 h ou 14 h 30. Lequel vous arrange ?", ai("demande_information", product("robe-soiree"))],
        [186, "C", "Samedi 10h c'est parfait"],
        [185, "A", "C'est noté Nadège : essayage samedi à 10 h, à la boutique d'Akwa (Rue Joss). À samedi ! 😊", ai("demande_information", { ...product("robe-soiree"), actions: [{ type: "booking", result: "book" }], leadScore: 78, qualificationStatus: "qualified" })],
      ],
    },
    {
      name: "Yves Ndongo", phone: "237650771299", stage: "INTERESTED", qualification: "QUALIFYING", leadScore: 70,
      leadData: { name: "Yves Ndongo", product: "Sac à main cuir marron" },
      lines: [
        [250, "C", "Le sac marron c'est combien dernier prix ?"],
        [249, "A", "Bonjour Yves ! Le sac à main en cuir marron est à 18 000 FCFA. Pour vous, je peux le faire à 17 200 FCFA 😊", ai("demande_prix", { ...product("sac-cuir"), negotiationRequested: true, negotiation: { productName: "Sac à main cuir marron", price: 17200, round: 1, isFinal: false } })],
        [244, "C", "Faites 15000"],
        [243, "A", "Je comprends Yves. Mon dernier prix, c'est 16 200 FCFA, et c'est du cuir véritable avec la bandoulière offerte. On valide ?", ai("demande_prix", { ...product("sac-cuir"), negotiationRequested: true, negotiation: { productName: "Sac à main cuir marron", price: 16200, round: 3, isFinal: true } })],
        [240, "C", "Ok je réfléchis et je reviens"],
        [239, "A", "Pas de souci Yves, je vous le garde de côté jusqu'à demain soir 😊", ai("autre", product("sac-cuir"))],
      ],
    },
    {
      name: "Brice Kamga", phone: "237696442018", stage: "INTERESTED", status: "HUMAN_HANDOFF", aiEnabled: false, qualification: "QUALIFYING", leadScore: 55,
      leadData: { name: "Brice Kamga" },
      lines: [
        [320, "C", "Bonjour, je veux commander 12 chemises wax pour mon équipe. Vous faites un prix de gros ?"],
        [319, "A", "Bonjour Brice ! Belle commande 😊 Pour un prix de gros, je préfère vous mettre en relation avec la responsable : elle vous répond très vite.", ai("demande_prix", { ...product("chemise-wax"), needsHuman: true, nextAction: "handoff", missingInfo: "prix de gros à partir de 10 pièces" })],
        [300, "H", "Bonjour Brice, c'est Awa. Pour 12 chemises, je vous fais 13 000 FCFA l'unité au lieu de 15 000. Quelles tailles vous faut-il ?", { sentBy: "Awa Ngono" }],
        [280, "C", "Super. 4 M, 6 L et 2 XL. Je passe payer demain matin"],
        [278, "H", "Parfait, je vous les prépare. À demain !", { sentBy: "Awa Ngono" }],
      ],
    },
    {
      name: "Fatima Oumarou", phone: "237699330147", stage: "CALLBACK", qualification: "QUALIFYING", leadScore: 58,
      leadData: { name: "Fatima Oumarou", quartier: "Bonapriso" },
      lines: [
        [410, "C", "Bonsoir, je voudrais un ensemble pagne sur mesure pour un mariage le mois prochain"],
        [409, "A", "Bonsoir Fatima 😊 Notre ensemble pagne 2 pièces est à 30 000 FCFA, et la couture sur mesure est possible sous 5 jours (+5 000 FCFA). Vous avez déjà votre pagne ou vous choisissez parmi les nôtres ?", ai("demande_information", product("ensemble-pagne"))],
        [400, "C", "J'ai mon pagne. Appelez-moi demain matin svp, c'est plus simple"],
        [399, "A", "Bien sûr Fatima, c'est noté : la boutique vous rappelle demain matin. Bonne soirée !", ai("demande_contact_humain", { ...product("ensemble-pagne"), leadScore: 58 })],
      ],
    },
    {
      name: "Samuel Njoya", phone: "237677015530", stage: "INTERESTED", qualification: "QUALIFYING", leadScore: 48,
      leadData: { name: "Samuel Njoya", product: "Sandales cuir tressé 42" },
      lines: [
        [1700, "C", "Vous avez les sandales en 42 ?"],
        [1699, "A", "Bonjour Samuel ! Oui, les sandales en cuir tressé sont disponibles en 42, en marron ou noir : 12 000 FCFA. Laquelle préférez-vous ?", ai("demande_disponibilite", product("sandales"))],
        [260, "A", "Bonjour Samuel 😊 Les sandales en 42 sont toujours disponibles. Souhaitez-vous que je vous les mette de côté ?", { kind: "follow_up", number: 1 }],
      ],
    },
    {
      name: "Sandrine Abega", phone: "237655667712", stage: "INTERESTED", qualification: "QUALIFYING", leadScore: 52,
      leadData: { name: "Sandrine Abega" },
      lines: [
        [520, "C", "[Transcription audio] Bonjour, s'il vous plaît, est-ce que vous livrez à Yaoundé ? Je veux le foulard en soie et peut-être un sac."],
        [519, "A", "Bonjour Sandrine 😊 Oui, nous expédions à Yaoundé par agence de voyage : 2 500 FCFA, sous 24 à 48 h. Le foulard en soie est à 6 500 FCFA et le sac en cuir marron à 18 000 FCFA. Je vous envoie les photos ?", ai("demande_livraison", product("foulard"))],
        [515, "C", "Oui envoyez"],
        [514, "A", "Voici les deux articles.", ai("demande_information", { ...product("foulard"), imageSent: true, photosSent: 2, productNames: ["Foulard en soie", "Sac à main cuir marron"] })],
      ],
    },
    {
      name: "Patrick Onana", phone: "237690558841", stage: "NEW", qualification: "NOT_QUALIFIED", leadScore: 30,
      lines: [
        [610, "C", "Vous êtes situés où exactement ?"],
        [609, "A", "Bonjour ! Nous sommes à Akwa, Rue Joss, à 50 m de la pharmacie du Centre. Je vous envoie la position 📍", ai("demande_localisation", { locationSent: true })],
        [600, "C", "Vous fermez à quelle heure le samedi ?"],
        [599, "A", "Le samedi, nous sommes ouverts de 8 h 30 à 19 h. À bientôt à la boutique 😊", ai("demande_information")],
      ],
    },
    {
      name: null, phone: "237655123456", stage: "NEW", qualification: "NOT_QUALIFIED", leadScore: 10,
      lines: [
        [735, "C", "Bonsoir"],
        [735, "A", "Bonsoir 👋 Bienvenue chez Boutique Awa ! Dites-moi ce que vous cherchez, je vous réponds tout de suite.", { kind: "welcome" }],
      ],
    },
    {
      name: "Mireille Kouam", phone: "237677903344", stage: "ORDERED", qualification: "QUALIFIED", leadScore: 95,
      leadData: { name: "Mireille Kouam", quartier: "Kotto", product: "Ensemble pagne 2 pièces L" },
      lines: [
        [1500, "C", "Bonjour, j'ai bien reçu mon ensemble, il est magnifique 😍"],
        [1499, "A", "Merci beaucoup Mireille, ça nous fait très plaisir ! N'hésitez pas à nous écrire pour vos prochaines envies 😊", ai("remerciement", { leadScore: 95, qualificationStatus: "qualified" })],
      ],
    },
    {
      name: "Estelle Ewane", phone: "237699120876", stage: "NEW", optedOut: true, qualification: "NOT_QUALIFIED", leadScore: 5,
      lines: [
        [2900, "A", "Bonjour 👋 Nouvelle collection de robes wax en boutique dès aujourd'hui, à partir de 25 000 FCFA. Répondez à ce message pour voir les photos.\n\nPour ne plus recevoir nos messages, répondez STOP.", { kind: "broadcast" }],
        [2880, "C", "STOP"],
        [2880, "A", "C'est noté, vous ne recevrez plus nos annonces. Vous pouvez toujours nous écrire ici si besoin. Bonne journée !", { kind: "opt_out" }],
      ],
    },
    {
      name: "Hervé Tagne", phone: "237650334490", stage: "NEW", status: "CLOSED", aiEnabled: false, qualification: "NOT_QUALIFIED", leadScore: 15,
      lines: [
        [3100, "C", "Vous vendez des costumes ?"],
        [3099, "A", "Bonjour Hervé ! Nous n'avons pas de costumes pour le moment. Côté homme, nous proposons des chemises en wax et des boubous brodés. Souhaitez-vous les voir ?", ai("demande_information", { missingInfo: "costumes pour homme (non vendus ?)" })],
        [3090, "C", "Non merci c'est bon"],
        [3089, "A", "Très bien Hervé, bonne journée et à bientôt !", ai("remerciement", { nextAction: "stop" })],
      ],
    },
  ];
}

const FIRST_NAMES = ["Arlette", "Boris", "Carine", "Dieudonné", "Élodie", "Franck", "Gisèle", "Hugues", "Inès", "Joël", "Kevin", "Laure", "Martial", "Nina", "Olivier", "Pascaline", "Rodrigue", "Solange", "Thierry", "Viviane", "William", "Yolande"];
const LAST_NAMES = ["Atangana", "Biloa", "Djoumessi", "Ekani", "Fouda", "Ngassa", "Hamadou", "Kengne", "Manga", "Nkoulou", "Owona", "Simo", "Tchinda", "Wamba", "Zambo", "Moukouri"];
const QUESTIONS: Array<[question: string, answer: string, productKey: string | null, intent: string]> = [
  ["Bonjour, c'est combien la robe wax ?", "Bonjour 😊 La robe wax « Élégance » est à 25 000 FCFA, tailles S à XL. Quelle taille vous faut-il ?", "robe-wax", "demande_prix"],
  ["Vous livrez à Bonabéri ?", "Oui, nous livrons à Bonabéri pour 2 000 FCFA, le jour même pour toute commande avant 14 h.", null, "demande_livraison"],
  ["Les sandales existent en 39 ?", "Oui, les sandales en cuir tressé sont disponibles en 39, en marron ou noir : 12 000 FCFA.", "sandales", "demande_disponibilite"],
  ["Je cherche un sac pour le bureau", "Je vous conseille notre sac à main en cuir marron, 18 000 FCFA, avec bandoulière amovible. Je vous envoie la photo ?", "sac-cuir", "demande_information"],
  ["Vous êtes ouverts dimanche ?", "Nous sommes ouverts du lundi au samedi, de 8 h 30 à 19 h. Le dimanche, la boutique est fermée.", null, "demande_information"],
  ["Le boubou c'est quel prix ?", "Le boubou brodé trois pièces est à 35 000 FCFA, tailles L à XXL.", "boubou", "demande_prix"],
  ["Je peux payer par MoMo ?", "Oui, vous pouvez payer par MTN MoMo ou Orange Money au 6 90 11 22 33 (Boutique Awa).", null, "demande_paiement"],
  ["Vous avez des escarpins rouges ?", "Pour le moment, nos escarpins sont en noir verni, 22 000 FCFA, pointures 36 à 41. Souhaitez-vous voir la photo ?", "escarpins", "demande_disponibilite"],
];

/* --------------------------------------------------------------------- main */

async function main() {
  assertLocalDatabase();
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);

  const organization = await prisma.organization.create({ data: { name: "Boutique Awa", whatsappNumber: "237690112233", freeAiResponsesRemaining: 0, createdAt: ago(64 * DAY) } });
  const organizationId = organization.id;
  const passwordHash = await hashPassword(DEMO_ACCOUNT.password);
  await prisma.user.create({ data: { organizationId, email: DEMO_ACCOUNT.email, passwordHash, name: "Awa Ngono", role: "ADMIN", createdAt: ago(64 * DAY) } });
  await prisma.user.create({ data: { organizationId, email: "carine@brayano.test", passwordHash, name: "Carine Mbarga", role: "AGENT", createdAt: ago(40 * DAY) } });
  await prisma.user.create({ data: { organizationId, email: "junior@brayano.test", passwordHash, name: "Junior Essomba", role: "AGENT", active: false, createdAt: ago(21 * DAY) } });

  const settings = await prisma.aiSettings.create({
    data: {
      organizationId, agentName: "Awa", businessInfo: BUSINESS_INFO, systemPrompt: SYSTEM_PROMPT,
      welcomeMessage: "Bonjour 👋 Bienvenue chez Boutique Awa ! Dites-moi ce que vous cherchez, je vous réponds tout de suite.\n---\nBonjour et bienvenue chez Boutique Awa 😊 Comment puis-je vous aider ?",
      qualificationFields: ["name", "quartier", "product"], responseDelaySeconds: 5,
      businessHoursEnabled: true, businessHours: WEEK_HOURS, businessTimezone: "Africa/Douala", closedMessage: "Nous répondons dès 8 h 30. Pour une urgence, appelez le 6 90 11 22 33.",
      followUpEnabled: true, followUpDelayHours: 24, followUpMax: 1,
      agentDomain: "Boutique / Commerce", agentRole: "Commercial / Conseiller", agentTone: "Amical & chaleureux", personaPromptedAt: ago(63 * DAY),
      negotiationEnabled: true, negotiationMaxDiscountPercent: 10,
      shopLatitude: 4.0483, shopLongitude: 9.7043, shopLocationLabel: "Boutique Awa — Akwa",
    },
  });
  await prisma.aiSettings.update({ where: { id: settings.id }, data: { onboardingTestHash: settingsFingerprint(settings) } });

  await prisma.billingSubscription.create({ data: { organizationId, plan: "pro", messageLimit: 5000, messagesUsed: 1284, periodStartedAt: ago(11 * DAY), startedAt: ago(41 * DAY), expiresAt: new Date(NOW + 19 * DAY) } });
  await prisma.whatsAppAccount.create({ data: { organizationId, phoneNumber: "237690112233@s.whatsapp.net", status: "CONNECTED", lastConnectedAt: ago(12 * DAY) } });

  /* Catalogue */
  const productIds: Record<string, string> = {};
  for (const [index, item] of PRODUCTS.entries()) {
    const created = await prisma.product.create({
      data: { organizationId, name: item.name, description: item.description, category: item.category, price: item.price, active: !("active" in item) || item.active !== false, createdAt: ago((30 - index) * DAY), updatedAt: ago((12 - index) * HOUR) },
    });
    productIds[item.key] = created.id;
    await saveProductImage(organizationId, created.id, "image/jpeg", await productPhoto(item.kind, item.colors[0], item.colors[1], item.colors[2]), env.APP_URL);
  }
  // saveProductImage met à jour updatedAt : on remet un ordre stable (les plus récents d'abord dans le catalogue).
  for (const [index, item] of PRODUCTS.entries()) {
    await prisma.$executeRaw`UPDATE products SET updated_at = ${ago((index + 1) * HOUR)} WHERE id = ${productIds[item.key]}`;
  }

  /* Conversations mises en avant */
  const conversationIds: Record<string, string> = {};
  const contactIds: Record<string, string> = {};
  let externalCounter = 0;
  for (const seed of featuredConversations(productIds)) {
    const firstAt = ago(Math.max(...seed.lines.map((line) => line[0])) * MINUTE + MINUTE);
    const contact = await prisma.contact.create({
      data: { organizationId, whatsappJid: `${seed.phone}@s.whatsapp.net`, displayName: seed.name, optedOut: Boolean(seed.optedOut), optedOutAt: seed.optedOut ? ago(2880 * MINUTE) : null, createdAt: firstAt },
    });
    const inbound = seed.lines.filter((line) => line[1] === "C");
    const lastInboundAt = inbound.length ? ago(Math.min(...inbound.map((line) => line[0])) * MINUTE) : null;
    const lastAt = ago(Math.min(...seed.lines.map((line) => line[0])) * MINUTE);
    const conversation = await prisma.conversation.create({
      data: {
        organizationId, contactId: contact.id, stage: seed.stage, status: seed.status ?? "OPEN", aiEnabled: seed.aiEnabled ?? true,
        qualificationStatus: seed.qualification ?? "NOT_QUALIFIED", leadScore: seed.leadScore ?? null, leadData: seed.leadData ?? {},
        startedFromAd: Boolean(seed.fromAd), paymentCheckPending: Boolean(seed.paymentCheck), topicGateOpened: false,
        lastInboundAt, lastReadAt: seed.unread ? null : new Date(NOW), createdAt: firstAt, updatedAt: lastAt,
      },
    });
    conversationIds[seed.name ?? seed.phone] = conversation.id;
    contactIds[seed.name ?? seed.phone] = contact.id;

    for (const [minutesAgo, author, text, meta] of seed.lines) {
      const createdAt = ago(minutesAgo * MINUTE - (author === "C" ? 0 : 20_000));
      if (text === "__PAYMENT_PROOF__") {
        const stored = await saveClientMedia(organizationId, await paymentProofPhoto("23 000 FCFA"), "image/jpeg", "capture-orange-money.jpg");
        await prisma.message.create({
          data: {
            conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "IMAGE", content: "[Photo reçue]", externalId: `DEMO-${externalCounter++}`,
            mediaFile: stored.file, mediaMimeType: stored.mimeType, mediaName: stored.name, createdAt,
            aiMeta: { mediaKind: "payment_proof", mediaSummary: "Capture d'un transfert Orange Money de 23 000 FCFA vers Boutique Awa.", mediaNote: "[Fichier reçu : preuve de paiement — analyse automatique : transfert Orange Money de 23 000 FCFA. Tu ne peux pas vérifier ce fichier toi-même.]", mediaStored: true },
          },
        });
        continue;
      }
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id, direction: author === "C" ? "INBOUND" : "OUTBOUND", author: author === "C" ? "CONTACT" : author === "A" ? "AI" : "HUMAN",
          type: "TEXT", content: text, externalId: author === "C" ? `DEMO-${externalCounter++}` : null, createdAt, ...(meta ? { aiMeta: meta as object } : {}),
        },
      });
      const sentNames = (meta?.productNames as string[] | undefined) ?? [];
      for (const [photoIndex, productName] of sentNames.entries()) {
        const item = PRODUCTS.find((entry) => entry.name === productName);
        if (item) await prisma.sentProductImage.create({ data: { whatsappMessageId: `DEMO-IMG-${message.id}-${photoIndex}`, conversationId: conversation.id, productId: productIds[item.key]!, createdAt } });
      }
    }
  }

  /* Historique des 60 derniers jours : volume réaliste pour les graphiques et les tendances */
  const background: Array<{ conversationId: string; contactName: string; phone: string; at: Date; ordered: boolean }> = [];
  for (let day = 1; day <= 60; day += 1) {
    const weekday = new Date(NOW - day * DAY).getUTCDay();
    const base = day <= 14 ? 9.5 - day * 0.22 : day <= 30 ? 5.2 : 3.4;
    const volume = Math.max(0, Math.round(base * (weekday === 0 ? 0.4 : weekday === 6 ? 1.25 : 1) + random() * 3 - 1));
    for (let index = 0; index < volume; index += 1) {
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const phone = `2376${String(50000000 + Math.floor(random() * 49999999)).padStart(8, "0")}`;
      const startAt = new Date(NOW - day * DAY - Math.floor(random() * 9 * HOUR) - 2 * HOUR);
      const roll = random();
      const stage = roll < 0.3 ? "NEW" : roll < 0.68 ? "INTERESTED" : roll < 0.92 ? "ORDERED" : "CALLBACK";
      const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: `${phone}@s.whatsapp.net`, displayName: name, createdAt: startAt } });
      const exchanges = 1 + Math.floor(random() * 3);
      const lastAt = new Date(startAt.getTime() + exchanges * 4 * MINUTE);
      const conversation = await prisma.conversation.create({
        data: {
          organizationId, contactId: contact.id, stage, status: "OPEN", aiEnabled: true, qualificationStatus: stage === "ORDERED" ? "QUALIFIED" : "QUALIFYING",
          leadScore: stage === "ORDERED" ? 90 : 45, leadData: { name }, startedFromAd: random() < 0.25, lastInboundAt: lastAt, lastReadAt: new Date(NOW), createdAt: startAt, updatedAt: lastAt,
        },
      });
      for (let turn = 0; turn < exchanges; turn += 1) {
        const [question, answer, productKey, intent] = pick(QUESTIONS);
        const at = new Date(startAt.getTime() + turn * 4 * MINUTE);
        await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: question, externalId: `DEMO-${externalCounter++}`, createdAt: at } });
        await prisma.message.create({
          data: {
            conversationId: conversation.id, direction: "OUTBOUND", author: "AI", type: "TEXT", content: answer, createdAt: new Date(at.getTime() + 25_000),
            aiMeta: ai(intent, productKey ? { discussedProductId: productIds[productKey], discussedProductName: PRODUCTS.find((item) => item.key === productKey)!.name } : {}) as object,
          },
        });
      }
      if (stage === "ORDERED") background.push({ conversationId: conversation.id, contactName: name, phone, at: lastAt, ordered: true });
    }
  }

  /* Commandes */
  const line = (key: string, quantity = 1) => {
    const item = PRODUCTS.find((entry) => entry.key === key)!;
    return { productId: productIds[key]!, name: item.name, quantity, unitPrice: item.price };
  };
  const amount = (key: string) => Number(PRODUCTS.find((entry) => entry.key === key)!.price.replace(/\D/g, ""));
  const orders: Array<{ who: string; phone: string; conversation?: string; address: string; items: Array<ReturnType<typeof line>>; total: number; status: "NEW" | "CONFIRMED" | "DELIVERED" | "CANCELLED"; paid?: string; minutesAgo: number; notes?: string }> = [
    { who: "Marie Ngo Bassa", phone: "237677450012", conversation: "Marie Ngo Bassa", address: "Bonamoussadi, carrefour Maçon", items: [line("robe-wax")], total: 23900 + 1500, status: "NEW", minutesAgo: 14, notes: "Taille M, jaune soleil. Paiement à la livraison." },
    { who: "Christelle Fotso", phone: "237655908877", conversation: "Christelle Fotso", address: "Akwa, immeuble Kassap, 2e étage", items: [line("escarpins")], total: 22000 + 1000, status: "NEW", minutesAgo: 125, notes: "Pointure 38." },
    { who: "Rodrigue Simo", phone: "237677201144", address: "Makepe, face Total", items: [line("chemise-wax", 2), line("foulard")], total: 2 * amount("chemise-wax") + amount("foulard") + 1500, status: "CONFIRMED", paid: "Orange Money", minutesAgo: 9 * 60 },
    { who: "Laure Biloa", phone: "237699450721", address: "Bonapriso, rue Njo-Njo", items: [line("robe-soiree")], total: amount("robe-soiree") + 1000, status: "CONFIRMED", minutesAgo: 26 * 60 },
    { who: "Mireille Kouam", phone: "237677903344", conversation: "Mireille Kouam", address: "Kotto, entrée Chefferie", items: [line("ensemble-pagne")], total: amount("ensemble-pagne") + 1500, status: "DELIVERED", paid: "MTN MoMo", minutesAgo: 3 * 24 * 60 },
    { who: "Thierry Manga", phone: "237650118833", address: "Yaoundé, Bastos (agence Touristique Express)", items: [line("boubou")], total: amount("boubou") + 2500, status: "DELIVERED", paid: "Orange Money", minutesAgo: 4 * 24 * 60 },
    { who: "Solange Owona", phone: "237696771209", address: "Logpom, carrefour Basong", items: [line("sac-cuir"), line("sandales")], total: amount("sac-cuir") + amount("sandales") + 1500, status: "DELIVERED", paid: "Espèces", minutesAgo: 6 * 24 * 60 },
    { who: "Kevin Fouda", phone: "237655340087", address: "Bali, derrière le lycée", items: [line("sandales")], total: amount("sandales") + 1000, status: "CANCELLED", minutesAgo: 5 * 24 * 60, notes: "Annulée par le client." },
  ];
  for (const order of orders) {
    const createdAt = ago(order.minutesAgo * MINUTE);
    await prisma.order.create({
      data: {
        organizationId, conversationId: order.conversation ? conversationIds[order.conversation] ?? null : null, contactJid: `${order.phone}@s.whatsapp.net`, customerName: order.who, customerPhone: order.phone,
        deliveryAddress: order.address, notes: order.notes ?? null, items: order.items, total: order.total, status: order.status,
        paymentStatus: order.paid ? "PAID" : "UNPAID", paymentMethod: order.paid ?? null, paidAt: order.paid ? createdAt : null, source: "AI", createdAt, updatedAt: createdAt,
      },
    });
  }
  for (const entry of background.filter((item) => item.ordered)) {
    const key = pick(["robe-wax", "sac-cuir", "sandales", "chemise-wax", "ensemble-pagne", "escarpins", "foulard"] as const);
    await prisma.order.create({
      data: {
        organizationId, conversationId: entry.conversationId, contactJid: `${entry.phone}@s.whatsapp.net`, customerName: entry.contactName, customerPhone: entry.phone,
        deliveryAddress: pick(["Akwa", "Bonamoussadi", "Makepe", "Kotto", "Bonapriso", "Logpom", "Bali"]), items: [line(key)], total: amount(key) + 1500, status: "DELIVERED",
        paymentStatus: "PAID", paymentMethod: pick(["Orange Money", "MTN MoMo", "Espèces"]), paidAt: entry.at, source: "AI", createdAt: entry.at, updatedAt: entry.at,
      },
    });
  }

  /* Rendez-vous (essayages) */
  await prisma.appointmentSettings.create({
    data: { organizationId, enabled: true, timezone: "Africa/Douala", slotMinutes: 30, bufferMinutes: 10, capacity: 1, minNoticeMinutes: 120, horizonDays: 21, workingHours: WEEK_HOURS, closedDates: [], serviceLabel: "Essayage en boutique" },
  });
  await prisma.orderSettings.create({ data: { organizationId, enabled: true } });
  /** Prochain créneau à `hour:minute` (heure de Douala, UTC+1) dans `days` jours. */
  const slot = (days: number, hour: number, minute = 0) => {
    const date = new Date(NOW + days * DAY);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour - 1, minute));
  };
  const appointments: Array<[days: number, hour: number, minute: number, name: string, phone: string, status: "BOOKED" | "DONE" | "NO_SHOW" | "CANCELLED", source: "AI" | "HUMAN", conversation?: string]> = [
    [-1, 11, 0, "Viviane Kengne", "237677120034", "DONE", "AI"],
    [-1, 16, 30, "Joël Atangana", "237699004512", "NO_SHOW", "AI"],
    [0, 17, 0, "Inès Djoumessi", "237655781290", "BOOKED", "AI"],
    [0, 18, 0, "Olivier Nkoulou", "237690347765", "BOOKED", "HUMAN"],
    [1, 10, 0, "Nadège Mballa", "237677889023", "BOOKED", "AI", "Nadège Mballa"],
    [1, 14, 30, "Gisèle Wamba", "237650992211", "BOOKED", "AI"],
    [2, 9, 30, "Pascaline Ekani", "237696118450", "BOOKED", "AI"],
    [3, 15, 0, "Franck Tchinda", "237677665501", "CANCELLED", "AI"],
    [4, 11, 30, "Arlette Zambo", "237699230918", "BOOKED", "HUMAN"],
  ];
  for (const [days, hour, minute, name, phone, status, source, conversation] of appointments) {
    const startsAt = slot(days, hour, minute);
    await prisma.appointment.create({
      data: { organizationId, conversationId: conversation ? conversationIds[conversation] ?? null : null, contactName: name, contactPhone: phone, contactJid: `${phone}@s.whatsapp.net`, service: "Essayage en boutique", startsAt, endsAt: new Date(startsAt.getTime() + 30 * MINUTE), status, source, createdAt: ago(2 * DAY) },
    });
  }

  /* Messages groupés */
  const recipients = await prisma.contact.findMany({ where: { organizationId, optedOut: false }, take: 50, select: { id: true, whatsappJid: true } });
  const broadcasts: Array<[daysAgo: number, text: string, total: number, sent: number, failed: number, status: "DONE" | "CANCELLED"]> = [
    [2, "Bonjour 👋 Nouvelle collection de robes wax en boutique dès aujourd'hui, à partir de 25 000 FCFA. Répondez à ce message pour voir les photos.", 48, 48, 0, "DONE"],
    [9, "Ce samedi uniquement : -10 % sur tous nos sacs en cuir 👜 Répondez « SAC » pour réserver le vôtre.", 50, 49, 1, "DONE"],
    [16, "La boutique sera fermée ce vendredi (jour férié). Réouverture samedi à 8 h 30. Bonne fête à tous !", 37, 21, 0, "CANCELLED"],
  ];
  for (const [daysAgo, text, total, sent, failed, status] of broadcasts) {
    const created = await prisma.broadcast.create({ data: { organizationId, text, status, total, sentCount: sent, failedCount: failed, createdAt: ago(daysAgo * DAY), finishedAt: ago(daysAgo * DAY - 20 * MINUTE) } });
    await prisma.broadcastRecipient.createMany({
      data: recipients.slice(0, Math.min(total, recipients.length)).map((contact, index) => ({ broadcastId: created.id, contactId: contact.id, jid: contact.whatsappJid, status: index < sent ? ("SENT" as const) : ("SKIPPED" as const), sentAt: index < sent ? ago(daysAgo * DAY) : null })),
    });
  }

  /* Numéros ignorés, corrections, zones et commerciaux */
  await prisma.ignoredContact.createMany({
    data: [
      { organizationId, whatsappNumber: "237699000111", label: "Maman", createdAt: ago(30 * DAY) },
      { organizationId, whatsappNumber: "237677000222", label: "Fournisseur tissus (Marché Congo)", createdAt: ago(18 * DAY) },
    ],
  });
  await prisma.aiCorrection.createMany({
    data: [
      { organizationId, question: "Vous livrez à Bonamoussadi ?", wrongReply: "Je ne suis pas sûre que nous livrions dans ce quartier.", correctReply: "Oui, nous livrons à Bonamoussadi pour 1 500 FCFA, le jour même pour toute commande avant 14 h.", usedCount: 7, createdAt: ago(20 * DAY) },
      { organizationId, question: "", correctReply: "Propose toujours l'essayage en boutique quand un client hésite sur la taille.", usedCount: 12, createdAt: ago(15 * DAY) },
      { organizationId, question: "Vous faites des retouches ?", correctReply: "Oui, les retouches simples (ourlet, manches) sont offertes pour tout achat en boutique.", active: false, usedCount: 2, createdAt: ago(6 * DAY) },
    ],
  });
  const douala = await prisma.location.create({ data: { organizationId, name: "Douala", city: "Douala", recipientWhatsApp: "237690112233" } });
  const yaounde = await prisma.location.create({ data: { organizationId, name: "Yaoundé", city: "Yaoundé", recipientWhatsApp: "237677554433" } });
  const carine = await prisma.responsible.create({ data: { organizationId, locationId: douala.id, name: "Carine Mbarga", whatsappNumber: "237699887766" } });
  const junior = await prisma.responsible.create({ data: { organizationId, locationId: yaounde.id, name: "Junior Essomba", whatsappNumber: "237677554433" } });
  await prisma.organizationRoutingSettings.create({ data: { organizationId, fallbackResponsibleId: carine.id } });
  for (let index = 0; index < 34; index += 1) {
    const routedAt = ago(Math.floor(random() * 12 * DAY));
    const responsible = random() < 0.68 ? carine : junior;
    await prisma.prospectLead.create({
      data: { organizationId, locationId: responsible.locationId, responsibleId: responsible.id, contactName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, whatsappNumber: `2376${String(50000000 + Math.floor(random() * 49999999))}`, city: responsible.id === carine.id ? "Douala" : "Yaoundé", status: "ROUTED", routeStatus: "SENT", isRouted: true, routedAt, leadScore: 80, createdAt: routedAt },
    });
  }

  const counts = await Promise.all([prisma.conversation.count(), prisma.message.count(), prisma.order.count(), prisma.appointment.count(), prisma.product.count()]);
  console.log(`✅ Démo prête : ${counts[0]} conversations, ${counts[1]} messages, ${counts[2]} commandes, ${counts[3]} rendez-vous, ${counts[4]} produits.`);
  console.log(`   Connexion : ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`);
}

main()
  .catch((error) => {
    console.error("❌ Données de démonstration non créées :", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
