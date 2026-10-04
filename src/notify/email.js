/**
 * Email alerts over SMTP (Gmail app password, Zoho, SES SMTP, etc.).
 * Env: ALERT_EMAIL_TO (comma separated), SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (optional)
 */
export function emailStatus() {
  const missing = ['ALERT_EMAIL_TO', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((k) => !process.env[k]);
  return { configured: missing.length === 0, missing };
}

export async function sendEmail({ subject, text, html }) {
  const { configured, missing } = emailStatus();
  if (!configured) return { sent: false, reason: `Missing ${missing.join(', ')}` };
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const to = process.env.ALERT_EMAIL_TO.split(',').map((s) => s.trim()).filter(Boolean);
  const info = await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
  return { sent: true, to, id: info.messageId };
}
