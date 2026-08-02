/**
 * Proxy between the browser and the Apps Script web app.
 *
 * Three jobs:
 *   1. SHEET_TOKEN never reaches the client.
 *   2. Verify a Google ID token on first sign-in.
 *   3. Swap that for a signed session cookie, so you sign in about once a
 *      month instead of once an hour. Google ID tokens expire in 60 minutes;
 *      re-prompting that often is the wrong trade for a personal app.
 *
 * Environment variables:
 *   SHEET_URL          the /exec URL from your Apps Script deployment
 *   SHEET_TOKEN        the TOKEN script property from Apps Script
 *   GOOGLE_CLIENT_ID   OAuth client ID
 *   ALLOWED_EMAILS     comma-separated Google accounts allowed in
 */

import crypto from 'node:crypto';

const COOKIE = 'aq_session';
const SESSION_DAYS = 30;

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function makeSession(email, secret) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${Buffer.from(email).toString('base64url')}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

function readSession(cookieHeader, secret, allowed) {
  const raw = (cookieHeader || '')
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(COOKIE + '='));
  if (!raw) return null;

  const parts = raw.slice(COOKIE.length + 1).split('.');
  if (parts.length !== 3) return null;

  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload, secret);
  // Constant-time compare so a wrong signature can't be probed byte by byte.
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  if (Number(parts[1]) < Date.now()) return null;

  const email = Buffer.from(parts[0], 'base64url').toString('utf8').toLowerCase();
  if (allowed.length && !allowed.includes(email)) return null;
  return email;
}

async function verifyIdToken(idToken, clientId, allowed) {
  const r = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken)
  );
  if (!r.ok) return { ok: false, error: 'token rejected' };

  const info = await r.json();
  if (info.aud !== clientId) return { ok: false, error: 'token issued for another app' };
  if (info.email_verified !== 'true' && info.email_verified !== true) {
    return { ok: false, error: 'email not verified' };
  }
  const email = String(info.email).toLowerCase();
  if (!allowed.includes(email)) return { ok: false, error: 'not an allowed account' };
  return { ok: true, email };
}

export default async function handler(req, res) {
  const url = process.env.SHEET_URL;
  const token = process.env.SHEET_TOKEN;
  if (!url || !token) {
    return res.status(500).json({ ok: false, error: 'SHEET_URL or SHEET_TOKEN not set' });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const allowed = (process.env.ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const authOn = Boolean(clientId && allowed.length);

  if (authOn) {
    let email = readSession(req.headers.cookie, token, allowed);

    if (!email) {
      const header = req.headers.authorization || '';
      const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!idToken) return res.status(401).json({ ok: false, error: 'not signed in' });

      const check = await verifyIdToken(idToken, clientId, allowed);
      if (!check.ok) return res.status(401).json({ ok: false, error: check.error });
      email = check.email;

      res.setHeader('Set-Cookie',
        `${COOKIE}=${makeSession(email, token)}; HttpOnly; Secure; SameSite=Lax; ` +
        `Path=/; Max-Age=${SESSION_DAYS * 86400}`);
    }
  }

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${url}?token=${encodeURIComponent(token)}`, { redirect: 'follow' });
      const data = await r.json();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const action = (body && body.action) || 'append';
      if (action === 'append' && (!body || !Array.isArray(body.rows) || !body.rows.length)) {
        return res.status(400).json({ ok: false, error: 'no rows' });
      }
      const r = await fetch(url, {
        method: 'POST',
        // text/plain on purpose: Apps Script cannot answer a CORS preflight.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, action, id: body.id, rows: body.rows || [] }),
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
