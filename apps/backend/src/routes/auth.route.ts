import { TRIAL } from "../billing/billing-plans.js";
import { normalizeWhatsAppNumber } from "../shared/phone.js";
import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { prisma } from "../database/client.js";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors.js";
import { burnPasswordCheck, hashPassword, needsRehash, safeEqualText, verifyPassword } from "../auth/password.js";
import { clearRateLimit, evaluateRateLimit, isRateLimited, recordFailure } from "../auth/rate-limit.js";

export { evaluateRateLimit, hashPassword, verifyPassword };

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

/** Adresse du client telle que la voit le serveur (trustProxy : voir app.ts). Jamais lue directement dans un en-tête. */
function getClientKey(request: { ip?: string | undefined }) {
  return request.ip ?? "unknown-client";
}

const HOUR = 3_600_000;
const FIFTEEN_MINUTES = 15 * 60_000;

export function getConfiguredAdminCredentials() {
  const email = process.env.DEFAULT_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD?.trim();

  if (!email || !password) return null;
  return { email, password };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
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

async function withAuthDatabase<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Le service de connexion est temporairement indisponible. Réessayez dans un instant.", 503, "AUTH_UNAVAILABLE");
  }
}

async function ensureDefaultAdminOrganization(email: string) {
  const configuredAdmin = getConfiguredAdminCredentials();
  if (!configuredAdmin || email !== configuredAdmin.email) return null;

  return withAuthDatabase(async () => {
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
          passwordHash: await hashPassword(configuredAdmin.password),
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
  return withAuthDatabase(async () => {
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

  return withAuthDatabase(async () => {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (!user) {
      throw new AppError("Impossible de créer la session. Reconnectez-vous.", 503, "AUTH_UNAVAILABLE");
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
    // Limite large par adresse (plusieurs clients peuvent partager la même) ; le vrai verrou est par compte, plus bas.
    if (!evaluateRateLimit(`${getClientKey(request)}:login`, 30, 60_000)) {
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
    const failureKey = `login-failures:${email}`;
    if (isRateLimited(failureKey, 10)) {
      reply.code(429);
      return { message: "Trop de tentatives sur ce compte. Réessayez dans quelques minutes." };
    }

    try {
      const organizationId = await ensureDefaultAdminOrganization(email);
      const configuredAdmin = getConfiguredAdminCredentials();
      const dbUser = await prisma.user.findUnique({ where: { email }, select: { id: true, organizationId: true, passwordHash: true, active: true } });

      let isValidPassword = false;
      if (dbUser) isValidPassword = await verifyPassword(password, dbUser.passwordHash);
      else await burnPasswordCheck(password);
      // Le mot de passe de l'administrateur défini dans l'environnement reste accepté (comparaison à temps constant).
      if (!isValidPassword && configuredAdmin?.email === email && safeEqualText(password, configuredAdmin.password)) isValidPassword = true;

      if (!isValidPassword) {
        recordFailure(failureKey, FIFTEEN_MINUTES);
        reply.code(401);
        return { message: "Email ou mot de passe incorrect." };
      }
      if (dbUser && !dbUser.active) {
        reply.code(403);
        return { message: "Ce compte a été désactivé. Contactez le propriétaire de l'entreprise." };
      }

      // Ancienne empreinte (SHA-256) : on la remplace par une empreinte salée maintenant qu'on connaît le mot de passe.
      if (dbUser && needsRehash(dbUser.passwordHash) && (await verifyPassword(password, dbUser.passwordHash))) {
        await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash: await hashPassword(password) } }).catch((error) => app.log.error(error, "Mise à niveau du mot de passe impossible"));
      }

      let issuedOrganizationId = organizationId ?? dbUser?.organizationId;
      if (!issuedOrganizationId && configuredAdmin?.email === email) {
        issuedOrganizationId = FALLBACK_ORGANIZATION_ID;
      }

      if (!issuedOrganizationId) {
        reply.code(500);
        return { message: "Impossible de se connecter pour le moment." };
      }

      clearRateLimit(failureKey);
      const token = await issueToken(email, issuedOrganizationId);
      return { token, organizationId: issuedOrganizationId, user: { email } };
    } catch (error) {
      app.log.error(error, "Login failed");
      reply.code(error instanceof AppError ? error.statusCode : 500);
      return { message: error instanceof AppError ? error.message : "Impossible de se connecter pour le moment." };
    }
  });

  app.post("/logout", async (request) => {
    const token = getBearerToken(request.headers.authorization);
    if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    return { message: "Vous êtes déconnecté." };
  });

  app.post("/register", async (request, reply) => {
    const clientKey = getClientKey(request);
    if (!evaluateRateLimit(`${clientKey}:register`, 10, 60_000)) {
      reply.code(429);
      return { message: "Trop de tentatives. Réessayez dans une minute." };
    }

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Informations invalides." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    if (!evaluateRateLimit(`register-email:${email}`, 5, HOUR)) {
      reply.code(429);
      return { message: "Trop de demandes pour cette adresse. Réessayez plus tard." };
    }
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
      const passwordHash = await hashPassword(parsed.data.password);
      await sendVerificationCode(email, code);
      await prisma.signupVerification.upsert({
        where: { email },
        update: {
          name,
          companyName,
          whatsappNumber,
          passwordHash,
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
          passwordHash,
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
    const clientKey = getClientKey(request);
    if (!evaluateRateLimit(`${clientKey}:verify`, 20, 60_000)) {
      reply.code(429);
      return { message: "Trop de tentatives. Réessayez dans une minute." };
    }

    const parsed = verifyRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Code invalide." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    // Quel que soit le nombre de codes demandés, une adresse n'a que 10 essais par heure.
    if (!evaluateRateLimit(`verify-email:${email}`, 10, HOUR)) {
      reply.code(429);
      return { message: "Nombre maximal de tentatives atteint. Réessayez plus tard." };
    }
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

      const token = await issueToken(email, organization.organization.id);
      return { token, organizationId: organization.organization.id, organizationName: organization.organization.name, user: { email } };
    } catch (error) {
      app.log.error(error, "Register verification failed");
      reply.code(500);
      return { message: "Impossible de créer le compte pour le moment." };
    }
  });

  app.post("/register/resend", async (request, reply) => {
    const clientKey = getClientKey(request);
    if (!evaluateRateLimit(`${clientKey}:resend`, 10, 60_000)) {
      reply.code(429);
      return { message: "Trop de demandes. Réessayez dans une minute." };
    }

    const parsed = resendRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: "Adresse email invalide." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    if (!evaluateRateLimit(`resend-email:${email}`, 5, HOUR)) {
      reply.code(429);
      return { message: "Trop de demandes pour cette adresse. Réessayez plus tard." };
    }
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
    const clientKey = getClientKey(request);
    if (!evaluateRateLimit(`${clientKey}:password-reset-request`, 10, 60_000)) {
      reply.code(429);
      return { message: "Trop de demandes. Réessayez dans une minute." };
    }

    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Adresse email invalide." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    if (!evaluateRateLimit(`reset-request-email:${email}`, 5, HOUR)) {
      // Réponse neutre : on ne révèle pas si le compte existe, et on n'envoie pas d'email de plus.
      return { message: "Si un compte existe avec cette adresse, un code de vérification a été envoyé." };
    }
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
    const clientKey = getClientKey(request);
    if (!evaluateRateLimit(`${clientKey}:password-reset-verify`, 20, 60_000)) {
      reply.code(429);
      return { message: "Trop de tentatives. Réessayez dans une minute." };
    }

    const parsed = passwordResetVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Code invalide." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    // Quel que soit le nombre de codes demandés, une adresse n'a que 10 essais par heure.
    if (!evaluateRateLimit(`reset-verify-email:${email}`, 10, HOUR)) {
      reply.code(429);
      return { message: "Nombre maximal de tentatives atteint. Réessayez plus tard." };
    }
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

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({ where: { email }, data: { passwordHash } });
    // Un nouveau mot de passe coupe toutes les sessions ouvertes (un jeton volé ne survit pas au changement).
    await prisma.session.deleteMany({ where: { userId: user.id } });
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
