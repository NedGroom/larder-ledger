/**
 * Minimalist frontend logger — web/src/lib/logger.js
 *
 * Usage:
 *   import logger from './logger.js'
 *   logger.info('extraction started', { provider, contentType })
 *   logger.error('upstream failed', { status, body })
 *
 * - Dev:  coloured console output + stores last 200 entries in memory
 * - Prod: only warn/error go to console; entries still stored in memory
 *
 * Access recent logs anywhere:  import logger from './logger.js'; logger.entries()
 */

const IS_DEV = import.meta.env.DEV

const STYLES = {
  debug: 'color:#888',
  info:  'color:#7ec8e3;font-weight:600',
  warn:  'color:#f5a623;font-weight:600',
  error: 'color:#e05c5c;font-weight:700',
}

const MAX_ENTRIES = 200
const _entries = []

function record(lvl, msg, extra) {
  const entry = { ts: new Date().toISOString(), lvl, msg, ...extra }
  _entries.push(entry)
  if (_entries.length > MAX_ENTRIES) _entries.shift()
  return entry
}

function emit(lvl, msg, extra = {}) {
  const entry = record(lvl, msg, extra)
  const shouldLog = IS_DEV || lvl === 'warn' || lvl === 'error'
  if (!shouldLog) return

  const prefix = `%c[${lvl.toUpperCase()}]`
  const style = STYLES[lvl]
  const hasExtra = Object.keys(extra).length > 0

  if (lvl === 'error') {
    console.error(prefix, style, msg, hasExtra ? extra : '')
  } else if (lvl === 'warn') {
    console.warn(prefix, style, msg, hasExtra ? extra : '')
  } else {
    console.log(prefix, style, msg, hasExtra ? extra : '')
  }
}

const logger = {
  debug: (msg, extra) => emit('debug', msg, extra),
  info:  (msg, extra) => emit('info',  msg, extra),
  warn:  (msg, extra) => emit('warn',  msg, extra),
  error: (msg, extra) => emit('error', msg, extra),

  /** Returns a copy of stored log entries (newest last) */
  entries: () => [..._entries],

  /** Returns only error entries */
  errors: () => _entries.filter(e => e.lvl === 'error'),
}

export default logger

