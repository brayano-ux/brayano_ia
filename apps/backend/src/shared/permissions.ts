/**
 * Droits des membres de l'équipe.
 * - ADMIN (le propriétaire) : tout.
 * - AGENT (un employé) : répondre aux clients, suivre les commandes et les rendez-vous. Rien qui change la
 *   configuration de l'assistant, le numéro WhatsApp, le catalogue, les messages groupés, l'équipe ou la facturation.
 */
export type Role = "ADMIN" | "AGENT";

const ORG = "^/organizations/[^/?]+";
const END = "(?:[/?].*)?$";

interface Rule {
  methods: string[];
  pattern: RegExp;
}

const AGENT_RULES: Rule[] = [
  { methods: ["GET"], pattern: /^\/me(?:\?.*)?$/ },
  { methods: ["GET"], pattern: /^\/organizations(?:\?.*)?$/ },
  // Consultation
  { methods: ["GET"], pattern: new RegExp(`${ORG}/(?:stats|orders|appointments|products|prospects/export|ai-corrections|conversations)${END}`) },
  { methods: ["GET"], pattern: new RegExp(`${ORG}/whatsapp/status${END}`) },
  { methods: ["GET"], pattern: new RegExp(`${ORG}/routing/commercial-metrics${END}`) },
  // Répondre aux clients, étiqueter, corriger une réponse, marquer comme lu, essayer l'assistant
  { methods: ["POST"], pattern: new RegExp(`${ORG}/conversations/[^/?]+/(?:reply|read|stage|ai/enable|ai/disable|opt-out)(?:\\?.*)?$`) },
  { methods: ["POST"], pattern: new RegExp(`${ORG}/conversations/[^/?]+/messages/[^/?]+/correct(?:\\?.*)?$`) },
  { methods: ["POST"], pattern: new RegExp(`${ORG}/ai-test/reply(?:\\?.*)?$`) },
  // Commandes et rendez-vous (pas leurs réglages)
  { methods: ["PUT"], pattern: new RegExp(`${ORG}/orders/(?!settings(?:[/?]|$))[^/?]+(?:/payment)?(?:\\?.*)?$`) },
  { methods: ["POST"], pattern: new RegExp(`${ORG}/appointments(?:\\?.*)?$`) },
  { methods: ["PUT"], pattern: new RegExp(`${ORG}/appointments/(?!settings(?:[/?]|$))[^/?]+(?:\\?.*)?$`) },
];

export function isAllowedForRole(role: Role, method: string, url: string): boolean {
  if (role === "ADMIN") return true;
  const verb = method.toUpperCase();
  return AGENT_RULES.some((rule) => rule.methods.includes(verb) && rule.pattern.test(url));
}
