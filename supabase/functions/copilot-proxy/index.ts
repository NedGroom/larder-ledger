/**
 * copilot-proxy — Supabase Edge Function
 *
 * Forwards chat completion requests to the GitHub Copilot API using a
 * server-side token. The token is never exposed to the browser.
 *
 * POST /functions/v1/copilot-proxy
 * Body: same shape as OpenAI chat completions (model, messages, etc.)
 * Auth: requires a valid Supabase JWT (i.e. signed-in users only)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const COPILOT_URL = 'https://api.githubcopilot.com/chat/completions'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify the caller is a signed-in Supabase user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Forward the request body to GitHub Copilot
    const body = await req.json()
    const token = Deno.env.get('GITHUB_COPILOT_TOKEN')
    if (!token) {
      return new Response(JSON.stringify({ error: 'Copilot token not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const copilotHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Editor-Version': 'vscode/1.99.0',
      'Editor-Plugin-Version': 'copilot-chat/0.26.0',
      'Copilot-Integration-Id': 'vscode-chat',
      'User-Agent': 'GitHubCopilotChat/0.26.0',
    }

    // Resolve the best available model from the Copilot models endpoint
    let model = body.model || 'gpt-4o'
    try {
      const modelsResp = await fetch('https://api.githubcopilot.com/models', {
        headers: copilotHeaders,
      })
      if (modelsResp.ok) {
        const modelsData = await modelsResp.json()
        const models: string[] = (modelsData.data ?? modelsData.models ?? []).map((m: { id: string }) => m.id)
        // Prefer gpt-4o, then gpt-4, then first available chat model
        const preferred = ['gpt-4o', 'gpt-4o-mini', 'gpt-4', 'claude-3.5-sonnet', 'claude-3.7-sonnet']
        const pick = preferred.find(p => models.includes(p)) ?? models[0]
        if (pick) model = pick
      }
    } catch (_) { /* fall through with default */ }

    const upstream = await fetch(COPILOT_URL, {
      method: 'POST',
      headers: copilotHeaders,
      body: JSON.stringify({ ...body, model }),
    })

    const data = await upstream.json()
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

