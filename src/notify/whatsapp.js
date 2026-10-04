/**
 * WhatsApp alerts. Two options, picked by which env vars are set:
 *
 * 1) Meta WhatsApp Cloud API (needs a WhatsApp Business number and an approved template
 *    with ONE body parameter {{1}} that we fill with the alert text):
 *    WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TO (comma separated, E.164 e.g. 919876543210),
 *    WHATSAPP_TEMPLATE (template name), WHATSAPP_TEMPLATE_LANG (default en)
 *
 * 2) Twilio (fastest to try; sandbox works for testing):
 *    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886), WHATSAPP_TO
 */
export function whatsappStatus() {
  if (process.env.TWILIO_ACCOUNT_SID) {
    const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'WHATSAPP_TO'].filter((k) => !process.env[k]);
    return { configured: missing.length === 0, missing, via: 'twilio' };
  }
  const missing = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_TO', 'WHATSAPP_TEMPLATE'].filter((k) => !process.env[k]);
  return { configured: missing.length === 0, missing, via: 'meta' };
}

export async function sendWhatsApp(text) {
  const st = whatsappStatus();
  if (!st.configured) return { sent: false, reason: `Missing ${st.missing.join(', ')}` };
  const recipients = process.env.WHATSAPP_TO.split(',').map((s) => s.trim()).filter(Boolean);
  const results = [];
  for (const to of recipients) {
    if (st.via === 'twilio') {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const body = new URLSearchParams({ From: process.env.TWILIO_WHATSAPP_FROM, To: to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace(/^\+/, '')}`, Body: text });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message || JSON.stringify(json)}`);
      results.push({ to, id: json.sid });
    } else {
      const payload = {
        messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
          // WhatsApp template parameters cannot contain newlines or more than 4 consecutive spaces.
          components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s*\n+\s*/g, ' | ').slice(0, 1000) }] }],
        },
      };
      const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${json.error?.message || JSON.stringify(json)}`);
      results.push({ to, id: json.messages?.[0]?.id });
    }
  }
  return { sent: true, via: st.via, results };
}
