import nodemailer from "nodemailer";
import { env } from "../config/env.js";

export function isEmailConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
}

export async function sendEmail(input: { to: string; subject: string; text: string; html?: string }) {
  if (!isEmailConfigured()) {
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  await transporter.sendMail({ from: env.SMTP_FROM, ...input });
  return true;
}
