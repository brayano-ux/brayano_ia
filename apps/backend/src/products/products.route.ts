import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { ValidationError } from "../shared/errors.js";
import {
  createProduct,
  deleteProduct,
  listProducts,
  readProductImage,
  saveProductImage,
  updateProduct,
  verifyProductImageToken,
} from "./products.service.js";

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Le nom du produit est requis.").max(160),
  description: z.string().trim().min(1, "La description du produit est requise.").max(3000),
  category: z.string().trim().max(120).optional().or(z.literal("")),
  price: z.string().trim().max(80).optional().or(z.literal("")),
});

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().min(1).max(3000).optional(),
  category: z.string().trim().max(120).optional(),
  price: z.string().trim().max(80).optional(),
  active: z.boolean().optional(),
}).refine((input) => Object.keys(input).length > 0, "Aucune modification fournie.");

export async function productsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/products", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { products: await listProducts(orgId) };
  });

  app.post("/organizations/:orgId/products", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { product: await createProduct(orgId, parsed.data) };
  });

  app.put("/organizations/:orgId/products/:productId", async (request) => {
    const { orgId, productId } = request.params as { orgId: string; productId: string };
    const parsed = updateProductSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { product: await updateProduct(orgId, productId, parsed.data) };
  });

  app.delete("/organizations/:orgId/products/:productId", async (request) => {
    const { orgId, productId } = request.params as { orgId: string; productId: string };
    await deleteProduct(orgId, productId);
    return { success: true };
  });

  app.post("/organizations/:orgId/products/:productId/image", async (request) => {
    const { orgId, productId } = request.params as { orgId: string; productId: string };
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!Buffer.isBuffer(request.body)) throw new ValidationError("Le fichier image est invalide.");
    // Toujours l'adresse configurée (APP_URL) : jamais l'en-tête Host, que le client peut falsifier.
    return { product: await saveProductImage(orgId, productId, contentType, request.body, env.APP_URL) };
  });

  app.get("/media/products/:orgId/:filename", async (request, reply) => {
    const { orgId, filename } = request.params as { orgId: string; filename: string };
    const query = request.query as { t?: string } | undefined;
    const token = typeof query?.t === "string" ? query.t : undefined;

    if (!/^[0-9a-f-]{36}$/i.test(orgId) || !verifyProductImageToken(orgId, filename, token)) {
      reply.code(403);
      return { message: "Accès interdit à cette image." };
    }

    const image = await readProductImage(orgId, filename);
    if (!image?.mimeType) {
      reply.code(404);
      return { message: "Image introuvable." };
    }

    return reply.type(image.mimeType).header("Cache-Control", "private, max-age=3600").send(image.contents);
  });
}
