#!/usr/bin/env node
/**
 * Copy the web app's shared modules into supabase/functions/_shared/larder/ so the
 * larder-mcp edge function runs the *same* code as the app (one rulebook).
 * Supabase bundles each function from supabase/functions, so the copy is what
 * gets deployed. The bare npm import is rewritten to the esm.sh URL Deno uses,
 * matching the other functions.
 *
 *   node scripts/sync-mcp-lib.mjs          write the copies
 *   node scripts/sync-mcp-lib.mjs --check  exit 1 if they're out of date (tests run this)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['assistant.js', 'larder.js', 'planner.js', 'nutrition.js', 'units.js', 'supabase.js']
const SRC = join(root, 'web/src/lib')
const DEST = join(root, 'supabase/functions/_shared/larder')
const BANNER = '// GENERATED from web/src/lib by scripts/sync-mcp-lib.mjs - edit the original, then re-run.\n'

const render = f => BANNER + readFileSync(join(SRC, f), 'utf8')
  .replace("from '@supabase/supabase-js'", "from 'https://esm.sh/@supabase/supabase-js@2'")

const check = process.argv.includes('--check')
const stale = []
mkdirSync(DEST, { recursive: true })
for (const f of FILES) {
  const want = render(f)
  const path = join(DEST, f)
  const have = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (have === want) continue
  if (check) stale.push(f)
  else writeFileSync(path, want)
}
if (check && stale.length) {
  console.error(`out of date in supabase/functions/_shared/larder: ${stale.join(', ')} - run node scripts/sync-mcp-lib.mjs`)
  process.exit(1)
}
console.log(check ? 'mcp lib copies are up to date' : `synced ${FILES.length} files to ${DEST}`)
