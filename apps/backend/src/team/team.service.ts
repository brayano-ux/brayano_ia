import { prisma } from "../database/client.js";
import { hashPassword } from "../routes/auth.route.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";

/** Propriétaire + employés. */
export const MAX_TEAM_MEMBERS = 10;

const memberSelect = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;

export async function listTeam(organizationId: string) {
  return prisma.user.findMany({ where: { organizationId }, select: memberSelect, orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
}

export async function addAgent(organizationId: string, input: { name: string; email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const count = await prisma.user.count({ where: { organizationId } });
  if (count >= MAX_TEAM_MEMBERS) throw new ValidationError(`Votre équipe est limitée à ${MAX_TEAM_MEMBERS} personnes.`);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new ValidationError("Cette adresse email est déjà utilisée par un autre compte.");
  return prisma.user.create({
    data: { organizationId, email, name: input.name.trim(), passwordHash: hashPassword(input.password), role: "AGENT" },
    select: memberSelect,
  });
}

async function findAgent(organizationId: string, userId: string, actingUserId: string | undefined) {
  const member = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, role: true } });
  if (!member) throw new NotFoundError("Membre introuvable.");
  if (member.id === actingUserId) throw new ValidationError("Vous ne pouvez pas modifier votre propre compte ici.");
  if (member.role !== "AGENT") throw new ValidationError("Seuls les comptes employés peuvent être modifiés ici.");
  return member;
}

export async function setAgentActive(organizationId: string, userId: string, active: boolean, actingUserId: string | undefined) {
  await findAgent(organizationId, userId, actingUserId);
  const member = await prisma.user.update({ where: { id: userId }, data: { active }, select: memberSelect });
  if (!active) await prisma.session.deleteMany({ where: { userId } });
  return member;
}

export async function resetAgentPassword(organizationId: string, userId: string, password: string, actingUserId: string | undefined) {
  await findAgent(organizationId, userId, actingUserId);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(password) } });
  await prisma.session.deleteMany({ where: { userId } });
}

export async function removeAgent(organizationId: string, userId: string, actingUserId: string | undefined) {
  await findAgent(organizationId, userId, actingUserId);
  await prisma.user.delete({ where: { id: userId } });
}
