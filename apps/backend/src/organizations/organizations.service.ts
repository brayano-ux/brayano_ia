import { prisma } from "../database/client.js";

export async function createOrganization(name: string) {
  return prisma.organization.create({ data: { name } });
}

export async function getOrganization(organizationId: string) {
  return prisma.organization.findUnique({ where: { id: organizationId } });
}

export async function listOrganizations() {
  return prisma.organization.findMany({ orderBy: { createdAt: "desc" } });
}
