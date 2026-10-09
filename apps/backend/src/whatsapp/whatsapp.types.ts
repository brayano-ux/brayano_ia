export type WhatsAppConnectionStatus = "DISCONNECTED" | "QR_PENDING" | "CONNECTED";

export interface IncomingWhatsAppMessage {
  externalId: string;
  fromJid: string;
  text: string;
  timestamp: Date;
  audio?: {
    data: Buffer;
    mimeType: string;
  };
}

/** Message envoyé par un humain depuis le téléphone du numéro connecté (pas par l'application). */
export interface HumanOutgoingMessage {
  externalId: string;
  toJid: string;
  text: string | null;
  timestamp: Date;
}

/**
 * Pourquoi un numéro n'est plus connecté :
 * - logged_out : déconnecté depuis le téléphone (Appareils liés) ou session invalidée par WhatsApp
 * - connection_lost : connexion coupée (réseau, serveur), reconnexion automatique en cours
 * - manual : déconnexion demandée volontairement
 */
export type ConnectionLossReason = "logged_out" | "connection_lost" | "manual";

export interface ConnectionUpdatePayload {
  status: WhatsAppConnectionStatus;
  phoneNumber?: string;
  reason?: ConnectionLossReason;
  /** Explication lisible de la fermeture, avec le code WhatsApp (ex. « Session ouverte ailleurs (code 440) »). */
  detail?: string;
}

/**
 * Contrat stable entre le reste de l'application et la couche WhatsApp.
 * Aucune autre partie du code ne doit importer "baileys" directement —
 * seul BaileysWhatsAppProvider a le droit de le faire. Cela permet de
 * remplacer cette implémentation par OfficialWhatsAppProvider (API Meta)
 * sans toucher au reste de l'application.
 */
export interface WhatsAppProvider {
  connect(): Promise<void>;
  connectWithPairingCode?(phoneNumber: string): Promise<string>;
  disconnect(): Promise<void>;
  getStatus(): WhatsAppConnectionStatus;
  getQRCode(): string | null; // data URL (image/png en base64), ou null si non disponible
  getPairingCode?(): string | null;
  sendMessage(jid: string, text: string): Promise<void>;
  sendImage(jid: string, imageUrl: string, caption?: string): Promise<void>;
  onMessage(handler: (message: IncomingWhatsAppMessage) => void): void;
  /** Un humain écrit à un prospect depuis le téléphone : l'IA doit se mettre en pause. */
  onHumanMessage?(handler: (message: HumanOutgoingMessage) => void): void;
  onConnectionUpdate(handler: (update: ConnectionUpdatePayload) => void): void;
}
