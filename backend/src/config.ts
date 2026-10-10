import { z } from "zod";

import { parseCampusDomains } from "./auth/campus-email.js";
import type { OtpDeliveryConfig } from "./auth/otp-delivery.js";

// Names and meanings follow docs/BACKEND_STACK.md §12.
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:8787"),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string (Tiger console → service → Connect)"),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters (try: openssl rand -base64 32)"),
  EMAIL_HASH_PEPPER: z.string().min(16, "must be at least 16 characters (try: openssl rand -base64 32)"),
  CAMPUS_EMAIL_DOMAINS: z.string().transform((value, context) => {
    try {
      return parseCampusDomains(value);
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "invalid" });
      return z.NEVER;
    }
  }),
  DEMO_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  RESEND_API_KEY: z.string().min(1).optional(),
  OTP_EMAIL_FROM: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1).optional(),
});

export type Config = z.infer<typeof envSchema> & { otpDelivery: OtpDeliveryConfig };

/** Parses process.env, failing with every problem listed by variable name (never by value). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat blank `NAME=` lines in .env files as unset.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment (see docs/BACKEND_STACK.md §12):\n${problems.join("\n")}`);
  }

  const config = parsed.data;
  let otpDelivery: OtpDeliveryConfig;
  if (config.DEMO_MODE) {
    otpDelivery = { mode: "demo" };
  } else if (config.RESEND_API_KEY && config.OTP_EMAIL_FROM) {
    otpDelivery = { mode: "resend", apiKey: config.RESEND_API_KEY, from: config.OTP_EMAIL_FROM };
  } else {
    // Fail closed: without a sender, nobody could sign in and codes would silently vanish.
    throw new Error("Invalid environment: set RESEND_API_KEY and OTP_EMAIL_FROM, or DEMO_MODE=true to log codes.");
  }
  return { ...config, otpDelivery };
}
