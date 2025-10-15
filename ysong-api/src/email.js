import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const APP_URL = process.env.APP_URL;

if (!RESEND_API_KEY || !EMAIL_FROM || !APP_URL) {
  throw new Error("Missing RESEND_API_KEY or EMAIL_FROM or APP_URL");
}

const resend = new Resend(RESEND_API_KEY);

export async function sendVerifyEmail(toEmail, rawToken) {
  const verifyUrl = `${APP_URL}/verify?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(toEmail)}`;
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Verify your YSong account</h2>
      <p>Click the button below to confirm your email. The link expires in 30 minutes.</p>
      <p><a href="${verifyUrl}"
            style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">
            Verify my email
          </a></p>
      <p>If the button doesn’t work, copy and paste this URL:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <hr/>
      <p style="color:#666;font-size:12px">If you didn’t sign up, you can ignore this message.</p>
    </div>
  `;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: toEmail,
    subject: "Verify your YSong account",
    html
  });
}
