#!/usr/bin/env node
/**
 * scripts/fetch-logs.js
 *
 * Pulls logs from Supabase Management API and uploads them to Supabase Storage.
 * Designed to run in GitHub Actions (hourly) or locally.
 *
 * Sources pulled:
 *   - edge_logs      (Edge Function invocations)
 *   - postgres_logs  (slow queries, errors)
 *   - auth_logs      (sign-in events, errors)
 *
 * Output: one NDJSON file per source per run, stored at:
 *   logs/{source}/{YYYY-MM-DD}/{HH-MM}.ndjson
 *
 * Required env vars:
 *   SUPABASE_ACCESS_TOKEN    — PAT from supabase.com/dashboard/account/tokens
 *   SUPABASE_PROJECT_REF     — e.g. uqadardaukfbrewbuhgk
 *   SUPABASE_URL             — e.g. https://uqadardaukfbrewbuhgk.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — for writing to storage
 *
 * Optional:
 *   LOG_LOOKBACK_MINUTES     — how far back to fetch (default: 65, slightly overlaps to avoid gaps)
 *   LOG_SOURCES              — comma-separated list (default: edge_logs,postgres_logs,auth_logs)
 */

import { createClient } from '@supabase/supabase-js'

const PROJECT_REF       = process.env.SUPABASE_PROJECT_REF     || 'uqadardaukfbrewbuhgk'
const ACCESS_TOKEN      = process.env.SUPABASE_ACCESS_TOKEN
const SUPABASE_URL      = process.env.SUPABASE_URL              || `https://${PROJECT_REF}.supabase.co`
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const LOOKBACK_MINUTES  = parseInt(process.env.LOG_LOOKBACK_MINUTES || '65', 10)
const SOURCES           = (process.env.LOG_SOURCES || 'edge_logs,postgres_logs,auth_logs').split(',')
const STORAGE_BUCKET    = 'logs'
const DRY_RUN           = process.env.DRY_RUN === '1'

if (!ACCESS_TOKEN)     { console.error('❌  SUPABASE_ACCESS_TOKEN is required'); process.exit(1) }
if (!SERVICE_ROLE_KEY) { console.error('❌  SUPABASE_SERVICE_ROLE_KEY is required'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── SQL queries per log source ────────────────────────────────────────────────
const QUERIES = {
  edge_logs: `
    SELECT
      id, timestamp,
      event_message,
      metadata->>'level' AS level,
      metadata->>'function_id' AS function_id,
      metadata->>'execution_time_ms' AS execution_time_ms,
      metadata->>'status_code' AS status_code
    FROM edge_logs
    WHERE timestamp > now() - interval '${LOOKBACK_MINUTES} minutes'
    ORDER BY timestamp DESC
    LIMIT 5000
  `,
  postgres_logs: `
    SELECT
      id, timestamp,
      event_message,
      metadata->>'error_severity' AS severity,
      metadata->>'query' AS query,
      metadata->>'detail' AS detail
    FROM postgres_logs
    WHERE timestamp > now() - interval '${LOOKBACK_MINUTES} minutes'
      AND metadata->>'error_severity' IN ('ERROR','FATAL','WARNING','LOG')
    ORDER BY timestamp DESC
    LIMIT 2000
  `,
  auth_logs: `
    SELECT
      id, timestamp,
      event_message,
      metadata->>'level' AS level,
      metadata->>'path' AS path,
      metadata->>'status' AS status,
      metadata->>'msg' AS msg
    FROM auth_logs
    WHERE timestamp > now() - interval '${LOOKBACK_MINUTES} minutes'
    ORDER BY timestamp DESC
    LIMIT 2000
  `,
}

async function fetchLogs(source) {
  const sql = encodeURIComponent(QUERIES[source].trim())
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?sql=${sql}`

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Management API ${resp.status} for ${source}: ${body.slice(0, 200)}`)
  }

  const data = await resp.json()
  return data.result ?? []
}

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets()
  if (!buckets?.find(b => b.name === STORAGE_BUCKET)) {
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: false })
    if (error) throw new Error(`Failed to create bucket: ${error.message}`)
    console.log(`  ✅ Created storage bucket '${STORAGE_BUCKET}'`)
  }
}

async function uploadLogs(source, rows, timestamp) {
  const date = timestamp.toISOString().slice(0, 10)          // YYYY-MM-DD
  const time = timestamp.toISOString().slice(11, 16).replace(':', '-') // HH-MM
  const path = `${source}/${date}/${time}.ndjson`
  const ndjson = rows.map(r => JSON.stringify(r)).join('\n')

  if (DRY_RUN) {
    console.log(`  [DRY RUN] would upload ${rows.length} rows → ${STORAGE_BUCKET}/${path}`)
    return
  }

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, ndjson, { contentType: 'application/x-ndjson', upsert: true })

  if (error) throw new Error(`Storage upload failed for ${source}: ${error.message}`)
  console.log(`  ✅ ${source}: ${rows.length} rows → ${path}`)
}

async function main() {
  const now = new Date()
  console.log(`\n🪵  Supabase log drain — ${now.toISOString()}`)
  console.log(`   Project : ${PROJECT_REF}`)
  console.log(`   Sources : ${SOURCES.join(', ')}`)
  console.log(`   Lookback: ${LOOKBACK_MINUTES} min\n`)

  if (!DRY_RUN) await ensureBucket()

  let totalRows = 0
  const errors = []

  for (const source of SOURCES) {
    if (!QUERIES[source]) { console.warn(`  ⚠️  Unknown source: ${source}, skipping`); continue }
    try {
      process.stdout.write(`  Fetching ${source}... `)
      const rows = await fetchLogs(source)
      console.log(`${rows.length} rows`)
      if (rows.length > 0) {
        await uploadLogs(source, rows, now)
        totalRows += rows.length
      } else {
        console.log(`  (no rows for ${source} in last ${LOOKBACK_MINUTES} min)`)
      }
    } catch (err) {
      console.error(`  ❌ ${source}: ${err.message}`)
      errors.push({ source, error: err.message })
    }
  }

  console.log(`\n  Total: ${totalRows} rows across ${SOURCES.length} sources`)
  if (errors.length) {
    console.error(`  Errors: ${errors.map(e => e.source).join(', ')}`)
    process.exit(1)
  }
  console.log('  Done ✓\n')
}

main().catch(err => { console.error(err); process.exit(1) })

