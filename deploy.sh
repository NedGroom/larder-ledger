#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — build & push to trigger GitHub Pages + Cloudflare CI/CD
#
# Usage:
#   ./deploy.sh                  # commit current branch and push to main
#   ./deploy.sh "my message"     # custom commit message
#   ./deploy.sh "" my-branch     # push a specific branch to main
#
# The GitHub Actions pipeline fires automatically on push to main.
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$REPO_ROOT/web"
MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M')}"
CURRENT=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)

echo "▶  Branch        : $CURRENT"
echo "▶  Commit message: $MSG"
echo ""

# ── 1. Verify build passes locally before pushing ────────────────────────────
echo "🔨 Building web app..."
cd "$WEB_DIR"
npm install --silent
npm run build
echo "✅ Build OK ($(du -sh dist | cut -f1) output)"
cd "$REPO_ROOT"

# ── 2. Stage & commit any uncommitted changes ─────────────────────────────────
if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
  echo ""
  echo "📦 Staging changes..."
  git -C "$REPO_ROOT" add -A
  git -C "$REPO_ROOT" commit -m "$MSG"
fi

# ── 3. Push current branch tip to origin/main (no local merge) ───────────────
echo ""
echo "🚀 Pushing $CURRENT → origin/main (no local merge)..."
git -C "$REPO_ROOT" push origin HEAD:main

echo ""
echo "✅ Done! GitHub Actions is now building and deploying."
echo "   Watch progress: https://github.com/NedGroom/larder-ledger/actions"
echo "   Live site:      https://nedgroom.github.io/larder-ledger/"



