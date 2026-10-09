import { env } from "../config/env.js";

/** Emails du propriétaire de la plateforme : PLATFORM_ADMIN_EMAILS, sinon le compte DEFAULT_ADMIN_EMAIL du déploiement. */
export function getPlatformAdminEmails() {
  const configured = (env.PLATFORM_ADMIN_EMAILS ?? "").split(",");
  const emails = configured.some((value) => value.trim()) ? configured : [env.DEFAULT_ADMIN_EMAIL ?? ""];
  return emails.map((value) => value.trim().toLowerCase()).filter(Boolean);
}
