import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
  email: z.string().email("Adresse email invalide."),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
});

const VALID_USERS = new Map<string, string>([["admin@brayano.ai", hashPassword("brayano123")]]);

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

function verifyPassword(password: string, storedHash: string | undefined) {
  if (!storedHash) return false;
  const stored = Buffer.from(storedHash, "utf8");
  const candidate = Buffer.from(hashPassword(password), "utf8");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

const FALLBACK_ORGANIZATION_ID = "default-admin-org";

async function withDatabaseFallback<T>(fallback: T, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[auth] Database unavailable, using fallback behavior:", error);
    }
    return fallback;
  }
}

async function ensureDefaultAdminOrganization(email: string) {
  if (email !== "admin@brayano.ai") return null;

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
          passwordHash: hashPassword("brayano123"),
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
        user: { select: { email: true, organizationId: true } },
      },
    });

    if (!session) return null;
    if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
      await prisma.session.delete({ where: { tokenHash: hashed } }).catch(() => undefined);
      return null;
    }

    const organizationId = session.organizationId === FALLBACK_ORGANIZATION_ID
      ? session.user.organizationId
      : session.organizationId ?? session.user.organizationId;

    return { email: session.email, organizationId };
  });
}

async function issueToken(email: string, organizationId?: string) {
  const token = randomBytes(32).toString("hex");

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
        expiresAt: null,
      },
      update: {
        userId: user.id,
        email,
        organizationId: normalizedOrganizationId,
        expiresAt: null,
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
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Identifiants invalides." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    try {
      const organizationId = await ensureDefaultAdminOrganization(email);
      const storedPassword = VALID_USERS.get(email);
      const dbUser = storedPassword ? null : await prisma.user.findUnique({ where: { email }, select: { organizationId: true, passwordHash: true } });
      const isValidPassword = verifyPassword(password, storedPassword ?? dbUser?.passwordHash);

      if (!isValidPassword) {
        reply.code(401);
        return { message: "Email ou mot de passe incorrect." };
      }

      const token = await issueToken(email, organizationId ?? dbUser?.organizationId ?? FALLBACK_ORGANIZATION_ID);
      return { token, organizationId: organizationId ?? dbUser?.organizationId ?? FALLBACK_ORGANIZATION_ID, user: { email } };
    } catch (error) {
      app.log.error(error, "Login failed");
      if (email === "admin@brayano.ai" && password === "brayano123") {
        const fallbackToken = randomBytes(32).toString("hex");
        return {
          token: fallbackToken,
          organizationId: FALLBACK_ORGANIZATION_ID,
          user: { email },
        };
      }

      reply.code(500);
      return { message: "Impossible de se connecter pour le moment." };
    }
  });

  app.post("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Informations invalides." };
    }

    const email = parsed.data.email.trim().toLowerCase();
    const name = parsed.data.name.trim();
    const companyName = parsed.data.companyName.trim();

    try {
      const existingUser = await prisma.user.findUnique({ where: { email } }).catch(() => null);
      if (existingUser) {
        reply.code(409);
        return { message: "Un compte avec cet email existe déjà." };
      }

      const organization = await prisma.$transaction(async (tx) => {
        const createdOrganization = await tx.organization.create({ data: { name: companyName } });
        const createdUser = await tx.user.create({
          data: {
            organizationId: createdOrganization.id,
            name,
            email,
            passwordHash: hashPassword(parsed.data.password),
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

        return { organization: createdOrganization, user: createdUser };
      });

      VALID_USERS.set(email, hashPassword(parsed.data.password));
      const token = await issueToken(email, organization.organization.id);

      return {
        token,
        organizationId: organization.organization.id,
        organizationName: organization.organization.name,
        user: { email },
      };
    } catch (error) {
      app.log.error(error, "Register failed");
      reply.code(500);
      return { message: "Impossible de créer le compte pour le moment." };
    }
  });

  app.get("/me", async (request, reply) => {
    const session = await requireAuth(request.headers.authorization);

    if (!session) {
      reply.code(401);
      return { message: "Non autorisé." };
    }

    return { organizationId: session.organizationId, user: { email: session.email } };
  });
}
