/**
 * Proxy between the browser and the Apps Script web app.
 *
 * Two jobs:
 *   1. SHEET_TOKEN never reaches the client. If the browser called Apps Script
 *      directly, the token would sit in view-source on a public URL.
 *   2. Every request carries a Google ID token, verified here against Google
 *      and checked against ALLOWED_EMAILS. The page can be public; this can't.
 *
 * Environment variables (Vercel -> Settings -> Environment Variables):
 *   SHEET_URL          the /exec URL from your Apps Script deployment
 *   SHEET_TOKEN        the TOKEN value from Code.gs
 *   GOOGLE_CLIENT_ID   OAuth client ID (same value as CLIENT_ID in index.html)
 *   ALLOWED_EMAILS     comma-separated list of Google accounts allowed in
 */

async function verify(req) {
  const header = req.headers.authorization || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!idToken) return { ok: false, error: 'not signed in' };

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const allowed = (process.env.ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!clientId || !allowed.length) {
    return { ok: false, error: 'GOOGLE_CLIENT_ID or ALLOWED_EMAILS not set' };
  }

  // Google's tokeninfo endpoint checks the signature and expiry for us. Slower
  // than verifying locally, but there is no library to keep current and this
  // runs a handful of times a week.
  const r = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken)
  );
  if (!r.ok) return { ok: false, error: 'token rejected' };

  const info = await r.json();
  if (info.aud !== clientId) return { ok: false, error: 'token issued for another app' };
  if (info.email_verified !== 'true' && info.email_verified !== true) {
    return { ok: false, error: 'email not verified' };
  }
  if (allowed.indexOf(String(info.email).toLowerCase()) === -1) {
    return { ok: false, error: 'not an allowed account' };
  }
  return { ok: true, email: info.email };
}

export default async function handler(req, res) {
  const url = process.env.SHEET_URL;
  const token = process.env.SHEET_TOKEN;
  if (!url || !token) {
    return res.status(500).json({ ok: false, error: 'SHEET_URL or SHEET_TOKEN not set' });
  }

  const auth = await verify(req);
  if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${url}?token=${encodeURIComponent(token)}`, { redirect: 'follow' });
      const data = await r.json();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !Array.isArray(body.rows) || !body.rows.length) {
        return res.status(400).json({ ok: false, error: 'no rows' });
      }
      const r = await fetch(url, {
        method: 'POST',
        // text/plain on purpose: Apps Script cannot answer a CORS preflight,
        // and this content type does not trigger one.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, rows: body.rows }),
        redirect: 'follow'
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err.message || err) });
  }
}
