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
    let model = 'gpt-4o' // fallback, will be overridden below
    try {
      const modelsResp = await fetch('https://api.githubcopilot.com/models', {
        headers: copilotHeaders,
      })
      if (modelsResp.ok) {
        const modelsData = await modelsResp.json()
        // Only use models that are enabled and support /chat/completions
        const available: string[] = (modelsData.data ?? [])
          .filter((m: { policy?: { state: string }, supported_endpoints?: string[] }) =>
            m.policy?.state !== 'disabled' &&
            (m.supported_endpoints ?? []).includes('/chat/completions')
          )
          .map((m: { id: string }) => m.id)

        // Prefer in this order — pick the first one available
        const preferred = [
          'gpt-5-mini', 'gpt-5.2', 'gpt-5.4',
          'claude-sonnet-4', 'claude-sonnet-4.5', 'claude-sonnet-4.6',
          'claude-haiku-4.5',
        ]
        const pick = preferred.find(p => available.includes(p)) ?? available[0]
        if (pick) model = pick
      }
    } catch (_) { /* fall through */ }

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

