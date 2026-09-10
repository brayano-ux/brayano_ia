import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
// Généré par `prisma generate` (Phase 2). Ce chemin dépend du generator
// "prisma-client" configuré dans prisma/schema.prisma (output: ../src/generated/prisma).
// Si l'import échoue avec "Cannot find module", lance d'abord `npm run db:generate`.
import { PrismaClient } from "../generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
