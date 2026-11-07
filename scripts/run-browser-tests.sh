#!/bin/sh
# Run every test suite in the Playwright Docker image (Node + Chromium), without
# touching web/.env: Vite takes VITE_* from the environment first.
#   docker run --rm -v "$PWD:/repo" -v larder-node-modules:/repo/web/node_modules -w /repo \
#     mcr.microsoft.com/playwright:v1.49.0-noble sh scripts/run-browser-tests.sh
set -u
cd /repo/web
npm install --no-audit --no-fund --silent >/dev/null 2>&1
npm i --no-save --no-audit --no-fund --silent playwright@1.49.0 >/dev/null 2>&1
export CHROME_PATH="$(ls -d /ms-playwright/chromium-*/chrome-linux/chrome | head -1)"
VITE_SUPABASE_URL=http://127.0.0.1:9999 VITE_SUPABASE_ANON_KEY=test npx vite --port 5173 >/tmp/vite.log 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:5173/larder-ledger/ && break; sleep 1; done
fail=0
for t in assistant planner-math nutrition-and-deck larder-and-shop larder-view receipt-as-shop receipt-fills-shop planner dishes prices ingredient-edits; do
  if node test/$t.test.mjs >/tmp/$t.log 2>&1; then echo "PASS $t: $(tail -1 /tmp/$t.log)"
  else echo "FAIL $t"; grep -E "FAIL|Error" /tmp/$t.log | head -8; fail=1; fi
done
exit $fail
