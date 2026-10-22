export type BillingPlanKey = "starter" | "pro" | "scale";

/** Ce que chaque forfait ouvre en plus de la base (réponses 24h/24, produits, photos, commandes, rendez-vous, étiquettes, horaires, corrections, chiffres). */
export interface PlanFeatures {
  /** Messages en masse (page « Messages groupés »). */
  broadcasts: boolean;
  /** Relances automatiques des clients intéressés qui ne répondent plus. */
  followUps: boolean;
  /** Nombre d'employés (en plus du propriétaire). */
  teamMembers: number;
}

export type BillingPlan = {
  key: BillingPlanKey;
  name: string;
  /** Prix pour 30 jours, en FCFA. */
  amount: number;
  /** « Messages de l'assistant » par période de 30 jours : un message = une réponse envoyée à un client (photos et relances comprises). */
  messages: number;
  features: PlanFeatures;
  /** Phrase d'accroche affichée sous le nom du forfait. */
  tagline: string;
  /** Lignes affichées dans le tableau de bord et sur la page d'accueil. */
  highlights: string[];
  activeWhatsAppChannels: number;
  assistants: number;
  /** Plus de limite de commerciaux (routage) : conservé pour compatibilité. */
  responsibleLimit: number | null;
  description: string;
};

/** Essai gratuit : un nombre de messages (pas de durée), avec les fonctions du forfait Pro pour tout montrer. */
export const TRIAL = {
  messages: 100,
  features: { broadcasts: true, followUps: true, teamMembers: 3 } satisfies PlanFeatures,
} as const;

const BASE_HIGHLIGHTS = [
  "Réponses automatiques 24h/24 sur WhatsApp",
  "Produits, photos, commandes et rendez-vous",
  "Suivi de vos clients et chiffres clairs",
];

export const BILLING_PLANS: Record<BillingPlanKey, BillingPlan> = {
  starter: {
    key: "starter",
    name: "Essentiel",
    amount: 10000,
    messages: 1000,
    features: { broadcasts: false, followUps: false, teamMembers: 0 },
    tagline: "Pour démarrer et ne plus rater de clients",
    highlights: ["1 000 messages de l'assistant par mois", ...BASE_HIGHLIGHTS],
    activeWhatsAppChannels: 1,
    assistants: 1,
    responsibleLimit: null,
    description: "1 000 messages de l'assistant par mois, un numéro WhatsApp, réponses 24h/24, produits, photos, commandes, rendez-vous et chiffres.",
  },
  pro: {
    key: "pro",
    name: "Pro",
    amount: 20000,
    messages: 5000,
    features: { broadcasts: true, followUps: true, teamMembers: 3 },
    tagline: "Pour vendre plus : annonces et relances",
    highlights: ["5 000 messages de l'assistant par mois", "Tout l'Essentiel", "Messages en masse en 1 clic", "Relances automatiques des clients", "3 employés dans la même boîte"],
    activeWhatsAppChannels: 1,
    assistants: 1,
    responsibleLimit: null,
    description: "Tout l'Essentiel, 5 000 messages par mois, messages en masse, relances automatiques et 3 employés.",
  },
  scale: {
    key: "scale",
    name: "Business",
    amount: 50000,
    messages: 15000,
    features: { broadcasts: true, followUps: true, teamMembers: 10 },
    tagline: "Pour une équipe et beaucoup de clients",
    highlights: ["15 000 messages de l'assistant par mois", "Tout le Pro", "10 employés dans la même boîte", "Aide à l'installation"],
    activeWhatsAppChannels: 1,
    assistants: 1,
    responsibleLimit: null,
    description: "Tout le Pro, 15 000 messages par mois, 10 employés et aide à l'installation.",
  },
};

export function getBillingPlan(planName: string): BillingPlan {
  const normalized = planName.trim().toLowerCase();
  const mapping: Record<string, BillingPlanKey> = {
    essentiel: "starter", essential: "starter", starter: "starter",
    pro: "pro", premium: "pro", professional: "pro",
    business: "scale", scale: "scale", entreprise: "scale", enterprise: "scale",
  };
  const matchedPlan = mapping[normalized];
  if (!matchedPlan) throw new Error(`Plan de paiement inconnu : ${planName}`);
  return BILLING_PLANS[matchedPlan];
}

/** Forfait le moins cher qui ouvre une fonction (pour le message « disponible à partir du forfait… »). */
export function cheapestPlanWith(feature: "broadcasts" | "followUps"): BillingPlan {
  return Object.values(BILLING_PLANS).sort((a, b) => a.amount - b.amount).find((plan) => plan.features[feature])!;
}
