import { env } from "./config/env.js";
import { backfillConversationTracking } from "./conversations/backfill.js";
import { buildServer } from "./app.js";
import { startBackgroundJobs } from "./jobs/runner.js";
import { warnIfProductImagesAreEphemeral } from "./shared/storage-check.js";

async function start() {
  warnIfProductImagesAreEphemeral(env.WHATSAPP_AUTH_DIR, env.PRODUCT_IMAGE_DIR);
  const app = await buildServer();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`🚀 Brayano AI backend démarré sur ${env.APP_URL}`);
    startBackgroundJobs();
    backfillConversationTracking()
      .then((result) => result.lastInbound + result.ordered + result.interested > 0 && app.log.info(result, "Suivi des conversations rattrapé"))
      .catch((error) => app.log.error(error, "Rattrapage du suivi des conversations ignoré"));
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
