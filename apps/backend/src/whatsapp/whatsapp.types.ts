export type WhatsAppConnectionStatus = "DISCONNECTED" | "QR_PENDING" | "CONNECTED";

export interface IncomingWhatsAppMessage {
  externalId: string;
  fromJid: string;
  text: string;
  timestamp: Date;
}

export interface ConnectionUpdatePayload {
  status: WhatsAppConnectionStatus;
  phoneNumber?: string;
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
  disconnect(): Promise<void>;
  getStatus(): WhatsAppConnectionStatus;
  getQRCode(): string | null; // data URL (image/png en base64), ou null si non disponible
  sendMessage(jid: string, text: string): Promise<void>;
  onMessage(handler: (message: IncomingWhatsAppMessage) => void): void;
  onConnectionUpdate(handler: (update: ConnectionUpdatePayload) => void): void;
}
