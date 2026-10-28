import { loadImageForSending } from "./public-image.js";
import { Boom } from "@hapi/boom";
import fs from "node:fs";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageID,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { describeCloseCode } from "./disconnect-reasons.js";
import { BotSentIds, extractHumanOutgoing } from "./outgoing-detection.js";
import { startedFromAdClick } from "./ad-referral.js";
import { extractQuotedMessageId } from "./quoted-reply.js";
import type {
  ConnectionLossReason,
  ConnectionUpdatePayload,
  HumanOutgoingMessage,
  IncomingWhatsAppMessage,
  WhatsAppConnectionStatus,
  WhatsAppProvider,
} from "./whatsapp.types.js";

/** Au-delà, un fichier reçu n'est pas enregistré (photos WhatsApp : moins de 1 Mo ; documents : quelques Mo). */
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/**
 * Télécharge un fichier reçu en s'arrêtant dès que la limite est dépassée : la taille annoncée par l'expéditeur
 * n'est qu'une indication, elle ne doit jamais décider de ce que le serveur charge en mémoire.
 */
async function downloadCapped(download: () => Promise<unknown>, maxBytes: number): Promise<Buffer> {
  const result = await download();
  if (Buffer.isBuffer(result)) {
    if (result.length > maxBytes) throw new Error("Fichier trop volumineux.");
    return result;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of result as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      (result as { destroy?: () => void }).destroy?.();
      throw new Error("Fichier trop volumineux.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const logger = pino({ level: "silent" }); // Baileys est très verbeux ; on garde nos propres logs applicatifs

export class BaileysWhatsAppProvider implements WhatsAppProvider {
  private socket: WASocket | null = null;
  private status: WhatsAppConnectionStatus = "DISCONNECTED";
  private qrDataUrl: string | null = null;
  private pairingCode: string | null = null;
  private pairingCodeRequested = false;
  private pairingSocketReady = false;
  private pairingReadyResolve: (() => void) | null = null;
  private pairingReadyReject: ((error: Error) => void) | null = null;

  private messageHandlers: Array<(message: IncomingWhatsAppMessage) => void> = [];
  private humanMessageHandlers: Array<(message: HumanOutgoingMessage) => void> = [];
  /** Identifiants des messages envoyés par l'application : tout autre message sortant vient d'un humain. */
  private readonly botSentIds = new BotSentIds();
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
        this.pairingSocketReady = true;
        this.resolvePairingSocketReady();
        if (!this.pairingCodeRequested) {
          this.qrDataUrl = await QRCode.toDataURL(qr);
          this.setStatus("QR_PENDING");
        }
      }

      if (connection === "open") {
        this.rejectPairingSocketReady(new Error("Ce numéro WhatsApp est déjà connecté."));
        this.qrDataUrl = null;
        this.pairingCode = null;
        this.pairingCodeRequested = false;
        const phoneNumber = this.socket?.user?.id?.split(":")[0];
        this.setStatus("CONNECTED", phoneNumber);
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        this.pairingSocketReady = false;
        this.rejectPairingSocketReady(new Error("WhatsApp a fermé la connexion avant de préparer le code."));
        this.qrDataUrl = null;
        this.pairingCode = null;
        this.pairingCodeRequested = false;
        this.setStatus("DISCONNECTED", undefined, shouldReconnect ? "connection_lost" : "logged_out", describeCloseCode(statusCode));

        if (shouldReconnect) {
          await this.connect();
        } else {
          // WhatsApp a invalidé les identifiants persistés (déconnexion depuis
          // le téléphone). Un prochain clic sur la connexion par QR code doit générer un
          // nouveau QR au lieu de recharger cette session invalide.
          fs.rmSync(this.authDir, { recursive: true, force: true });
          fs.mkdirSync(this.authDir, { recursive: true });
        }
      }
    });

    this.socket.ev.on("messages.upsert", async ({ messages }) => {
      for (const msg of messages) {
        if (msg.key.fromMe) {
          const human = extractHumanOutgoing(msg, this.botSentIds);
          if (human) {
            for (const handler of this.humanMessageHandlers) handler(human);
          }
          continue;
        }
        if (!msg.message) continue;

        const remoteJid = msg.key.remoteJidAlt ?? msg.key.remoteJid;
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

        let text =
          unwrapped.conversation ??
          unwrapped.extendedTextMessage?.text ??
          null;

        const audioMessage = unwrapped.audioMessage;
        let audio: IncomingWhatsAppMessage["audio"];
        if (!text && audioMessage) {
          try {
            const declared = Number(audioMessage.fileLength ?? 0);
            if (!declared || declared > MAX_AUDIO_BYTES) throw new Error("Audio trop volumineux ou sans taille annoncée.");
            const media = await downloadCapped(
              () => downloadMediaMessage(msg, "stream", {}, { logger, reuploadRequest: this.socket!.updateMediaMessage }),
              MAX_AUDIO_BYTES,
            );
            audio = {
              data: media,
              mimeType: audioMessage.mimetype || "audio/ogg",
            };
            text = "[Audio à transcrire]";
          } catch (error) {
            console.error("❌ Impossible de télécharger l'audio WhatsApp :", error);
            continue;
          }
        }

        let media: IncomingWhatsAppMessage["media"];
        const imageMessage = unwrapped.imageMessage;
        const documentMessage = unwrapped.documentMessage ?? unwrapped.documentWithCaptionMessage?.message?.documentMessage;
        if (!text && (imageMessage || documentMessage)) {
          const isImage = Boolean(imageMessage);
          const info = (imageMessage ?? documentMessage)!;
          const caption = info.caption?.trim() || undefined;
          const fileName = documentMessage?.fileName?.trim() || undefined;
          const mimeType = info.mimetype || (isImage ? "image/jpeg" : "application/octet-stream");
          media = { kind: isImage ? "image" : "document", mimeType, ...(fileName ? { fileName } : {}), ...(caption ? { caption } : {}) };
          const declaredBytes = Number(info.fileLength ?? 0);
          if (declaredBytes > 0 && declaredBytes <= MAX_MEDIA_BYTES) {
            try {
              media.data = await downloadCapped(
                () => downloadMediaMessage(msg, "stream", {}, { logger, reuploadRequest: this.socket!.updateMediaMessage }),
                MAX_MEDIA_BYTES,
              );
            } catch (error) {
              console.error("❌ Impossible de télécharger le fichier reçu sur WhatsApp :", error);
            }
          }
          text = caption ?? (isImage ? "[Photo reçue]" : `[Document reçu${fileName ? ` : ${fileName}` : ""}]`);
        }

        // Les autres types (vidéo, position, contact...) restent ignorés.
        if (!text || !msg.key.id) continue;

        const startedFromAd = startedFromAdClick(unwrapped);
        const quotedMessageId = extractQuotedMessageId(unwrapped);

        const incoming: IncomingWhatsAppMessage = {
          externalId: msg.key.id,
          fromJid: remoteJid,
          text,
          timestamp: new Date(Number(msg.messageTimestamp) * 1000),
          ...(audio ? { audio } : {}),
          ...(media ? { media } : {}),
          ...(startedFromAd ? { startedFromAd: true } : {}),
          ...(quotedMessageId ? { quotedMessageId } : {}),
        };

        for (const handler of this.messageHandlers) {
          handler(incoming);
        }
      }
    });
  }

  async connectWithPairingCode(phoneNumber: string): Promise<string> {
    if (this.status === "CONNECTED") {
      throw new Error("Ce numéro WhatsApp est déjà connecté.");
    }

    this.pairingCodeRequested = true;
    if (!this.socket) {
      await this.connect();
    }

    if (!this.socket) {
      this.pairingCodeRequested = false;
      throw new Error("La connexion WhatsApp n'a pas pu être initialisée.");
    }

    try {
      if (!this.pairingSocketReady) {
        await this.waitForPairingSocketReady();
      }

      const code = await this.socket.requestPairingCode(phoneNumber);
      this.qrDataUrl = null;
      this.pairingCode = code;
      this.setStatus("QR_PENDING");
      return code;
    } catch (error) {
      this.pairingCodeRequested = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.socket?.logout();
    this.socket = null;
    this.setStatus("DISCONNECTED", undefined, "manual");
  }

  getStatus(): WhatsAppConnectionStatus {
    return this.status;
  }

  getQRCode(): string | null {
    return this.qrDataUrl;
  }

  getPairingCode(): string | null {
    return this.pairingCode;
  }

  private waitForPairingSocketReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.rejectPairingSocketReady(new Error("WhatsApp n'a pas préparé le code à temps. Réessayez."));
      }, 20000);

      this.pairingReadyResolve = () => {
        clearTimeout(timeout);
        this.pairingReadyResolve = null;
        this.pairingReadyReject = null;
        resolve();
      };
      this.pairingReadyReject = (error) => {
        clearTimeout(timeout);
        this.pairingReadyResolve = null;
        this.pairingReadyReject = null;
        reject(error);
      };
    });
  }

  private resolvePairingSocketReady(): void {
    this.pairingReadyResolve?.();
  }

  private rejectPairingSocketReady(error: Error): void {
    this.pairingReadyReject?.(error);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) {
      throw new Error("Le socket WhatsApp n'est pas connecté.");
    }
    const messageId = generateMessageID();
    this.botSentIds.add(messageId);
    await this.socket.sendMessage(jid, { text }, { messageId });
  }

  async sendImage(jid: string, imageUrl: string, caption?: string): Promise<string> {
    if (!this.socket) {
      throw new Error("Le socket WhatsApp n'est pas connecté.");
    }

    // Baileys ne reçoit jamais l'adresse : on télécharge l'image nous-mêmes, de façon sécurisée, puis on lui passe les octets.
    const image = await loadImageForSending(imageUrl);
    const payload: Record<string, unknown> = {
      image: image.data,
      mimetype: image.mimeType,
    };

    const normalizedCaption = caption?.trim();
    if (normalizedCaption) {
      payload.caption = normalizedCaption;
    }

    const messageId = generateMessageID();
    this.botSentIds.add(messageId);
    await this.socket.sendMessage(jid, payload as any, { messageId });
    return messageId;
  }

  async sendLocation(jid: string, latitude: number, longitude: number, label?: string): Promise<void> {
    if (!this.socket) {
      throw new Error("Le socket WhatsApp n'est pas connecté.");
    }

    const payload: Record<string, unknown> = {
      location: { degreesLatitude: latitude, degreesLongitude: longitude },
    };
    const normalizedLabel = label?.trim();
    if (normalizedLabel) {
      (payload.location as Record<string, unknown>).name = normalizedLabel;
    }

    const messageId = generateMessageID();
    this.botSentIds.add(messageId);
    await this.socket.sendMessage(jid, payload as any, { messageId });
  }

  onMessage(handler: (message: IncomingWhatsAppMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onHumanMessage(handler: (message: HumanOutgoingMessage) => void): void {
    this.humanMessageHandlers.push(handler);
  }

  onConnectionUpdate(handler: (update: ConnectionUpdatePayload) => void): void {
    this.connectionHandlers.push(handler);
  }

  private setStatus(status: WhatsAppConnectionStatus, phoneNumber?: string, reason?: ConnectionLossReason, detail?: string): void {
    this.status = status;
    const update: ConnectionUpdatePayload = { status };
    if (phoneNumber !== undefined) update.phoneNumber = phoneNumber;
    if (reason !== undefined) update.reason = reason;
    if (detail !== undefined) update.detail = detail;
    for (const handler of this.connectionHandlers) {
      handler(update);
    }
  }
}
