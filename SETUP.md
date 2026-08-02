# Deploying Code.gs without the copy-paste

One-time setup, then `./deploy.sh` replaces paste → save → Deploy → Manage → edit → Deploy.

## One time

1. **Turn on the Apps Script API** — visit
   https://script.google.com/home/usersettings and switch it on. Nothing works
   without this and the error message doesn't say so.

2. **Install and sign in**

   ```
   npm install -g @google/clasp
   clasp login
   ```

3. **Get the script id** — Apps Script editor → Project Settings (gear) → IDs →
   Script ID. Copy `.clasp.json.example` to `.clasp.json` and paste it in.

   `.clasp.json` is gitignored: it points at your script, not the code.

4. **Get the deployment id** — from this folder:

   ```
   clasp deployments
   ```

   Take the one that isn't `@HEAD`. It looks like `AKfycb...`.

## Every time after

```
DEPLOYMENT_ID=AKfycb... ./deploy.sh
```

Or put the export in your shell profile and just run `./deploy.sh`.

## Notes

- `clasp push` overwrites the online copy. The repo is the source of truth now —
  don't edit in the browser editor or your changes get flattened on next push.
- `appsscript.json` carries the web app settings (execute as you, accessible to
  anyone), so a redeploy can't silently reset them.
- Script Properties are NOT in the repo. `TOKEN` stays where it is; clasp never
  touches it.
