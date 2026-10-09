import path from "node:path";

/**
 * Où ranger les photos de produits quand PRODUCT_IMAGE_DIR n'est pas défini : à côté des sessions WhatsApp,
 * donc sur le même disque persistant. Ainsi un chemin de disque différent de celui prévu (ex. /var/data au lieu
 * de /data sur Render) ne fait jamais perdre les photos à chaque redéploiement.
 * En local (chemin relatif), on garde le dossier historique.
 */
export function defaultProductImageDir(whatsappAuthDir: string): string {
  if (!path.isAbsolute(whatsappAuthDir)) return "./uploads/products";
  return path.join(path.dirname(path.resolve(whatsappAuthDir)), "product-images");
}
