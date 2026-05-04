/**
 * copilot-proxy — Supabase Edge Function
 *
 * Forwards chat completion requests to the GitHub Copilot API using a
 * server-side token. The token is never exposed to the browser.
 *
 * POST /functions/v1/copilot-proxy
 * Body: same shape as OpenAI chat completions (model, messages, etc.)
 * Auth: requires a valid Supabase JWT (signed-in users only)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { log } from '../_shared/log.ts'

const logger = log('copilot-proxy')
const COPILOT_BASE = 'https://api.githubcopilot.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Read a Response safely — always returns { ok, status, body (text), json? } */
async function readResp(resp: Response) {
  const text = await resp.text().catch(() => '')
  let json: unknown = undefined
  try { json = JSON.parse(text) } catch (_) { /* not JSON */ }
  return { ok: resp.ok, status: resp.status, body: text, json }
}

/** Return a structured JSON error response */
function errorResp(status: number, code: string, message: string, detail?: unknown) {
  logger.error(message, { status, code, detail })
  return new Response(
    JSON.stringify({ error: { code, message, detail } }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

serve(async (req) => {
  const reqId = crypto.randomUUID().slice(0, 8)
  logger.info('request', { reqId, method: req.method })

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResp(401, 'missing_auth', 'Missing or malformed Authorization header')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
    if (authErr || !user) {
      return errorResp(401, 'unauthorized', 'Invalid Supabase session', authErr?.message)
    }
    logger.info('auth ok', { reqId, user_id: user.id })

    // ── Copilot token ────────────────────────────────────────────────────────
    const token = Deno.env.get('GITHUB_COPILOT_TOKEN')
    if (!token) {
      return errorResp(500, 'no_token', 'GITHUB_COPILOT_TOKEN secret is not set')
    }

    const copilotHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Editor-Version': 'vscode/1.99.0',
      'Editor-Plugin-Version': 'copilot-chat/0.26.0',
      'Copilot-Integration-Id': 'vscode-chat',
      'User-Agent': 'GitHubCopilotChat/0.26.0',
    }

    // ── Resolve model ────────────────────────────────────────────────────────
    let model = 'gpt-5-mini'
    try {
      const modelsR = await readResp(await fetch(`${COPILOT_BASE}/models`, { headers: copilotHeaders }))
      logger.debug('models endpoint', { reqId, status: modelsR.status })

      if (modelsR.ok && modelsR.json) {
        const data = modelsR.json as { data?: { id: string, policy?: { state: string }, supported_endpoints?: string[] }[] }
        const available = (data.data ?? [])
          .filter(m => m.policy?.state !== 'disabled' && (m.supported_endpoints ?? []).includes('/chat/completions'))
          .map(m => m.id)
        logger.info('available models', { reqId, available })
        const preferred = ['gpt-5-mini', 'gpt-5.2', 'gpt-5.4', 'claude-sonnet-4', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'claude-haiku-4.5']
        const pick = preferred.find(p => available.includes(p)) ?? available[0]
        if (pick) model = pick
      } else {
        logger.warn('models endpoint failed, using default', { reqId, status: modelsR.status, body: modelsR.body.slice(0, 200) })
      }
    } catch (e) {
      logger.warn('models fetch threw, using default', { reqId, err: String(e) })
    }

    // ── Forward to Copilot ───────────────────────────────────────────────────
    const body = await req.json()
    logger.info('calling copilot', { reqId, model, msgCount: body.messages?.length })

    const upstreamR = await readResp(
      await fetch(`${COPILOT_BASE}/chat/completions`, {
        method: 'POST',
        headers: copilotHeaders,
        body: JSON.stringify({ ...body, model }),
      })
    )
    logger.info('copilot response', { reqId, status: upstreamR.status, ok: upstreamR.ok, isJson: upstreamR.json !== undefined })

    if (!upstreamR.ok) {
      return errorResp(upstreamR.status, 'upstream_error',
        `GitHub Copilot API returned ${upstreamR.status}`,
        { model, upstream_body: upstreamR.body.slice(0, 500) })
    }
    if (upstreamR.json === undefined) {
      return errorResp(500, 'invalid_upstream_json',
        'GitHub Copilot returned a non-JSON response',
        { model, body_preview: upstreamR.body.slice(0, 300) })
    }

    logger.info('success', { reqId, model })
    return new Response(JSON.stringify(upstreamR.json), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return errorResp(500, 'internal_error', 'Unhandled proxy error', String(err))
  }
})
