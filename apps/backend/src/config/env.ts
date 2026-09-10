import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  WHATSAPP_AUTH_DIR: z.string().default("./wa-session"),
  LLM_PROVIDER: z.enum(["gemini"]).default("gemini"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY est requis"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  AI_AGENT_NAME: z.string().default("l'assistant Brayano AI"),
  AI_SYSTEM_PROMPT: z
    .string()
    .default(
      "Ton rôle est d'accueillir les visiteurs, répondre à leurs questions générales, et collecter leur nom et leur besoin.",
    ),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("❌ Variables d'environnement invalides :");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
