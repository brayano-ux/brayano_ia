import { prisma } from "../database/client.js";

export async function createOrganization(name: string) {
  return prisma.organization.create({ data: { name } });
}

export async function getOrganization(organizationId: string) {
  return prisma.organization.findUnique({ where: { id: organizationId } });
}

export async function listOrganizations(organizationId?: string) {
  const query = { orderBy: { createdAt: "desc" as const } };
  if (!organizationId) return prisma.organization.findMany(query);
  return prisma.organization.findMany({ where: { id: organizationId }, ...query });
}
