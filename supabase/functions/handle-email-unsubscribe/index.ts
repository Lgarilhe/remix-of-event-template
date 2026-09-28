import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // Extract token from query params (GET) or body (POST)
  const url = new URL(req.url)
  let token: string | null = url.searchParams.get('token')

  if (req.method === 'POST') {
    // Detect RFC 8058 one-click unsubscribe: POST with form-encoded body
    // containing "List-Unsubscribe=One-Click". Email clients (Gmail, Apple Mail,
    // etc.) send this when the user clicks "Unsubscribe" in the mail UI.
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formText = await req.text()
      const params = new URLSearchParams(formText)
      // For one-click, token comes from query param (already set above).
      // Otherwise, token may be in the form body.
      if (!params.get('List-Unsubscribe')) {
        const formToken = params.get('token')
        if (formToken) {
          token = formToken
        }
      }
    } else {
      // JSON body (from the app's unsubscribe page)
      try {
        const body = await req.json()
        if (body.token) {
          token = body.token
        }
      } catch {
        // Fall through — token stays from query param
      }
    }
  }

  if (!token) {
    return jsonResponse({ error: 'Token is required' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Look up the token
  const { data: tokenRecord, error: lookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (lookupError || !tokenRecord) {
    return jsonResponse({ error: 'Invalid or expired token' }, 404)
  }

  if (tokenRecord.used_at) {
    // Jeton déjà utilisé : l'adresse doit être en liste de suppression. Avant
    // le correctif d'ordre ci-dessous, un échec d'écriture pouvait consommer
    // le jeton sans suppression ; on la répare ici sans écraser une raison
    // existante (rebond, plainte).
    const { error: healError } = await supabase
      .from('suppressed_emails')
      .upsert(
        { email: tokenRecord.email.toLowerCase(), reason: 'unsubscribe' },
        { onConflict: 'email', ignoreDuplicates: true },
      )
    if (healError) {
      console.error('Failed to ensure suppression for used token', { error: healError })
    }
    return jsonResponse({ valid: false, reason: 'already_unsubscribed' })
  }

  // GET: Validate token (the app's unsubscribe page calls this on load)
  if (req.method === 'GET') {
    return jsonResponse({ valid: true })
  }

  // POST: Process the unsubscribe
  // 1. Liste de suppression D'ABORD (upsert idempotent) : si l'écriture
  // échoue, le jeton reste valide et le candidat peut réessayer. Dans l'ordre
  // inverse, le jeton était consommé et l'adresse continuait de recevoir des
  // e-mails (« Déjà désinscrit » au nouvel essai).
  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert(
      { email: tokenRecord.email.toLowerCase(), reason: 'unsubscribe' },
      { onConflict: 'email' },
    )

  if (suppressError) {
    console.error('Failed to suppress email', {
      error: suppressError,
      email: tokenRecord.email,
    })
    return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
  }

  // 2. Puis le jeton marqué utilisé. Deux POST concurrents : l'upsert étant
  // idempotent, les deux aboutissent à la même désinscription.
  const { error: updateError } = await supabase
    .from('email_unsubscribe_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null)

  if (updateError) {
    // La désinscription est effective (adresse en suppression) ; seul le
    // marquage du jeton a échoué, un nouveau clic la confirmerait à nouveau.
    console.error('Failed to mark token as used (unsubscribe already effective)', { error: updateError })
  }

  console.log('Email unsubscribed', { email: tokenRecord.email })

  return jsonResponse({ success: true })
})
