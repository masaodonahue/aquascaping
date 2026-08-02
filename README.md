# Aquascape Log

Single-page tracker for planted tanks. Google Sheet is the store; the app is
the only interface.

```
index.html            the whole app — no build step, no framework
api/log.mjs           Vercel function that proxies to Apps Script
apps-script/Code.gs   paste into the sheet's Apps Script editor
.vercelignore         keeps Code.gs and this README off the deployment
.gitignore
```

`.mjs` on purpose: the function uses ESM, and without the extension Vercel would
need a `package.json` declaring `"type": "module"`. This way there's no
`package.json` at all.

## How the pieces fit

```
browser ──► /api/log ──────────────► Apps Script /exec ──► Sheet "Events" tab
      Google ID token   verified here,      sheet token
      (per request)     then swapped for    (never leaves Vercel)
                        the sheet token
```

The page is public; the endpoint isn't. Every call to `/api/log` carries a
Google ID token, which the function verifies against Google and checks against
`ALLOWED_EMAILS` before it will read or write anything.

Rows are long-format: one row per metric, grouped by timestamp. A water change
with dosing and a trim writes seven rows sharing one timestamp; the app groups
them back into a single entry on load. Adding a new metric later adds rows, not
columns — there is never a migration.

Config lives in the same tab as `setting` rows. CO2 times, cadence intervals,
net volume, dose rules and tank names are all just the newest row for that
metric. There is no second tab and no config file.

## Setup

1. **Apps Script.** Open the sheet → Extensions → Apps Script, paste
   `apps-script/Code.gs`, set `TOKEN` to something only you know, then
   Deploy → New deployment → Web app, executing as you, accessible to anyone.
   Run `sheet_()` once from the editor so the column formatting applies.

2. **GitHub.** Push this folder.

3. **Vercel.** Import the repo. Framework preset: Other. No build command,
   no output directory.

4. **Google OAuth client.** Google Cloud Console → APIs & Services →
   Credentials → Create OAuth client ID → Web application. Add your Vercel
   domain (and `http://localhost:3000` if you run it locally) to Authorised
   JavaScript origins. Copy the client ID into `CLIENT_ID` at the top of the
   script block in `index.html`.

5. **Environment variables** in Vercel → Settings:

   | Name | Value |
   |---|---|
   | `SHEET_URL` | the `/exec` URL from step 1 |
   | `SHEET_TOKEN` | the `TOKEN` from `Code.gs` |
   | `GOOGLE_CLIENT_ID` | same client ID as in `index.html` |
   | `ALLOWED_EMAILS` | your Google address; comma-separated for more |

   Redeploy after adding them — Vercel does not apply env vars to existing builds.

6. **Backups.** In the Apps Script editor, run `installBackupTrigger()` once.
   It copies the sheet to an "Aquascape Log backups" folder every Sunday
   evening and keeps the last ten. First run will ask for Drive permission.

## Gotchas

- **Apps Script serves the deployment, not the saved file.** Editing and saving
  without redeploying leaves the old code live. This is the most common reason
  a change appears to do nothing.
- **Everything is written as a string.** The Value column is formatted as plain
  text so Sheets stops reading `3/4` as a date and `07:30` as a time. Don't
  reformat those columns by hand.
- **Writes queue on failure.** A failed POST goes to `localStorage` and retries
  on next load, so logging at the tank works on bad wifi.
- **Sign-in expires hourly.** Google ID tokens last an hour. The app treats a
  401 as routine and shows the sign-in button again rather than erroring.
- **Writes are validated server-side.** Apps Script rejects unknown event types,
  bad tank ids, implausible timestamps and writes over 40 rows. A frontend bug
  appending garbage is the likelier threat than a stranger.
