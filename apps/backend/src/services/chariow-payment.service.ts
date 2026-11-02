import { env } from "../config/env.js";
import { CHARIOW_PRODUCT_IDS, getBillingPlan } from "../billing/billing-plans.js";

type ChariowPayload = Record<string, unknown>;

async function requestChariow(path: string, init: RequestInit = {}): Promise<ChariowPayload> {
  if (!env.CHARIOW_API_KEY) {
    throw new Error("Ajoutez CHARIOW_API_KEY dans le .env.");
  }
  const response = await fetch(`https://api.chariow.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CHARIOW_API_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const raw = await response.text();
  let payload: ChariowPayload = {};
  try {
    payload = raw ? (JSON.parse(raw) as ChariowPayload) : {};
  } catch {
    payload = { message: raw };
  }
  if (!response.ok) {
    const detail = String((payload as { message?: unknown }).message ?? "Erreur Chariow.");
    throw new Error(detail);
  }
  return payload;
}

/**
 * Démarre une session de paiement Chariow pour un forfait. L'identifiant de l'organisation voyage dans
 * `custom_metadata`, renvoyé tel quel dans le Pulse `successful.sale` : c'est la seule façon fiable de relier
 * le paiement à l'organisation côté webhook, sans jamais faire confiance à ce que le navigateur enverrait.
 */
export async function createChariowCheckout(input: {
  plan: string;
  phoneNumber: string;
  countryCode: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string;
}) {
  const plan = getBillingPlan(input.plan);
  const productId = CHARIOW_PRODUCT_IDS[plan.key];

  // Le tableau de bord est une page unique sans route par URL : on ne peut renvoyer le client que vers
  // son adresse publique (CLIENT_DASHBOARD_URL), pas vers une page "billing.html" qui n'existe pas. Si
  // cette variable n'est pas configurée, on laisse Chariow afficher sa propre page de remerciement :
  // ça n'empêche pas l'activation, qui se fait côté webhook, indépendamment de ce retour navigateur.
  const redirectUrl = env.CLIENT_DASHBOARD_URL
    ? `${env.CLIENT_DASHBOARD_URL.replace(/\/+$/, "")}?chariow=done`
    : undefined;

  const payload = await requestChariow("/checkout", {
    method: "POST",
    body: JSON.stringify({
      product_id: productId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      phone: { number: input.phoneNumber, country_code: input.countryCode },
      ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
      custom_metadata: { organization_id: input.organizationId },
    }),
  });

  const data = (payload as { data?: { payment?: { checkout_url?: unknown }; purchase?: { id?: unknown } } }).data;
  const checkoutUrl = data?.payment?.checkout_url;
  if (typeof checkoutUrl !== "string" || !checkoutUrl) {
    throw new Error("Chariow n'a pas renvoyé de lien de paiement.");
  }

  return {
    checkoutUrl,
    saleId: typeof data?.purchase?.id === "string" ? data.purchase.id : null,
    plan,
  };
}
