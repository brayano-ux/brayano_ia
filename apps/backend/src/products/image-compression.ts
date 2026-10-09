/**
 * Compression des photos de produits à l'envoi.
 *
 * Règle d'or : elle ne peut jamais faire pire qu'avant. Si la bibliothèque d'images ne se charge pas
 * ou échoue sur un fichier, la photo d'origine est enregistrée telle quelle. `sharp` est chargé à la demande,
 * jamais au démarrage : son absence ne peut donc pas empêcher le serveur (IA, WhatsApp) de démarrer.
 */

/** Plus grand côté conservé. Largement suffisant pour WhatsApp, qui réduit lui-même les photos. */
export const MAX_IMAGE_SIDE = 1280;
export const JPEG_QUALITY = 82;
/** Garde-fou contre les images « bombes » (petit fichier, énorme image décompressée). */
const MAX_INPUT_PIXELS = 40_000_000;

export type ImageExtension = "jpg" | "png" | "webp";

export interface PreparedImage {
  contents: Buffer;
  extension: ImageExtension;
  /** false quand la photo d'origine est conservée telle quelle. */
  compressed: boolean;
}

type SharpModule = typeof import("sharp");
export type SharpLoader = () => Promise<SharpModule["default"]>;

let cachedSharp: Promise<SharpModule["default"]> | null = null;

const loadSharp: SharpLoader = () => {
  cachedSharp ??= import("sharp").then((module) => {
    const sharp = module.default;
    sharp.cache(false); // pas de cache d'images en mémoire
    sharp.concurrency(1); // un seul thread : n'entre pas en concurrence avec WhatsApp
    return sharp;
  });
  // Si le chargement échoue, on réessaiera à la prochaine photo plutôt que de garder l'échec.
  cachedSharp.catch(() => { cachedSharp = null; });
  return cachedSharp;
};

/** Une seule compression à la fois : évite les pics de mémoire sur un petit serveur. */
let queue: Promise<unknown> = Promise.resolve();
function inSequence<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export function compressProductImage(
  contents: Buffer,
  extension: ImageExtension,
  loader: SharpLoader = loadSharp,
): Promise<PreparedImage> {
  const original: PreparedImage = { contents, extension, compressed: false };

  return inSequence(async () => {
    try {
      const sharp = await loader();
      const output = await sharp(contents, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
        .rotate() // applique l'orientation du téléphone puis retire les métadonnées (position GPS comprise)
        .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }) // un PNG transparent ne devient pas noir en JPEG
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();

      // Un JPEG déjà très léger n'est pas remplacé par un fichier plus gros.
      if (extension === "jpg" && output.length >= contents.length) return original;
      return { contents: output, extension: "jpg" as const, compressed: true };
    } catch (error) {
      console.warn("⚠️  Compression de la photo produit impossible, photo d'origine conservée :", error instanceof Error ? error.message : error);
      return original;
    }
  });
}
