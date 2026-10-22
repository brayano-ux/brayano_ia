import { TRIAL } from "../billing/billing-plans.js";
import { normalizeWhatsAppNumber } from "../shared/phone.js";
import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { prisma } from "../database/client.js";
import { env } from "../config/env.js";

const loginSchema = z.object({
  email: z.string().email("Adresse email invalide."),
  password: z.string().min(1, "Le mot de passe est requis."),
});

const registerSchema = z.object({
  name: z.string().min(2, "Le nom est requis."),
  companyName: z.string().min(2, "Le nom de l'entreprise est requis."),
  whatsappNumber: z
    .string({ required_error: "Le numéro WhatsApp de l'entreprise est requis." })
    .refine((value) => normalizeWhatsAppNumber(value) !== null, "Numéro WhatsApp invalide : indiquez-le avec l'indicatif du pays (ex. +237 6 90 00 00 00)."),
  email: z.string().email("Adresse email invalide."),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
});

const verifyRegistrationSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Le code doit contenir 6 chiffres."),
});

const passwordResetRequestSchema = z.object({
  email: z.string().email("Adresse email invalide."),
});

const passwordResetVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Le code doit contenir 6 chiffres."),
  newPassword: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
});

const resendRegistrationSchema = z.object({ email: z.string().email() });

const VALID_USERS = new Map<string, string>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function evaluateRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const previous = rateLimitMap.get(key);

  if (!previous || previous.resetAt <= now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (previous.count >= limit) {
    return false;
  }

  previous.count += 1;
  rateLimitMap.set(key, previous);
  return true;
}

function getClientKey(request: { headers: Record<string, string | string[] | undefined>; ip?: string | undefined }) {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value ?? request.ip ?? "unknown-client";
}

export function getConfiguredAdminCredentials() {
  const email = process.env.DEFAULT_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD?.trim();

  if (!email || !password) return null;
  return { email, password };
}

function registerConfiguredAdmin() {
  const admin = getConfiguredAdminCredentials();
  if (!admin) return;
  VALID_USERS.set(admin.email, hashPassword(admin.password));
}

registerConfiguredAdmin();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(password: string, storedHash: string | undefined) {
  if (!storedHash) return false;
  const stored = Buffer.from(storedHash, "utf8");
  const candidate = Buffer.from(hashPassword(password), "utf8");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

function createVerificationCode() {
  return String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, "0");
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST ?? env.SMTP_HOST;
  const user = process.env.SMTP_USER ?? env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD ?? env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM ?? env.SMTP_FROM;
  const port = Number(process.env.SMTP_PORT ?? env.SMTP_PORT);

  return { host, user, password, from, port };
}

function isSmtpConfigured() {
  const { host, user, password, from } = getSmtpConfig();
  return Boolean(host && user && password && from);
}

async function sendVerificationCode(email: string, code: string) {
  const smtp = getSmtpConfig();
  if (!isSmtpConfigured()) {
    throw new Error("La messagerie SMTP n'est pas configurée.");
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
  });

  await transporter.sendMail({
    from: smtp.from,
    to: email,
    subject: "Votre code de vérification Brayano AI",
    text: `Votre code de vérification est : ${code}. Il expire dans 10 minutes.`,
  });
}

const FALLBACK_ORGANIZATION_ID = "default-admin-org";

async function withDatabaseFallback<T>(fallback: T, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] Database unavailable, using fallback behavior:", error);
    }
    return fallback;
  }
}

async function ensureDefaultAdminOrganization(email: string) {
  const configuredAdmin = getConfiguredAdminCredentials();
  if (!configuredAdmin || email !== configuredAdmin.email) return null;

  return withDatabaseFallback(FALLBACK_ORGANIZATION_ID, async () => {
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { organizationId: true } });
    if (existingUser?.organizationId) {
      return existingUser.organizationId;
    }

    const organization = await prisma.$transaction(async (tx) => {
      const createdOrganization = await tx.organization.create({ data: { name: "Brayano" } });
      await tx.user.create({
        data: {
          organizationId: createdOrganization.id,
          name: "Administrateur",
          email,
          passwordHash: hashPassword(configuredAdmin.password),
          role: "ADMIN",
        },
      });

      await tx.aiSettings.create({
        data: {
          organizationId: createdOrganization.id,
          agentName: env.AI_AGENT_NAME,
          systemPrompt: env.AI_SYSTEM_PROMPT,
        },
      });

      return createdOrganization.id;
    });

    return organization;
  });
}

export function getBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  const token = match?.[1];
  return token ? token.trim() : null;
}

export async function getSessionFromToken(token: string | null) {
  if (!token) return null;

  const hashed = hashToken(token);
  return withDatabaseFallback(null, async () => {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashed },
      select: {
        email: true,
        organizationId: true,
        expiresAt: true,
        user: { select: { id: true, name: true, email: true, organizationId: true, role: true, active: true } },
      },
    });

    if (!session) return null;
    // Un membre désactivé par le propriétaire perd l'accès tout de suite, même avec une session encore valide.
    if (!session.user.active) return null;
    if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
      await prisma.session.delete({ where: { tokenHash: hashed } }).catch(() => undefined);
      return null;
    }

    const organizationId = session.organizationId === FALLBACK_ORGANIZATION_ID
      ? session.user.organizationId
      : session.organizationId ?? session.user.organizationId;

    return { email: session.email, organizationId, userId: session.user.id, name: session.user.name, role: session.user.role };
  });
}

async function issueToken(email: string, organizationId?: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);

  return withDatabaseFallback(token, async () => {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (!user) {
      return token;
    }

    const normalizedOrganizationId = organizationId ?? null;

    await prisma.session.upsert({
      where: { tokenHash: hashToken(token) },
      create: {
        userId: user.id,
        tokenHash: hashToken(token),
        email,
        organizationId: normalizedOrganizationId,
        expiresAt,
      },
      update: {
        userId: user.id,
        email,
        organizationId: normalizedOrganizationId,
        expiresAt,
        updatedAt: new Date(),
      },
    });

    return token;
  });
}

export async function requireAuth(headerValue: string | undefined) {
  return getSessionFromToken(getBearerToken(headerValue));
}

export async function authRoute(app: FastifyInstance) {
  app.post("/login", async (request, reply) => {
    const clientKey = getClientKey(request as { headers: Record<string, string | string[] | undefined>; ip?: string | undefined });
    if (!evaluateRateLimit(`${clientKey}:login`, 5, 60_000)) {
      reply.code(429);
      return { message: "Trop de tentatives. Réessayez dans une minute." };
    }

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Identifiants invalides." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    try {
      const organizationId = await ensureDefaultAdminOrganization(email);
      const configuredAdmin = getConfiguredAdminCredentials();
      const storedPassword = VALID_USERS.get(email);
      const dbUser = storedPassword ? null : await prisma.user.findUnique({ where: { email }, select: { organizationId: true, passwordHash: true, active: true } });
      const isValidPassword = verifyPassword(password, storedPassword ?? dbUser?.passwordHash);

      if (!isValidPassword) {
        reply.code(401);
        return { message: "Email ou mot de passe incorrect." };
      }
      if (dbUser && !dbUser.active) {
        reply.code(403);
        return { message: "Ce compte a été désactivé. Contactez le propriétaire de l'entreprise." };
      }

      let issuedOrganizationId = organizationId ?? dbUser?.organizationId;
      if (!issuedOrganizationId && configuredAdmin?.email === email) {
        issuedOrganizationId = FALLBACK_ORGANIZATION_ID;
      }

      if (!issuedOrganizationId) {
        reply.code(500);
        return { message: "Impossible de se connecter pour le moment." };
      }

      const token = await issueToken(email, issuedOrganizationId);
      return { token, organizationId: issuedOrganizationId, user: { email } };
    } catch (error) {
      app.log.error(error, "Login failed");
      reply.code(500);
      return { message: "Impossible de se connecter pour le moment." };
    }
  });

  app.post("/register", async (request, reply) => {
    const clientKey = getClientKey(request as { headers: Record<string, string | string[] | undefined>; ip?: string | undefined });
    if (!evaluateRateLimit(`${clientKey}:register`, 3, 60_000)) {
      reply.code(429);
      return { message: "Trop de tentatives. Réessayez dans une minute." };
    }

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Informations invalides." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    const name = parsed.data.name.trim();
    const companyName = parsed.data.companyName.trim();
    const whatsappNumber = normalizeWhatsAppNumber(parsed.data.whatsappNumber)!;

    try {
      const existingUser = await prisma.user.findUnique({ where: { email } }).catch(() => null);
      if (existingUser) {
        reply.code(409);
        return { message: "Un compte avec cet email existe déjà." };
      }

      const existingVerification = await prisma.signupVerification.findUnique({ where: { email } });
      if (existingVerification && Date.now() - existingVerification.lastSentAt.getTime() < 60_000) {
        reply.code(429);
        return { message: "Un code vient déjà d'être envoyé. Réessayez dans une minute." };
      }

      const code = createVerificationCode();
      await sendVerificationCode(email, code);
      await prisma.signupVerification.upsert({
        where: { email },
        update: {
          name,
          companyName,
          whatsappNumber,
          passwordHash: hashPassword(parsed.data.password),
          codeHash: hashToken(code),
          expiresAt: new Date(Date.now() + 10 * 60_000),
          lastSentAt: new Date(),
          attempts: 0,
          verifiedAt: null,
        },
        create: {
          email,
          name,
          companyName,
          whatsappNumber,
          passwordHash: hashPassword(parsed.data.password),
          codeHash: hashToken(code),
          expiresAt: new Date(Date.now() + 10 * 60_000),
          lastSentAt: new Date(),
        },
      });
      return { verificationRequired: true, email, message: "Un code de vérification a été envoyé par email." };
    } catch (error) {
      app.log.error(error, "Register failed");
      reply.code(500);
      return { message: "Impossible de créer le compte pour le moment." };
    }
  });

  app.post("/register/verify", async (request, reply) => {
    const clientKey = getClientKey(request as { headers: Record<string, string | string[] | undefined>; ip?: string | undefined });
    if (!evaluateRateLimit(`${clientKey}:verify`, 5, 60_000)) {
      reply.code(429);
      return { message: "Trop de tentatives. Réessayez dans une minute." };
    }

    const parsed = verifyRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Code invalide." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    const verification = await prisma.signupVerification.findUnique({ where: { email } });
    if (!verification || verification.expiresAt.getTime() <= Date.now()) {
      reply.code(400);
      return { message: "Code invalide ou expiré." };
    }
    if (verification.attempts >= 5) {
      reply.code(429);
      return { message: "Nombre maximal de tentatives atteint." };
    }

    const validCode = hashToken(parsed.data.code) === verification.codeHash;
    if (!validCode) {
      await prisma.signupVerification.update({ where: { email }, data: { attempts: { increment: 1 } } });
      reply.code(400);
      return { message: "Code incorrect." };
    }

    try {
      const organization = await prisma.$transaction(async (tx) => {
        const createdOrganization = await tx.organization.create({ data: { name: verification.companyName, whatsappNumber: verification.whatsappNumber, freeAiResponsesRemaining: TRIAL.messages } });
        const createdUser = await tx.user.create({
          data: {
            organizationId: createdOrganization.id,
            name: verification.name,
            email,
            passwordHash: verification.passwordHash,
            role: "ADMIN",
          },
        });
        await tx.aiSettings.create({
          data: { organizationId: createdOrganization.id, agentName: env.AI_AGENT_NAME, systemPrompt: env.AI_SYSTEM_PROMPT },
        });
        await tx.signupVerification.delete({ where: { email } });
        return { organization: createdOrganization, user: createdUser };
      });

      VALID_USERS.set(email, verification.passwordHash);
      const token = await issueToken(email, organization.organization.id);
      return { token, organizationId: organization.organization.id, organizationName: organization.organization.name, user: { email } };
    } catch (error) {
      app.log.error(error, "Register verification failed");
      reply.code(500);
      return { message: "Impossible de créer le compte pour le moment." };
    }
  });

  app.post("/register/resend", async (request, reply) => {
    const clientKey = getClientKey(request as { headers: Record<string, string | string[] | undefined>; ip?: string | undefined });
    if (!evaluateRateLimit(`${clientKey}:resend`, 3, 60_000)) {
      reply.code(429);
      return { message: "Trop de demandes. Réessayez dans une minute." };
    }

    const parsed = resendRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: "Adresse email invalide." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    const verification = await prisma.signupVerification.findUnique({ where: { email } });
    if (!verification || Date.now() - verification.lastSentAt.getTime() < 60_000) {
      reply.code(429);
      return { message: "Vous pourrez demander un nouveau code dans une minute." };
    }

    const code = createVerificationCode();
    await sendVerificationCode(email, code);
    await prisma.signupVerification.update({
      where: { email },
      data: { codeHash: hashToken(code), expiresAt: new Date(Date.now() + 10 * 60_000), lastSentAt: new Date(), attempts: 0 },
    });
    return { message: "Un nouveau code a été envoyé." };
  });

  app.post("/password-reset/request", async (request, reply) => {
    const clientKey = getClientKey(request as { headers: Record<string, string | string[] | undefined>; ip?: string | undefined });
    if (!evaluateRateLimit(`${clientKey}:password-reset-request`, 3, 60_000)) {
      reply.code(429);
      return { message: "Trop de demandes. Réessayez dans une minute." };
    }

    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Adresse email invalide." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    const user = await Promise.resolve(prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })).catch(() => null);
    if (!user) {
      return { message: "Si un compte existe avec cette adresse, un code de vérification a été envoyé." };
    }

    const existingReset = await Promise.resolve(prisma.passwordResetVerification?.findUnique?.({ where: { email } })).catch(() => null);
    if (existingReset && Date.now() - new Date(existingReset.lastSentAt).getTime() < 60_000) {
      reply.code(429);
      return { message: "Un code vient déjà d'être envoyé. Réessayez dans une minute." };
    }

    const code = createVerificationCode();
    await sendVerificationCode(email, code);
    await prisma.passwordResetVerification.upsert({
      where: { email },
      update: {
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        lastSentAt: new Date(),
        attempts: 0,
      },
      create: {
        email,
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        lastSentAt: new Date(),
      },
    });

    return { message: "Si un compte existe avec cette adresse, un code de vérification a été envoyé." };
  });

  app.post("/password-reset/verify", async (request, reply) => {
    const clientKey = getClientKey(request as { headers: Record<string, string | string[] | undefined>; ip?: string | undefined });
    if (!evaluateRateLimit(`${clientKey}:password-reset-verify`, 5, 60_000)) {
      reply.code(429);
      return { message: "Trop de tentatives. Réessayez dans une minute." };
    }

    const parsed = passwordResetVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Code invalide." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    const resetVerification = await Promise.resolve(prisma.passwordResetVerification.findUnique({ where: { email } })).catch(() => null);
    if (!resetVerification || new Date(resetVerification.expiresAt).getTime() <= Date.now()) {
      reply.code(400);
      return { message: "Code invalide ou expiré." };
    }

    if (resetVerification.attempts >= 5) {
      reply.code(429);
      return { message: "Nombre maximal de tentatives atteint." };
    }

    const validCode = hashToken(parsed.data.code) === resetVerification.codeHash;
    if (!validCode) {
      await Promise.resolve(prisma.passwordResetVerification.update({ where: { email }, data: { attempts: { increment: 1 } } })).catch(() => undefined);
      reply.code(400);
      return { message: "Code incorrect." };
    }

    const user = await Promise.resolve(prisma.user.findUnique({ where: { email }, select: { id: true } })).catch(() => null);
    if (!user) {
      reply.code(404);
      return { message: "Compte introuvable." };
    }

    const passwordHash = hashPassword(parsed.data.newPassword);
    await prisma.user.update({ where: { email }, data: { passwordHash } });
    VALID_USERS.set(email, passwordHash);
    await Promise.resolve(prisma.passwordResetVerification.delete({ where: { email } })).catch(() => undefined);

    return { message: "Votre mot de passe a été réinitialisé avec succès." };
  });

  app.get("/me", async (request, reply) => {
    const session = await requireAuth(request.headers.authorization);

    if (!session) {
      reply.code(401);
      return { message: "Non autorisé." };
    }

    return { organizationId: session.organizationId, user: { email: session.email, name: session.name ?? null, role: session.role ?? "ADMIN" } };
  });
}
