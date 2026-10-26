import type { Prisma } from "../generated/prisma/client.js";

export interface StoredMediaRef {
  file: string;
  mimeType: string;
  name: string | null;
}

export interface RecordInboundMessageInput {
  organizationId: string;
  fromJid: string;
  externalId: string;
  text: string;
  timestamp: Date;
  type?: "TEXT" | "IMAGE" | "DOCUMENT";
  media?: StoredMediaRef | null;
  /** Analyse automatique d'un fichier reçu : { mediaKind, mediaNote }. */
  aiMeta?: Prisma.InputJsonValue | null;
  /** Vrai si ce message vient d'une publicité Facebook/Instagram « Cliquer pour WhatsApp » ; n'a d'effet qu'à la création de la conversation. */
  startedFromAd?: boolean;
}

export interface RecordOutboundMessageInput {
  conversationId: string;
  text: string;
  author: "HUMAN" | "AI";
  /** Pourquoi l'IA a répondu ainsi (intention, actions...). Affiché au propriétaire. */
  aiMeta?: Prisma.InputJsonValue | null;
}
