import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  WHATSAPP_AUTH_DIR: z.string().default("./wa-session"),
  LLM_PROVIDER: z.enum(["gemini", "mistral", "openrouter"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL: z.string().default("mistral-small-latest"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),
  AI_AGENT_NAME: z.string().default("l'assistant Brayano AI"),
  AI_SYSTEM_PROMPT: z
    .string()
    .default(
      "Ton rôle est d'accueillir les visiteurs, répondre à leurs questions générales, et collecter leur nom et leur besoin.",
    ),
}).superRefine((env, ctx) => {
  if (env.LLM_PROVIDER === "gemini" && !env.GEMINI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GEMINI_API_KEY"],
      message: "GEMINI_API_KEY est requis lorsque LLM_PROVIDER=gemini",
    });
  }

  if (env.LLM_PROVIDER === "mistral" && !env.MISTRAL_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MISTRAL_API_KEY"],
      message: "MISTRAL_API_KEY est requis lorsque LLM_PROVIDER=mistral",
    });
  }

  if (env.LLM_PROVIDER === "openrouter" && !env.OPENROUTER_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENROUTER_API_KEY"],
      message: "OPENROUTER_API_KEY est requis lorsque LLM_PROVIDER=openrouter",
    });
  }
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
