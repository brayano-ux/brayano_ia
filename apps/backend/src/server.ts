import { env } from "./config/env.js";
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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
