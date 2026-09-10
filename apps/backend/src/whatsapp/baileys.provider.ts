import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import type {
  ConnectionUpdatePayload,
  IncomingWhatsAppMessage,
  WhatsAppConnectionStatus,
  WhatsAppProvider,
} from "./whatsapp.types.js";

const logger = pino({ level: "silent" }); // Baileys est très verbeux ; on garde nos propres logs applicatifs

export class BaileysWhatsAppProvider implements WhatsAppProvider {
  private socket: WASocket | null = null;
  private status: WhatsAppConnectionStatus = "DISCONNECTED";
  private qrDataUrl: string | null = null;

  private messageHandlers: Array<(message: IncomingWhatsAppMessage) => void> = [];
  private connectionHandlers: Array<(update: ConnectionUpdatePayload) => void> = [];

  constructor(private readonly authDir: string) {}

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.socket = makeWASocket({
      auth: state,
      version,
      logger,
      printQRInTerminal: false,
    });

    this.socket.ev.on("creds.update", saveCreds);

    this.socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrDataUrl = await QRCode.toDataURL(qr);
        this.setStatus("QR_PENDING");
      }

      if (connection === "open") {
        this.qrDataUrl = null;
        const phoneNumber = this.socket?.user?.id?.split(":")[0];
        this.setStatus("CONNECTED", phoneNumber);
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        this.setStatus("DISCONNECTED");

        if (shouldReconnect) {
          await this.connect();
        }
      }
    });

    this.socket.ev.on("messages.upsert", ({ messages }) => {
      for (const msg of messages) {
        if (msg.key.fromMe || !msg.message) continue;

        const remoteJid = msg.key.remoteJid;
        // On ignore les statuts WhatsApp (stories) et les groupes : le MVP
        // ne gère que les conversations 1:1 (Phase 0). Les groupes pourront
        // être supportés explicitement plus tard.
        if (
          !remoteJid ||
          remoteJid === "status@broadcast" ||
          remoteJid.endsWith("@g.us")
        ) {
          continue;
        }

        // Les messages éphémères/vue unique enveloppent le vrai contenu ;
        // on le déroule avant d'essayer d'en extraire le texte.
        const unwrapped =
          msg.message.ephemeralMessage?.message ??
          msg.message.viewOnceMessage?.message ??
          msg.message.viewOnceMessageV2?.message ??
          msg.message;

        const text =
          unwrapped.conversation ??
          unwrapped.extendedTextMessage?.text ??
          null;

        // Phase 3 : texte uniquement. Les autres types (image, audio, ...)
        // sont ignorés ici et seront traités explicitement en Phase 4+.
        if (!text || !msg.key.id) continue;

        const incoming: IncomingWhatsAppMessage = {
          externalId: msg.key.id,
          fromJid: remoteJid,
          text,
          timestamp: new Date(Number(msg.messageTimestamp) * 1000),
        };

        for (const handler of this.messageHandlers) {
          handler(incoming);
        }
      }
    });
  }

  async disconnect(): Promise<void> {
    await this.socket?.logout();
    this.socket = null;
    this.setStatus("DISCONNECTED");
  }

  getStatus(): WhatsAppConnectionStatus {
    return this.status;
  }

  getQRCode(): string | null {
    return this.qrDataUrl;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) {
      throw new Error("Le socket WhatsApp n'est pas connecté.");
    }
    await this.socket.sendMessage(jid, { text });
  }

  onMessage(handler: (message: IncomingWhatsAppMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onConnectionUpdate(handler: (update: ConnectionUpdatePayload) => void): void {
    this.connectionHandlers.push(handler);
  }

  private setStatus(status: WhatsAppConnectionStatus, phoneNumber?: string): void {
    this.status = status;
    for (const handler of this.connectionHandlers) {
      if (phoneNumber !== undefined) {
        handler({ status, phoneNumber });
        continue;
      }

      handler({ status });
    }
  }
}
