import { resumeBroadcasts } from "../broadcasts/broadcasts.service.js";
import { whatsappBroadcastDeps } from "../broadcasts/broadcasts.route.js";
import { env } from "../config/env.js";
import { cleanupOldClientMedia } from "../media/client-media-cleanup.js";
import { runFollowUps } from "./follow-ups.js";

const TICK_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;

let timer: NodeJS.Timeout | null = null;
let tickRunning = false;
let lastCleanupAt = 0;

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    // Reprend les messages groupés restés « en cours » (WhatsApp reconnecté, redéploiement).
    await resumeBroadcasts(whatsappBroadcastDeps).catch((error) => console.error("❌ Reprise des messages groupés impossible :", error));

    const followUps = await runFollowUps(whatsappBroadcastDeps).catch((error) => {
      console.error("❌ Relances automatiques impossibles :", error);
      return null;
    });
    if (followUps?.sent) console.log(`🔔 ${followUps.sent} relance(s) envoyée(s).`);

    if (Date.now() - lastCleanupAt > DAY_MS) {
      lastCleanupAt = Date.now();
      const removed = await cleanupOldClientMedia().catch((error) => {
        console.error("❌ Nettoyage des fichiers reçus impossible :", error);
        return 0;
      });
      if (removed) console.log(`🧹 ${removed} ancien(s) fichier(s) de clients supprimé(s).`);
    }
  } finally {
    tickRunning = false;
  }
}

/** Tâches de fond : relances, reprise des messages groupés, nettoyage. Désactivables avec BACKGROUND_JOBS=false. */
export function startBackgroundJobs() {
  if (!env.BACKGROUND_JOBS || timer) return;
  // Premier passage 1 minute après le démarrage : le temps que les sessions WhatsApp se reconnectent.
  setTimeout(() => void tick(), 60_000).unref();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  console.log("⏱️  Tâches de fond démarrées (relances, messages groupés, nettoyage).");
}

export function stopBackgroundJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
