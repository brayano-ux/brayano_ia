import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.CLIENT_MEDIA_DIR = `/tmp/brayano-test-cleanup-${process.pid}`; });

import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { cleanupOldClientMedia } from "./client-media-cleanup.js";
import { saveClientMedia } from "./client-media.service.js";

describe.skipIf(!integrationEnabled)("nettoyage des fichiers reçus (base réelle)", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => {
    await disconnectTestDatabase();
    rmSync(process.env.CLIENT_MEDIA_DIR!, { recursive: true, force: true });
  });

  it("supprime les fichiers trop anciens et garde les récents, sans supprimer les messages", async () => {
    const { organization } = await createTestOrganization();
    const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: "237655000001@s.whatsapp.net" } });
    const conversation = await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id } });
    const old = await saveClientMedia(organization.id, Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg");
    const recent = await saveClientMedia(organization.id, Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg");
    const now = new Date("2026-10-14T10:00:00Z");
    await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "IMAGE", content: "[Photo reçue]", mediaFile: old.file, mediaMimeType: "image/jpeg", createdAt: new Date("2026-06-01T10:00:00Z") } });
    await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "IMAGE", content: "[Photo reçue]", mediaFile: recent.file, mediaMimeType: "image/jpeg", createdAt: new Date("2026-10-10T10:00:00Z") } });
    const dir = path.join(process.env.CLIENT_MEDIA_DIR!, organization.id);

    expect(await cleanupOldClientMedia(now)).toBe(1);

    expect(existsSync(path.join(dir, old.file))).toBe(false);
    expect(existsSync(path.join(dir, recent.file))).toBe(true);
    expect(await prisma.message.count()).toBe(2);
    expect(await prisma.message.count({ where: { mediaFile: null } })).toBe(1);
  });
});
