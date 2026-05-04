/**
 * Minimalist structured logger for Supabase Edge Functions.
 * Output is JSON lines — Supabase captures console.log() in the Functions log viewer.
 *
 * Usage:
 *   import { log } from '../_shared/log.ts'
 *   const logger = log('copilot-proxy')
 *   logger.info('request received', { user_id, model })
 *   logger.error('upstream failed', { status, body })
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  ts: string
  lvl: Level
  fn: string        // function name
  msg: string
  [key: string]: unknown
}

function emit(lvl: Level, fn: string, msg: string, extra?: Record<string, unknown>) {
  const entry: LogEntry = { ts: new Date().toISOString(), lvl, fn, msg, ...extra }
  // Supabase captures console output per-invocation
  if (lvl === 'error' || lvl === 'warn') {
    console.error(JSON.stringify(entry))
  } else {
    console.log(JSON.stringify(entry))
  }
}

export function log(fnName: string) {
  return {
    debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', fnName, msg, extra),
    info:  (msg: string, extra?: Record<string, unknown>) => emit('info',  fnName, msg, extra),
    warn:  (msg: string, extra?: Record<string, unknown>) => emit('warn',  fnName, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => emit('error', fnName, msg, extra),
  }
}

