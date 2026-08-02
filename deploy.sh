#!/usr/bin/env bash
# Push Code.gs and update the existing web app deployment in place.
#
# The -i flag is the important part: without a deployment id, clasp creates a
# NEW deployment with a NEW /exec URL, and your Vercel SHEET_URL would stop
# matching. With it, the URL you already configured keeps working.
set -euo pipefail

cd "$(dirname "$0")"

if [ -z "${DEPLOYMENT_ID:-}" ]; then
  echo "Set DEPLOYMENT_ID first. Find it with:  clasp deployments"
  echo "Then:  DEPLOYMENT_ID=AKfy... ./deploy.sh"
  exit 1
fi

clasp push --force
clasp deploy -i "$DEPLOYMENT_ID" -d "$(date '+%Y-%m-%d %H:%M')"
echo "Pushed and redeployed."
