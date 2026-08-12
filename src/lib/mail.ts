import nodemailer from "nodemailer";

export type MailMode = "smtp" | "clipboard";

export function getMailMode(): MailMode {
  return process.env.SMTP_HOST?.trim() ? "smtp" : "clipboard";
}

export type SendMailResult =
  | { ok: true; mode: "smtp"; messageId?: string }
  | { ok: false; mode: "smtp"; error: string }
  | { ok: true; mode: "clipboard" };

/**
 * Send via local SMTP relay when configured. Never uses cloud ESPs.
 * Without SMTP_HOST → clipboard mode (caller handles copy UX).
 */
export async function sendMail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<SendMailResult> {
  if (getMailMode() === "clipboard") {
    return { ok: true, mode: "clipboard" };
  }

  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER?.trim() || undefined;
  const pass = process.env.SMTP_PASS?.trim() || undefined;
  const from =
    process.env.SMTP_FROM?.trim() ||
    user ||
    "noreply@localhost";

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.body,
    });

    return { ok: true, mode: "smtp", messageId: info.messageId };
  } catch (err) {
    return {
      ok: false,
      mode: "smtp",
      error: err instanceof Error ? err.message : "SMTP send failed",
    };
  }
}
