import { config } from "dotenv";
import { z } from "zod";
import { defaultProductImageDir } from "./data-paths.js";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  WHATSAPP_AUTH_DIR: z.string().default("./wa-session"),
  PRODUCT_IMAGE_DIR: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000,http://localhost:4173"),
  PAYMENT_PROVIDER: z.enum(["campay", "manual"]).default("campay"),
  CAMPAY_BASE_URL: z.string().url().default("https://demo.campay.net/api"),
  CAMPAY_USERNAME: z.string().optional().or(z.literal("")),
  CAMPAY_PASSWORD: z.string().optional().or(z.literal("")),
  CAMPAY_CURRENCY: z.string().default("XAF"),
  CAMPAY_DEMO_AMOUNT: z.coerce.number().positive().max(25).default(25),
  CAMPAY_CALLBACK_URL: z.string().url().optional().or(z.literal("")),
  WHATSAPP_CLIENT_ALERT_DELAY_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  CLIENT_DASHBOARD_URL: z.string().url().optional().or(z.literal("")),
  WHATSAPP_ALERT_DELAY_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  PLATFORM_ADMIN_EMAILS: z.string().optional().or(z.literal("")),
  PLATFORM_ADMIN_TOKEN: z.string().min(32, "PLATFORM_ADMIN_TOKEN doit faire au moins 32 caractères").optional().or(z.literal("")),
  SUPPORT_EMAIL: z.string().email().optional().or(z.literal("")),
  DEFAULT_ADMIN_EMAIL: z.string().trim().email().optional().or(z.literal("")),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).optional().or(z.literal("")),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  MEDIA_SIGNING_SECRET: z.string().min(16).optional().or(z.literal("")),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60),
  LLM_PROVIDER: z.enum(["gemini", "mistral", "openrouter"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL: z.string().default("mistral-small-latest"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),
  SMTP_HOST: z.string().optional().or(z.literal("")),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().or(z.literal("")),
  SMTP_PASSWORD: z.string().optional().or(z.literal("")),
  SMTP_FROM: z.string().email().optional().or(z.literal("")),
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

  if (env.NODE_ENV === "production" && (!env.MEDIA_SIGNING_SECRET || env.MEDIA_SIGNING_SECRET.length < 16)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MEDIA_SIGNING_SECRET"],
      message: "MEDIA_SIGNING_SECRET doit être défini en production et faire au moins 16 caractères.",
    });
  }
});

export type Env = Omit<z.infer<typeof envSchema>, "PRODUCT_IMAGE_DIR"> & { PRODUCT_IMAGE_DIR: string };

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("❌ Variables d'environnement invalides :");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return {
    ...parsed.data,
    PRODUCT_IMAGE_DIR: parsed.data.PRODUCT_IMAGE_DIR?.trim() || defaultProductImageDir(parsed.data.WHATSAPP_AUTH_DIR),
  };
}

export const env = loadEnv();
