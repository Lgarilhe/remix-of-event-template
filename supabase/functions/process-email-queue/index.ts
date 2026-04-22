import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_RETRIES = 5
const DEFAULT_BATCH_SIZE = 10
const DEFAULT_SEND_DELAY_MS = 200
const DEFAULT_AUTH_TTL_MINUTES = 15
const DEFAULT_TRANSACTIONAL_TTL_MINUTES = 60

const RESEND_API_URL = 'https://api.resend.com/emails'

// Send an email via Resend API. Returns the Resend email id on success.
// Throws on error; attaches status + retryAfterSeconds for rate-limit handling.
class ResendSendError extends Error {
  status: number
  retryAfterSeconds: number | null
  constructor(status: number, message: string, retryAfterSeconds: number | null) {
    super(message)
    this.name = 'ResendSendError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

async function sendViaResend(
  apiKey: string,
  payload: {
    from: string
    to: string
    subject: string
    html?: string
    text?: string
    idempotency_key?: string
    message_id?: string
    unsubscribe_token?: string
    label?: string
  },
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (payload.idempotency_key) {
    headers['Idempotency-Key'] = payload.idempotency_key
  }

  const customHeaders: Record<string, string> = {}
  if (payload.message_id) {
    customHeaders['X-Entity-Ref-ID'] = payload.message_id
  }
  if (payload.unsubscribe_token) {
    // RFC 8058 one-click unsubscribe
    customHeaders['List-Unsubscribe'] = `<${payload.unsubscribe_token}>`
    customHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }

  const body: Record<string, unknown> = {
    from: payload.from,
    to: [payload.to],
    subject: payload.subject,
  }
  if (payload.html) body.html = payload.html
  if (payload.text) body.text = payload.text
  if (Object.keys(customHeaders).length > 0) body.headers = customHeaders
  if (payload.label) body.tags = [{ name: 'label', value: payload.label.slice(0, 256) }]

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (response.ok) {
    const json = await response.json().catch(() => ({}))
    return (json?.id as string) || ''
  }

  const errorText = await response.text().catch(() => 'Unknown error')
  const retryAfter = response.headers.get('Retry-After')
  const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) || 60 : null
  throw new ResendSendError(response.status, errorText.slice(0, 1000), retryAfterSeconds)
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }

  try {
    const payload = parts[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')

    return JSON.parse(atob(payload)) as Record<string, unknown>
  } catch {
    return null
  }
}

// Move a message to the dead letter queue and log the reason.
// deno-lint-ignore no-explicit-any
async function moveToDlq(
  supabase: any,
  queue: string,
  msg: { msg_id: number; message: Record<string, unknown> },
  reason: string,
): Promise<void> {
  const payload = msg.message
  await supabase.from('email_send_log').insert({
    message_id: payload.message_id,
    template_name: (payload.label || queue) as string,
    recipient_email: payload.to,
    status: 'dlq',
    error_message: reason,
  })
  const { error } = await supabase.rpc('move_to_dlq', {
    source_queue: queue,
    dlq_name: `${queue}_dlq`,
    message_id: msg.msg_id,
    payload,
  })
  if (error) {
    console.error('Failed to move message to DLQ', { queue, msg_id: msg.msg_id, reason, error })
  }
}

Deno.serve(async (req) => {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))

  if (!resendKey || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables (RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // verify_jwt=true in config.toml already validates the JWT at the gateway.
  // Extra role check so only service-role callers trigger queue processing.
  const token = authHeader.slice('Bearer '.length).trim()
  const claims = parseJwtClaims(token)
  if (claims?.role !== 'service_role') {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(supabaseUrl, supabaseServiceKey)

  // 1. Check rate-limit cooldown and read queue config
  const { data: state } = await supabase
    .from('email_send_state')
    .select('retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes')
    .single()

  if (state?.retry_after_until && new Date(state.retry_after_until) > new Date()) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'rate_limited' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  const batchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE
  const sendDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS
  const ttlMinutes: Record<string, number> = {
    auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
    transactional_emails: state?.transactional_email_ttl_minutes ?? DEFAULT_TRANSACTIONAL_TTL_MINUTES,
  }

  let totalProcessed = 0

  // 2. Process auth_emails first (priority), then transactional_emails
  for (const queue of ['auth_emails', 'transactional_emails']) {
    const { data: messages, error: readError } = await supabase.rpc('read_email_batch', {
      queue_name: queue,
      batch_size: batchSize,
      vt: 30,
    })

    if (readError) {
      console.error('Failed to read email batch', { queue, error: readError })
      continue
    }

    if (!messages?.length) continue

    // Retry budget based on real send failures, not pgmq read_ct.
    const messageIds = Array.from(
      new Set(
        messages
          .map((msg: any) =>
            msg?.message?.message_id && typeof msg.message.message_id === 'string'
              ? msg.message.message_id
              : null,
          )
          .filter((id: any): id is string => Boolean(id)),
      ),
    )
    const failedAttemptsByMessageId = new Map<string, number>()
    if (messageIds.length > 0) {
      const { data: failedRows, error: failedRowsError } = await supabase
        .from('email_send_log')
        .select('message_id')
        .in('message_id', messageIds)
        .eq('status', 'failed')

      if (failedRowsError) {
        console.error('Failed to load failed-attempt counters', { queue, error: failedRowsError })
      } else {
        for (const row of failedRows ?? []) {
          const messageId = row?.message_id
          if (typeof messageId !== 'string' || !messageId) continue
          failedAttemptsByMessageId.set(messageId, (failedAttemptsByMessageId.get(messageId) ?? 0) + 1)
        }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const payload = msg.message
      const failedAttempts =
        payload?.message_id && typeof payload.message_id === 'string'
          ? (failedAttemptsByMessageId.get(payload.message_id) ?? 0)
          : 0

      // Drop expired messages (TTL exceeded)
      if (payload.queued_at) {
        const ageMs = Date.now() - new Date(payload.queued_at).getTime()
        const maxAgeMs = ttlMinutes[queue] * 60 * 1000
        if (ageMs > maxAgeMs) {
          console.warn('Email expired (TTL exceeded)', { queue, msg_id: msg.msg_id, queued_at: payload.queued_at, ttl_minutes: ttlMinutes[queue] })
          await moveToDlq(supabase, queue, msg, `TTL exceeded (${ttlMinutes[queue]} minutes)`)
          continue
        }
      }

      // Move to DLQ if max failed send attempts reached.
      if (failedAttempts >= MAX_RETRIES) {
        await moveToDlq(supabase, queue, msg, `Max retries (${MAX_RETRIES}) exceeded (attempted ${failedAttempts} times)`)
        continue
      }

      // Guard: skip if another worker already sent this message (VT expired race)
      if (payload.message_id) {
        const { data: alreadySent } = await supabase
          .from('email_send_log')
          .select('id')
          .eq('message_id', payload.message_id)
          .eq('status', 'sent')
          .maybeSingle()

        if (alreadySent) {
          console.warn('Skipping duplicate send (already sent)', { queue, msg_id: msg.msg_id, message_id: payload.message_id })
          const { error: dupDelError } = await supabase.rpc('delete_email', {
            queue_name: queue,
            message_id: msg.msg_id,
          })
          if (dupDelError) {
            console.error('Failed to delete duplicate message from queue', { queue, msg_id: msg.msg_id, error: dupDelError })
          }
          continue
        }
      }

      try {
        const resendEmailId = await sendViaResend(resendKey, {
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          idempotency_key: payload.idempotency_key,
          message_id: payload.message_id,
          unsubscribe_token: payload.unsubscribe_token,
          label: payload.label,
        })

        // Log success
        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'sent',
          metadata: resendEmailId ? { provider: 'resend', resend_email_id: resendEmailId } : { provider: 'resend' },
        })

        // Delete from queue
        const { error: delError } = await supabase.rpc('delete_email', {
          queue_name: queue,
          message_id: msg.msg_id,
        })
        if (delError) {
          console.error('Failed to delete sent message from queue', { queue, msg_id: msg.msg_id, error: delError })
        }
        totalProcessed++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const status = error instanceof ResendSendError ? error.status : 0
        console.error('Email send failed', { queue, msg_id: msg.msg_id, read_ct: msg.read_ct, failed_attempts: failedAttempts, status, error: errorMsg })

        if (status === 429) {
          await supabase.from('email_send_log').insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: 'rate_limited',
            error_message: errorMsg.slice(0, 1000),
          })

          const retryAfterSecs = error instanceof ResendSendError && error.retryAfterSeconds ? error.retryAfterSeconds : 60
          await supabase
            .from('email_send_state')
            .update({
              retry_after_until: new Date(Date.now() + retryAfterSecs * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', 1)

          return new Response(
            JSON.stringify({ processed: totalProcessed, stopped: 'rate_limited' }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        }

        // 401/403: auth issue — DLQ immediately, retrying won't help.
        if (status === 401 || status === 403) {
          await moveToDlq(supabase, queue, msg, `Resend auth failure (${status}): ${errorMsg.slice(0, 200)}`)
          return new Response(
            JSON.stringify({ processed: totalProcessed, stopped: 'resend_auth_failure' }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        }

        // 422: unprocessable (invalid email, from domain not verified, etc) — DLQ.
        if (status === 422) {
          await moveToDlq(supabase, queue, msg, `Resend validation error: ${errorMsg.slice(0, 200)}`)
          continue
        }

        // Other errors (5xx, network): log and let pgmq retry via VT expiration.
        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'failed',
          error_message: errorMsg.slice(0, 1000),
        })
        if (payload?.message_id && typeof payload.message_id === 'string') {
          failedAttemptsByMessageId.set(payload.message_id, failedAttempts + 1)
        }
      }

      // Small delay between sends to smooth bursts
      if (i < messages.length - 1) {
        await new Promise((r) => setTimeout(r, sendDelayMs))
      }
    }
  }

  return new Response(
    JSON.stringify({ processed: totalProcessed }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
