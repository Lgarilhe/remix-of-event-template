import { createClient } from 'npm:@supabase/supabase-js@2'

// Webhook handler for Resend email events (bounce/complaint/delivery_delayed).
// Resend uses Svix for webhook signatures: https://resend.com/docs/dashboard/webhooks/verify-signatures
//
// Headers sent by Svix:
//   svix-id: unique id of the webhook event
//   svix-timestamp: unix timestamp (seconds)
//   svix-signature: space-separated list of "v1,<base64>" signatures
//
// Verification: HMAC-SHA256 of `${id}.${timestamp}.${body}` using the base64-decoded
// secret (the part after `whsec_`). Compare with any of the signatures in the header.

// Resend event types we care about (https://resend.com/docs/dashboard/webhooks/event-types)
type ResendEventType =
  | 'email.bounced'
  | 'email.complained'
  | 'email.delivery_delayed'
  // We ignore: email.sent, email.delivered, email.opened, email.clicked, email.failed

interface ResendWebhookPayload {
  type: ResendEventType | string
  created_at: string
  data: {
    email_id: string
    from: string
    to: string[]
    subject?: string
    // Bounce-specific
    bounce?: { type?: string; reason?: string; message?: string }
    // Complaint-specific
    complaint?: { reason?: string }
    // Tags we added at send time (e.g. {name: 'label', value: '...'})
    tags?: Array<{ name: string; value: string }>
  }
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function verifySvixSignature(
  svixId: string,
  svixTimestamp: string,
  body: string,
  signatureHeader: string,
  secret: string, // whsec_<base64>
): Promise<boolean> {
  // Reject stale timestamps (±5 min from now) — protects against replay attacks.
  const ts = parseInt(svixTimestamp, 10)
  if (!Number.isFinite(ts)) return false
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - ts) > 5 * 60) return false

  const secretBase64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  const keyBytes = base64ToBytes(secretBase64)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signedPayload = `${svixId}.${svixTimestamp}.${body}`
  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(signedPayload),
  )
  const expectedB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

  // svix-signature header can contain multiple versions separated by spaces,
  // each formatted as "v1,<base64>". We accept if any v1 matches.
  const signatures = signatureHeader
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const sig of signatures) {
    const [version, value] = sig.split(',')
    if (version !== 'v1' || !value) continue
    try {
      const got = base64ToBytes(value)
      const expected = base64ToBytes(expectedB64)
      if (constantTimeEqual(got, expected)) return true
    } catch {
      continue
    }
  }

  return false
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))

  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required env vars (RESEND_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return jsonResponse({ error: 'Missing Svix headers' }, 401)
  }

  const body = await req.text()
  const valid = await verifySvixSignature(svixId, svixTimestamp, body, svixSignature, webhookSecret)
  if (!valid) {
    console.error('Invalid Svix signature', { svix_id: svixId })
    return jsonResponse({ error: 'Invalid signature' }, 401)
  }

  let event: ResendWebhookPayload
  try {
    event = JSON.parse(body) as ResendWebhookPayload
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (!event?.data?.email_id || !Array.isArray(event.data.to) || event.data.to.length === 0) {
    return jsonResponse({ error: 'Invalid payload: missing data.email_id or data.to' }, 400)
  }

  // Map Resend event type -> our suppressed_emails.reason enum (bounce/complaint/unsubscribe).
  // Resend doesn't fire a dedicated unsubscribe event; unsubscribes are handled by our own
  // handle-email-unsubscribe endpoint. Here we only process bounces/complaints.
  let reason: 'bounce' | 'complaint' | null = null
  if (event.type === 'email.bounced') reason = 'bounce'
  else if (event.type === 'email.complained') reason = 'complaint'

  if (!reason) {
    // Other event types (delivery_delayed, sent, delivered, etc.) are acknowledged but ignored.
    console.log('Resend event acknowledged (not suppressed)', {
      type: event.type,
      email_id: event.data.email_id,
    })
    return jsonResponse({ success: true, ignored: true, type: event.type })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // message_id comes back to us via the X-Entity-Ref-ID header we set at send time.
  // Resend exposes it in data.headers but not always — fall back to email_id which
  // is the Resend uuid and can be correlated via email_send_log.metadata.
  const messageId =
    event.data.tags?.find((t) => t.name === 'message_id')?.value ??
    event.data.email_id
  const recipientEmail = String(event.data.to[0] || '').toLowerCase()

  const metadata = {
    provider: 'resend',
    resend_email_id: event.data.email_id,
    event_type: event.type,
    bounce: event.data.bounce ?? null,
    complaint: event.data.complaint ?? null,
  }

  // 1. Upsert to suppressed_emails (idempotent — safe for retries)
  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert(
      {
        email: recipientEmail,
        reason,
        metadata,
      },
      { onConflict: 'email' },
    )

  if (suppressError) {
    console.error('Failed to upsert suppressed email', {
      error: suppressError,
      email_redacted: recipientEmail[0] + '***@' + recipientEmail.split('@')[1],
    })
    return jsonResponse({ error: 'Failed to write suppression' }, 500)
  }

  // 2. Append log entry (never update existing rows).
  const sendLogStatus = reason === 'bounce' ? 'bounced' : 'complained'
  const sendLogMessage =
    reason === 'bounce'
      ? 'Permanent bounce — email address is invalid or rejected'
      : 'Spam complaint — recipient marked email as spam'

  const { error: insertError } = await supabase
    .from('email_send_log')
    .insert({
      message_id: messageId,
      template_name: 'system',
      recipient_email: recipientEmail,
      status: sendLogStatus,
      error_message: sendLogMessage,
      metadata,
    })

  if (insertError) {
    console.warn('Failed to insert email_send_log', { error: insertError })
  }

  console.log('Suppression processed', {
    email_redacted: recipientEmail[0] + '***@' + recipientEmail.split('@')[1],
    reason,
    event_type: event.type,
    resend_email_id: event.data.email_id,
  })

  return jsonResponse({ success: true })
})
