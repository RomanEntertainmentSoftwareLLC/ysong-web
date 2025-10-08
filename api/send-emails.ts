// api/send-emails.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { to } = (req.body ?? {}) as { to?: string };
  if (!to) return res.status(400).json({ error: 'Missing "to" email' });

  try {
    const { error } = await resend.emails.send({
      from: 'YSong <onboarding@resend.dev>', // works without domain verification
      to,
      subject: 'Hello from YSong',
      text: 'Hello World from YSong by Roman Entertainment Software LLC',
      // reply_to: 'support@ysong.ai', // optional
    });

    if (error) {
      console.error('RESEND ERROR:', error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('HANDLER ERROR:', e);
    return res.status(500).json({ error: e?.message || 'Failed to send email' });
  }
}
