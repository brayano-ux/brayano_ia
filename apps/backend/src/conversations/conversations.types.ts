export interface RecordInboundMessageInput {
  organizationId: string;
  fromJid: string;
  externalId: string;
  text: string;
  timestamp: Date;
}

export interface RecordOutboundMessageInput {
  conversationId: string;
  text: string;
  author: "HUMAN" | "AI";
}
