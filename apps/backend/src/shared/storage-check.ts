import fs from "node:fs";

type StatFn = (path: string) => { dev: number };

/**
 * Les sessions WhatsApp vivent sur le disque persistant. Si les photos de produits sont sur un autre
 * système de fichiers, elles sont perdues à chaque redéploiement : on le dit clairement dans les journaux.
 * Renvoie null quand la comparaison est impossible (dossier absent).
 */
export function checkProductImagesOnSameDisk(
  authDir: string,
  productDir: string,
  stat: StatFn = (target) => fs.statSync(target),
): boolean | null {
  try {
    fs.mkdirSync(productDir, { recursive: true });
    return stat(authDir).dev === stat(productDir).dev;
  } catch {
    return null;
  }
}

export function warnIfProductImagesAreEphemeral(authDir: string, productDir: string) {
  if (checkProductImagesOnSameDisk(authDir, productDir) === false) {
    console.warn(
      `⚠️  Les photos de produits (${productDir}) ne sont pas sur le même disque que les sessions WhatsApp (${authDir}) : ` +
        "elles seront perdues au prochain redéploiement. Définissez PRODUCT_IMAGE_DIR sous le disque persistant, ou retirez la variable.",
    );
  }
}
