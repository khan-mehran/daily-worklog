import nodemailer from "nodemailer";
import type { EmailMessage, EmailService } from "./types";

class SmtpEmailService implements EmailService {
  private transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });

  async send(message: EmailMessage) {
    await this.transport.sendMail({
      from: process.env.EMAIL_FROM ?? "WorkLog <no-reply@worklog.local>",
      ...message,
    });
  }
}

let service: EmailService | null = null;

export function getEmailService(): EmailService {
  return (service ??= new SmtpEmailService());
}

/**
 * Mail is a side effect of a change that has already been saved, so a mail outage must not fail
 * the request. Returns whether the message was accepted.
 */
export async function sendEmailSafely(message: EmailMessage) {
  try {
    await getEmailService().send(message);
    return true;
  } catch (error) {
    console.error(`[email] could not send "${message.subject}"`, error);
    return false;
  }
}
