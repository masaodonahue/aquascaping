/**
 * Public config for the browser.
 *
 * Only returns the OAuth client ID, which is public by design -- it identifies
 * the app, it doesn't authorise anything. Deliberately unauthenticated: the page
 * needs this before it can show a sign-in button.
 *
 * This exists so the client ID lives in exactly one place (Vercel env vars) and
 * index.html never has to be edited.
 */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ clientId: process.env.GOOGLE_CLIENT_ID || '' });
}
