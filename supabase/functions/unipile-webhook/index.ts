// Deno.serve used directly
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";
import { resolveUnipileCredentials } from "../_shared/resolve-org-credentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, unipile-auth, x-unipile-signature',
};

const WEBHOOK_SECRET = Deno.env.get('UNIPILE_WEBHOOK_SECRET');
if (!WEBHOOK_SECRET) console.warn('[unipile-webhook] ⚠️ UNIPILE_WEBHOOK_SECRET not set — webhook auth is DISABLED, all requests will be accepted');

// Timeout wrapper for all external fetch calls (Unipile, Anthropic, Notion)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Sanitize IDs before interpolating into PostgREST filter strings (.or(), .like())
// Prevents filter injection via special characters (commas, dots, parens)
function sanitizeFilterId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-:]/g, '');
}

// Resolve Unipile credentials for the org that owns the given Unipile account_id.
// Falls back to global env vars if no per-org credentials are found.
async function resolveCredsForAccount(accountId: string, supabase: SupabaseClient): Promise<{ apiKey: string; dsn: string }> {
  const envApiKey = Deno.env.get('UNIPILE_API_KEY') || '';
  const rawDsn = (Deno.env.get('UNIPILE_DSN') || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const envDsn = `https://${rawDsn}`;
  const fallback = { apiKey: envApiKey, dsn: envDsn };

  if (!accountId) return fallback;

  try {
    const { data: account } = await supabase
      .from('member_linkedin_accounts')
      .select('organization_id')
      .eq('linkedin_account_id', accountId)
      .maybeSingle();

    if (!account?.organization_id) return fallback;

    const creds = await resolveUnipileCredentials(account.organization_id, supabase);
    if (creds) {
      return { apiKey: creds.apiKey, dsn: creds.dsn };
    }
  } catch (e) {
    console.warn('[unipile-webhook] Org credential resolution failed, using env:', e);
  }
  return fallback;
}


interface WebhookPayload {
  event: string;
  account_id: string;
  data?: Record<string, unknown>;
  // hosted_auth flow : le `name` qu'on passe à /hosted/accounts/link revient ici.
  // On encode "user:{uuid}|org:{uuid}[|reconnect:{acc}]" pour tracer qui a initié
  // la connexion et faire un upsert correct dans member_linkedin_accounts.
  name?: string;
  // account_connected / account_status_updated : le status Unipile courant
  status?: string;
  // new_relation format (flat)
  user_provider_id?: string;
  user_full_name?: string;
  user_public_identifier?: string;
  user_profile_url?: string;
  // message_received format (flat structure)
  chat_id?: string;
  sender?: { attendee_id?: string; attendee_provider_id?: string; attendee_name?: string; attendee_profile_url?: string };
  attendees?: Array<{ attendee_provider_id?: string; attendee_name?: string; attendee_profile_url?: string }>;
  // mail_received format (per Unipile docs, source='email')
  // Champs effectifs : email_id, account_id, event, webhook_name, date,
  // from_attendee, to_attendees, bcc_attendees, cc_attendees, reply_to_attendees,
  // provider_id, message_id, has_attachments, subject, body, body_plain,
  // attachments, folders, role, read_date, is_complete, in_reply_to,
  // tracking_id, origin
  email_id?: string;
  message_id?: string;
  provider_id?: string;
  subject?: string;
  body?: string;
  body_plain?: string;
  /** Per docs : object { message_id, id }. Garde any pour souplesse. */
  in_reply_to?: { message_id?: string; id?: string } | string;
  has_attachments?: boolean;
  is_complete?: boolean;
  from_attendee?: { display_name?: string; identifier?: string };
  to_attendees?: Array<{ display_name?: string; identifier?: string }>;
  cc_attendees?: Array<{ display_name?: string; identifier?: string }>;
  bcc_attendees?: Array<{ display_name?: string; identifier?: string }>;
  date?: string;
  // account_status webhook : payload peut arriver wrappé en AccountStatus
  AccountStatus?: { account_id?: string; account_type?: string; message?: string };
}

/**
 * Parse le `name` passé par hosted_auth pour extraire user_id + org_id + reconnect hint.
 * Format attendu : "user:{uuid}|org:{uuid}[|reconnect:{account_id}]"
 * Retourne null si format inconnu (flow legacy avec org_name brut).
 */
function parseHostedAuthState(name: string | undefined): {
  userId: string;
  organizationId: string;
  reconnectAccountId: string | null;
} | null {
  if (!name || typeof name !== 'string') return null;
  const parts = name.split('|');
  const map: Record<string, string> = {};
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      const k = part.slice(0, colonIdx).trim();
      const v = part.slice(colonIdx + 1).trim();
      if (k && v) map[k] = v;
    }
  }
  if (!map.user || !map.org) return null;
  return {
    userId: map.user,
    organizationId: map.org,
    reconnectAccountId: map.reconnect || null,
  };
}

interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  profile_id: string;
  account_id: string;
  status: string;
  connection_status: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify webhook authenticity
    const authHeader = req.headers.get('unipile-auth');
    if (!WEBHOOK_SECRET) {
      console.error('[unipile-webhook] ⚠️ UNIPILE_WEBHOOK_SECRET not set — rejecting request. Configure this secret!');
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!authHeader || authHeader !== WEBHOOK_SECRET) {
      console.error('[unipile-webhook] Invalid or missing auth header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload: WebhookPayload = await req.json();
    // Conformité LinkedIn (warning #260513-007211) : ne JAMAIS logger le payload
    // brut — il peut contenir du contenu de messages, PII destinataires, et
    // potentiellement des identifiants de session. On loggue uniquement les
    // métadonnées structurelles de l'event.
    console.log('[unipile-webhook] event:', payload.event,
      'account:', payload.account_id,
      'chat:', (payload as any).chat_id ?? null,
      'msg:', (payload as any).message_id ?? null,
      'profile:', (payload as any).user_provider_id ?? null);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ─── Idempotency : dédoublonne les retries Unipile (5× selon doc) ──────
    // Construit un event_key stable par event. Ordre de préférence :
    // 1. message_id / email_id pour les events de message
    // 2. account_id + event + timestamp pour les status changes
    // 3. SHA simplifié du payload sinon
    const eventIdRaw =
      (payload as any).message_id
      || (payload as any).email_id
      || ((payload as any).AccountStatus
          ? `${(payload as any).AccountStatus.account_id}:${(payload as any).AccountStatus.message}:${Math.floor(Date.now() / 60000)}`
          : null)
      || `${payload.account_id || 'no-acc'}:${payload.event}:${(payload as any).chat_id || ''}:${(payload as any).user_provider_id || ''}:${Math.floor(Date.now() / 60000)}`;
    const eventKey = `unipile:${payload.event}:${eventIdRaw}`.slice(0, 500);

    try {
      const { data: isNew } = await supabase.rpc('record_webhook_event', {
        p_event_key: eventKey,
        p_provider: 'unipile',
        p_event_type: payload.event,
        p_account_id: payload.account_id || null,
      });
      if (isNew === false) {
        console.log('[unipile-webhook] Duplicate event ignored:', eventKey);
        return new Response(JSON.stringify({ ok: true, deduplicated: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch (e) {
      // Si la dédup échoue (table absente, RPC indisponible), on continue
      // pour pas bloquer la prod. Les doublons restent possibles mais l'event
      // sera traité au moins une fois.
      console.warn('[unipile-webhook] Dedup check failed (non-blocking):', e);
    }

    // Resolve per-org Unipile credentials based on the account_id in the webhook payload
    const uCreds = await resolveCredsForAccount(payload.account_id || '', supabase);

    switch (payload.event) {
      case 'new_relation': {
        // A connection request was accepted
        await handleNewRelation(supabase, payload);
        break;
      }

      case 'new_message':
      case 'message_received': {
        // A new message was received
        await handleNewMessage(supabase, payload, uCreds);
        break;
      }

      case 'mail_received':
      case 'mail.received':
      case 'new_email': {
        // Un email a été reçu sur un compte connecté → vérifier si c'est une
        // réponse à une étape de séquence email pour stopper les suivantes.
        await handleNewMail(supabase, payload);
        break;
      }
      
      case 'account_connected': {
        console.log('[unipile-webhook] Account connected:', payload.account_id, 'name:', payload.name);

        // Parse le state encodé dans `name` par hosted_auth (user + org)
        const hostedState = parseHostedAuthState(payload.name);

        if (hostedState) {
          // Flow hosted_auth moderne : UPSERT avec user_id + org_id pour garantir
          // le mapping même si la row n'existait pas (cas après "Dissocier").
          // C'est le FIX du dead-end où un nouveau compte Unipile était créé
          // mais jamais lié à un user -> invisible dans Settings.
          try {
            await supabase
              .from('member_linkedin_accounts')
              .upsert({
                user_id: hostedState.userId,
                organization_id: hostedState.organizationId,
                linkedin_account_id: payload.account_id,
                linkedin_account_name: (payload.data as any)?.name || 'Compte LinkedIn',
                account_status: 'OK',
                last_checked_at: new Date().toISOString(),
                failure_reason: null,
              }, {
                onConflict: 'user_id,organization_id',
              });
            console.log('[unipile-webhook] Upserted via hosted_auth for user', hostedState.userId, 'org', hostedState.organizationId);
          } catch (e) {
            console.error('[unipile-webhook] Upsert via hosted_auth failed:', e);
          }
        } else {
          // Fallback legacy : simple UPDATE sur linkedin_account_id (ancien comportement)
          try {
            await supabase
              .from('member_linkedin_accounts')
              .update({ account_status: 'OK', last_checked_at: new Date().toISOString(), failure_reason: null })
              .eq('linkedin_account_id', payload.account_id);
          } catch (e) {
            console.warn('[unipile-webhook] Could not update account status (legacy flow):', e);
          }
        }
        break;
      }

      // Webhook Unipile « account_status_updated » : tient compte de toutes les
      // transitions de statut (OK, CONNECTING, CREDENTIALS, ERROR, SYNC_SUCCESS,
      // RECONNECTED, CREATION_SUCCESS, DELETED). Manquait avant — on ratait les
      // transitions intermédiaires en prod.
      // Per Unipile docs (account-lifecycle), payload may be wrapped as
      // { AccountStatus: { account_id, account_type, message: 'CREDENTIALS' } }
      // ou flat avec payload.status. On gère les deux formats.
      case 'account_status_updated':
      case 'account.status_updated': {
        const newStatus =
          payload.status
          || (payload.data as any)?.status
          || (payload as any)?.AccountStatus?.message
          || 'UNKNOWN';
        const accId = payload.account_id || (payload as any)?.AccountStatus?.account_id;
        console.log('[unipile-webhook] Status updated:', accId, '->', newStatus);
        try {
          // Normaliser les status Unipile pour simplifier la lecture frontend.
          // OK et RECONNECTED et SYNC_SUCCESS sont tous "compte fonctionnel".
          const normalizedStatus =
            newStatus === 'RECONNECTED' || newStatus === 'SYNC_SUCCESS' || newStatus === 'CREATION_SUCCESS'
              ? 'OK'
              : newStatus;
          if (accId) {
            await supabase
              .from('member_linkedin_accounts')
              .update({
                account_status: normalizedStatus,
                last_checked_at: new Date().toISOString(),
                // Si on repasse OK, on efface la raison d'échec précédente
                ...(normalizedStatus === 'OK' ? { failure_reason: null } : {}),
              })
              .eq('linkedin_account_id', accId);
          }
        } catch (e) {
          console.warn('[unipile-webhook] status_updated handler failed:', e);
        }
        break;
      }

      case 'account_disconnected':
      case 'account_error': {
        const reason = payload.event === 'account_disconnected' ? 'disconnected' : 'error';
        // Conformité LinkedIn : extraire UNIQUEMENT le message d'erreur lisible
        // (pas tout le payload.data qui peut contenir des cookies/tokens).
        const rawData = (payload.data as Record<string, unknown> | undefined) || {};
        const reasonText = (
          (typeof rawData.reason === 'string' && rawData.reason)
          || (typeof rawData.message === 'string' && rawData.message)
          || (typeof rawData.error === 'string' && rawData.error)
          || reason
        ).toString().slice(0, 500);
        console.warn(`[unipile-webhook] Account ${reason}:`, payload.account_id, 'reason:', reasonText);

        // Update status in member_linkedin_accounts
        try {
          await supabase
            .from('member_linkedin_accounts')
            .update({
              account_status: reason === 'disconnected' ? 'CREDENTIALS' : 'ERROR',
              last_checked_at: new Date().toISOString(),
              failure_reason: reasonText,
            })
            .eq('linkedin_account_id', payload.account_id);
        } catch (e) {
          console.warn('[unipile-webhook] Could not update account status:', e);
        }

        // Find users linked to this account and create notifications
        try {
          const { data: linkedUsers } = await supabase
            .from('member_linkedin_accounts')
            .select('user_id, organization_id, linkedin_account_name')
            .eq('linkedin_account_id', payload.account_id);

          if (linkedUsers && linkedUsers.length > 0) {
            const notifications = linkedUsers.map((u: any) => ({
              user_id: u.user_id,
              organization_id: u.organization_id,
              type: 'linkedin_disconnected',
              title: 'Compte LinkedIn déconnecté',
              message: `Votre compte LinkedIn "${u.linkedin_account_name || 'LinkedIn'}" a été déconnecté. Reconnectez-le dans Paramètres > Mon compte.`,
              read: false,
              metadata: { account_id: payload.account_id, reason, reason_text: reasonText },
            }));

            const { error: notifError } = await supabase.from('notifications').insert(notifications);
            if (notifError) console.warn('[unipile-webhook] Could not create notifications (table may not exist):', notifError);
          }
        } catch (e) {
          console.warn('[unipile-webhook] Error creating disconnect notifications:', e);
        }
        break;
      }
      
      default:
        console.log('[unipile-webhook] Unknown event type:', payload.event);
    }

    // Must respond with 200 within 30 seconds
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[unipile-webhook] Error:', error);
    // Still return 200 to prevent retries for parsing errors
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleNewRelation(supabase: SupabaseClient, payload: WebhookPayload) {
  const { account_id } = payload;
  
  // Unipile sends flat payload: user_provider_id, user_full_name, user_public_identifier
  // Also support legacy nested format: data.user.provider_id
  const profileId = payload.user_provider_id 
    || (payload.data?.user as { provider_id?: string; id?: string } | undefined)?.provider_id 
    || (payload.data?.user as { provider_id?: string; id?: string } | undefined)?.id;
  
  const userName = payload.user_full_name || '';
  const publicIdentifier = payload.user_public_identifier || '';
  
  if (!profileId) {
    // Conformité LinkedIn : ne pas logger le payload brut (PII possibles)
    console.log('[unipile-webhook] new_relation: No profile ID (event:', payload.event, 'account:', payload.account_id, ')');
    return;
  }

  console.log(`[unipile-webhook] new_relation: Profile connected: ${profileId} (${userName}, slug: ${publicIdentifier})`);

  // Find enrollments waiting for this connection
  // Match on profile_id OR resolved_profile_id to handle Recruiter IDs (AEM -> ACo)
  const { data: enrollments, error: enrollError } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('account_id', account_id)
    .eq('status', 'active')
    .in('connection_status', ['pending_invite', 'unknown', 'not_connected'])
    .or(`profile_id.eq.${sanitizeFilterId(profileId)},resolved_profile_id.eq.${sanitizeFilterId(profileId)},provider_id.eq.${sanitizeFilterId(profileId)}`);

  if (enrollError) {
    console.error('[unipile-webhook] Error fetching enrollments:', enrollError);
    return;
  }

  if (!enrollments || enrollments.length === 0) {
    console.log('[unipile-webhook] No active enrollments found for this connection');
    return;
  }

  console.log(`[unipile-webhook] Found ${enrollments.length} enrollments to update`);

  for (const enrollment of enrollments) {
    // Update connection status + network_distance to connected
    const { error: updateError } = await supabase
      .from('sequence_enrollments')
      .update({
        connection_status: 'connected',
        network_distance: 'FIRST_DEGREE',
        last_check_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id);

    if (updateError) {
      console.error('[unipile-webhook] Error updating enrollment:', updateError);
      continue;
    }

    // CRITICAL: Resolve the pending wait_connection step execution
    // Find the wait_connection step for this enrollment that is waiting
    const { data: waitSteps } = await supabase
      .from('sequence_step_executions')
      .select('id, step_id, step_order')
      .eq('enrollment_id', enrollment.id)
      .in('status', ['waiting_event', 'scheduled'])
      .order('step_order', { ascending: true })
      .limit(1);

    if (waitSteps && waitSteps.length > 0) {
      const waitStep = waitSteps[0];
      // Verify this is indeed a wait_connection step
      const { data: stepDef } = await supabase
        .from('sequence_steps')
        .select('action_type, if_true_goto_step')
        .eq('id', waitStep.step_id)
        .single();

      if (stepDef?.action_type === 'wait_connection') {
        // Mark as sent (connection accepted)
        await supabase
          .from('sequence_step_executions')
          .update({
            status: 'sent',
            executed_at: new Date().toISOString(),
          })
          .eq('id', waitStep.id);

        // Determine next step (if_true_goto_step = connection accepted path)
        const nextStepId = stepDef.if_true_goto_step;
        if (nextStepId) {
          // Get the next step details to schedule it
          const { data: nextStep } = await supabase
            .from('sequence_steps')
            .select('*')
            .eq('id', nextStepId)
            .single();

          if (nextStep) {
            // Schedule next step with appropriate delay
            const delayMs = ((nextStep.delay_days || 0) * 86400 + (nextStep.delay_hours || 0) * 3600 + (nextStep.delay_minutes || 0) * 60) * 1000;
            const scheduledAt = new Date(Date.now() + delayMs);
            
            // Check for duplicates first
            const { data: existing } = await supabase
              .from('sequence_step_executions')
              .select('id')
              .eq('enrollment_id', enrollment.id)
              .eq('step_id', nextStepId)
              .in('status', ['scheduled', 'sent', 'waiting_event'])
              .limit(1);

            if (!existing || existing.length === 0) {
              await supabase
                .from('sequence_step_executions')
                .insert({
                  enrollment_id: enrollment.id,
                  step_id: nextStepId,
                  step_order: nextStep.step_order,
                  status: 'scheduled',
                  scheduled_at: scheduledAt.toISOString(),
                });

              // Update enrollment current step
              await supabase
                .from('sequence_enrollments')
                .update({ current_step_order: nextStep.step_order })
                .eq('id', enrollment.id);

              console.log(`[unipile-webhook] Scheduled next step ${nextStep.action_type} (order ${nextStep.step_order}) for enrollment ${enrollment.id}`);
            }
          }
        }

        console.log(`[unipile-webhook] Resolved wait_connection step for enrollment ${enrollment.id}`);
      }
    }

    // Log analytics — RPC d'incrément atomique (l'ancien upsert REMETTAIT le
    // compteur à 1 à partir du 2e événement du jour, faussant toutes les stats)
    await supabase.rpc('increment_sequence_analytics', {
      p_sequence_id: enrollment.sequence_id,
      p_field: 'invites_accepted',
    });

    console.log('[unipile-webhook] Updated enrollment:', enrollment.id, 'to connected');
  }
}

async function handleNewMessage(supabase: SupabaseClient, payload: WebhookPayload, uCreds: { apiKey: string; dsn: string }) {
  const { account_id, data } = payload;
  
  // Handle two payload formats:
  // 1. new_message: { data: { message: {...}, chat: {...} } }
  // 2. message_received: { chat_id, sender: {...}, attendees: [...] } (flat, no data)
  
  let chatId: string | undefined;
  let senderId: string | undefined;
  let isSenderSelf: boolean | undefined;
  let senderAttendeeId: string | undefined;
  let needsAttendeeVerification = false;

  if (payload.sender && payload.chat_id) {
    // message_received format (flat)
    console.log('[unipile-webhook] Processing message_received format');
    chatId = payload.chat_id;
    senderId = payload.sender.attendee_provider_id;
    senderAttendeeId = payload.sender.attendee_id;
    // NB: do NOT assume the sender is the other person. Unipile fires
    // message_received for the invitation note WE sent once the chat
    // materialises after acceptance — sender_attendee_id can collapse to our
    // own attendee. Force attendees-API verification below; otherwise we mark
    // candidates as "replied" for our own outbound invite note (bug:
    // candidates showing in "Répondu" without replying).
    isSenderSelf = undefined;
    needsAttendeeVerification = true;
  } else if (data) {
    // new_message format (nested)
    console.log('[unipile-webhook] Processing new_message format');
    const message = data.message as { 
      sender_id?: string; 
      attendee_provider_id?: string;
      sender?: { provider_id?: string; id?: string };
      is_sender?: boolean;
      is_sender_self?: boolean;
      sender_attendee_id?: string;
      chat_id?: string;
    } | undefined;
    
    const chat = data.chat as { id?: string } | undefined;
    chatId = message?.chat_id || chat?.id;
    senderId = message?.sender?.provider_id || message?.sender?.id || message?.sender_id || message?.attendee_provider_id;
    isSenderSelf = message?.is_sender === true || message?.is_sender_self === true ? true : 
                   message?.is_sender === false || message?.is_sender_self === false ? false : undefined;
    senderAttendeeId = message?.sender_attendee_id;
  } else {
    console.log('[unipile-webhook] handleNewMessage: Unrecognized payload format, keys:', Object.keys(payload));
    return;
  }
  
  // Skip if this is a message WE sent
  if (isSenderSelf === true) {
    console.log('[unipile-webhook] Skipping - this is our own sent message');
    return;
  }
  
  // For ambiguous cases (is_sender undefined), resolve via chat attendees API.
  // For message_received payloads we fail-closed: if we cannot positively
  // confirm the sender is NOT our own attendee, skip — better to miss a reply
  // than to mark a candidate "Répondu" for our own outbound invitation note.
  if (isSenderSelf === undefined && chatId && senderAttendeeId) {
    let confirmedNotSelf = false;
    try {
      const attRes = await fetchWithTimeout(`${uCreds.dsn}/api/v1/chats/${chatId}/attendees`, { headers: { 'X-API-KEY': uCreds.apiKey } });
      if (attRes.ok) {
        const attData = await attRes.json();
        const attendees = attData.items || attData || [];
        const attendeeList = Array.isArray(attendees) ? attendees : [];
        // deno-lint-ignore no-explicit-any
        const ownAttendee = attendeeList.find((a: any) => a.is_self === true || a.is_self === 1 || a.role === 'self');
        if (ownAttendee) {
          const ownIds = [ownAttendee.id, ownAttendee.provider_id, ownAttendee.attendee_id].filter(Boolean);
          if (ownIds.includes(senderAttendeeId)) {
            console.log('[unipile-webhook] Skipping - sender is our own attendee');
            return;
          }
          confirmedNotSelf = true;
        }
      } else {
        await attRes.text(); // consume body
      }
    } catch (e) {
      console.warn('[unipile-webhook] Failed to verify sender via attendees:', e);
    }
    if (needsAttendeeVerification && !confirmedNotSelf) {
      console.log('[unipile-webhook] Skipping - cannot confirm sender is not self (fail-closed for message_received)');
      return;
    }
  } else if (needsAttendeeVerification) {
    // message_received without chat_id or sender.attendee_id → cannot verify
    console.log('[unipile-webhook] Skipping - message_received missing fields needed to verify sender');
    return;
  }
  
  if (!senderId) {
    console.log('[unipile-webhook] No sender ID found in payload');
    return;
  }

  console.log('[unipile-webhook] Message from:', senderId, '| Chat:', chatId, '| Account:', account_id);

  // Find active enrollments - try exact match first, then partial match for ID format variations
  // LinkedIn IDs can come in different formats: "AEMAABl08fo...", "ACo...", "urn:li:member:..."
  let enrollments: SequenceEnrollment[] = [];
  
  // Try exact match first (profile_id or resolved_profile_id)
  const { data: exactMatch, error: exactError } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('account_id', account_id)
    .eq('status', 'active')
    .or(`profile_id.eq.${sanitizeFilterId(senderId)},resolved_profile_id.eq.${sanitizeFilterId(senderId)}`);

  if (exactError) {
    console.error('[unipile-webhook] Error fetching enrollments (exact):', exactError);
    return;
  }

  if (exactMatch && exactMatch.length > 0) {
    enrollments = exactMatch as SequenceEnrollment[];
  } else {
    // Try matching by profile URL containing the sender ID (for cases where format differs)
    const { data: urlMatch, error: urlError } = await supabase
      .from('sequence_enrollments')
      .select('*')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .like('profile_url', `%${sanitizeFilterId(senderId)}%`);

    if (!urlError && urlMatch && urlMatch.length > 0) {
      enrollments = urlMatch as SequenceEnrollment[];
      console.log('[unipile-webhook] Matched via profile_url fallback');
    }
  }

  if (enrollments.length === 0) {
    console.log('[unipile-webhook] No active enrollments found for sender:', senderId);
  } else {
    // Extra validation: log the matched profiles to help debug false positives
    console.log(`[unipile-webhook] Found ${enrollments.length} enrollment(s) - marking as replied:`, 
      enrollments.map(e => ({ id: e.id, profile_id: e.profile_id })));

    for (const enrollment of enrollments) {
      // Mark as replied and pause the sequence
      const { error: updateError } = await supabase
        .from('sequence_enrollments')
        .update({
          status: 'replied',
          replied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', enrollment.id);

      if (updateError) {
        console.error('[unipile-webhook] Error updating enrollment:', updateError);
        continue;
      }

      // Cancel any pending step executions
      await supabase
        .from('sequence_step_executions')
        .update({
          status: 'cancelled',
          skip_reason: 'Reply detected via webhook',
          updated_at: new Date().toISOString(),
        })
        .eq('enrollment_id', enrollment.id)
        .eq('status', 'scheduled');

      // Log analytics — incrément atomique (cf. increment_sequence_analytics)
      await supabase.rpc('increment_sequence_analytics', {
        p_sequence_id: enrollment.sequence_id,
        p_field: 'replies_received',
      });

      console.log('[unipile-webhook] Enrollment', enrollment.id, 'marked as replied');

      // Update job_candidate_status to 'replied' and sync pipeline_stage
      const { data: jcsRows } = await supabase
        .from('job_candidate_status')
        .select('id, pipeline_stage')
        .eq('candidate_id', enrollment.profile_id)
        .in('status', ['contacted', 'shortlisted', 'scored', 'new', 'messaged', 'discovered', 'untreated']);
      if (jcsRows && jcsRows.length > 0) {
        for (const row of jcsRows) {
          const shouldUpdatePipeline = !row.pipeline_stage || 
            row.pipeline_stage === 'Nouveau' || 
            row.pipeline_stage === 'Contacté';
          await supabase
            .from('job_candidate_status')
            .update({ 
              status: 'replied', 
              ...(shouldUpdatePipeline ? { pipeline_stage: 'Répondu' } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
        }
        console.log(`[unipile-webhook] Updated ${jcsRows.length} job_candidate_status → replied`);
      }
    }
  }

  // Also update inmail_queue entries for this sender (for ATS tracking)
  // Try exact match first, then resolve AEM↔ACo ID mismatch
  let inmailMatches: { id: string; recipient_profile_id: string }[] | null = null;
  
  const { data: exactInmailMatch } = await supabase
    .from('inmail_queue')
    .select('id, recipient_profile_id')
    .eq('status', 'sent')
    .eq('recipient_profile_id', senderId);

  inmailMatches = exactInmailMatch;

  // If no exact match, try resolving the sender's alternative ID via Unipile
  // InMails are sent to AEM... IDs but replies come from ACo... IDs (or vice versa)
  if ((!inmailMatches || inmailMatches.length === 0) && senderId) {
    try {
      // Resolve the sender's profile to get alternative IDs
      const userRes = await fetchWithTimeout(`${uCreds.dsn}/api/v1/users/${senderId}`, {
        headers: { 'X-API-KEY': uCreds.apiKey },
      });
      
      if (userRes.ok) {
        const userData = await userRes.json();
        // Collect all possible IDs: provider_id, id, public_identifier
        const altIds = new Set<string>();
        if (userData.provider_id && userData.provider_id !== senderId) altIds.add(userData.provider_id);
        if (userData.id && userData.id !== senderId) altIds.add(userData.id);
        // Also check nested profile if present
        if (userData.profile?.provider_id && userData.profile.provider_id !== senderId) altIds.add(userData.profile.provider_id);
        
        if (altIds.size > 0) {
          const altIdArray = [...altIds];
          console.log(`[unipile-webhook] Resolved sender ${senderId} → alt IDs:`, altIdArray);
          
          const { data: altMatch } = await supabase
            .from('inmail_queue')
            .select('id, recipient_profile_id')
            .eq('status', 'sent')
            .in('recipient_profile_id', altIdArray);
          
          if (altMatch && altMatch.length > 0) {
            inmailMatches = altMatch;
            console.log(`[unipile-webhook] InMail matched via resolved ID for ${altMatch.length} entries`);
          }
        }
      } else {
        await userRes.text(); // consume body
      }
    } catch (e) {
      console.warn('[unipile-webhook] Failed to resolve sender for inmail matching:', e);
    }
  }

  if (inmailMatches && inmailMatches.length > 0) {
    console.log(`[unipile-webhook] Marking ${inmailMatches.length} inmail_queue entries as replied`);
    const inmailIds = inmailMatches.map(m => m.id);
    await supabase
      .from('inmail_queue')
      .update({
        status: 'replied',
        updated_at: new Date().toISOString(),
      })
      .in('id', inmailIds);
  }

  // ── Create notification for new message ──
  // Find the user(s) linked to this LinkedIn account
  const senderName = payload.sender?.attendee_name 
    || (data?.message as any)?.sender?.name 
    || senderId || 'Quelqu\'un';

  const { data: linkedMembers } = await supabase
    .from('member_linkedin_accounts')
    .select('user_id, organization_id')
    .eq('linkedin_account_id', account_id);

  if (linkedMembers && linkedMembers.length > 0) {
    for (const member of linkedMembers) {
      await supabase
        .from('notifications')
        .insert({
          user_id: member.user_id,
          organization_id: member.organization_id,
          type: 'new_message',
          title: `Nouveau message de ${senderName}`,
          body: chatId ? `Vous avez reçu un nouveau message LinkedIn` : null,
          link: `/outreach?tab=messages${chatId ? `&chatId=${chatId}` : ''}`,
        });
    }
    console.log(`[unipile-webhook] Created notifications for ${linkedMembers.length} user(s)`);
  } else {
    // Fallback: notify all org members who have access
    // Find org via any member_linkedin_accounts with this account
    const { data: anyMapping } = await supabase
      .from('member_linkedin_accounts')
      .select('organization_id')
      .eq('linkedin_account_id', account_id)
      .limit(1);
    
    if (!anyMapping || anyMapping.length === 0) {
      // Last resort: find org members from organization_members and notify admins/owners
      console.log('[unipile-webhook] No member mapping found for account:', account_id);
    }
  }

  // ── Trigger auto-analysis for intent detection & status update ──
  if (chatId) {
    console.log(`[unipile-webhook] Triggering auto-analyze for chat: ${chatId}`);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Fire-and-forget: don't await to keep webhook fast
    fetchWithTimeout(`${supabaseUrl}/functions/v1/auto-analyze-message`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        account_id: account_id,
        sender_id: senderId,
      }),
    }).then(res => {
      console.log(`[unipile-webhook] Auto-analyze triggered: ${res.status}`);
    }).catch(err => {
      console.error('[unipile-webhook] Auto-analyze trigger failed:', err);
    });
  }

  // ── Fire-and-forget RAG ingestion (conversation message) ──
  if (senderId && chatId) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const orgId = linkedMembers?.[0]?.organization_id;
    if (supabaseUrl && serviceKey && orgId) {
      const senderName = payload.sender?.attendee_name
        || (data?.message as any)?.sender?.name
        || senderId;
      await fetchWithTimeout(`${supabaseUrl}/functions/v1/ingest-context`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: orgId,
          entity_type: 'candidate',
          entity_id: senderId,
          chunks: [{
            chunk_type: 'conversation',
            content: `Message reçu de ${senderName} (chat ${chatId})`,
            source_table: 'unipile_conversations',
            metadata: { chat_id: chatId, account_id: account_id, date: new Date().toISOString() },
          }],
        }),
      }).catch(err => console.warn('[unipile-webhook] RAG ingest failed (non-blocking):', err));
    }
  }
}

/**
 * Handler pour les emails reçus (Unipile event `mail_received`).
 * Détecte si l'email entrant est une réponse à une étape de séquence email
 * et stoppe les étapes restantes de la séquence pour ce candidat.
 *
 * Stratégie de matching :
 *   1. Récupère l'email expéditeur (from_attendee.identifier)
 *   2. Recherche les enrollments actifs avec email_used = sender_email
 *      sur ce account_id
 *   3. Marque comme replied + cancel pending steps + log analytics
 *
 * Sécurité : on filtre par account_id pour ne pas matcher des replies
 * d'autres orgs partageant le même candidat.
 */
async function handleNewMail(supabase: SupabaseClient, payload: WebhookPayload) {
  const { account_id, from_attendee, to_attendees, subject, email_id } = payload;

  if (!account_id) {
    console.log('[unipile-webhook][mail] Missing account_id, skipping');
    return;
  }

  // Email de l'expéditeur (= candidat qui répond)
  // Per Unipile docs, from_attendee est un objet { display_name, identifier }
  // où identifier contient l'adresse email.
  const senderEmail = (from_attendee?.identifier || '').toLowerCase().trim();
  if (!senderEmail) {
    console.log('[unipile-webhook][mail] No sender email, skipping');
    return;
  }

  const subjectLower = (subject || '').toLowerCase();

  // === HARD BOUNCE ===
  // Un NDR (mailer-daemon/postmaster, ou sujet type "Undelivered"/"Delivery
  // Status Notification") signale une adresse morte. Avant, on faisait juste
  // `return` → l'enrollment restait 'active' et les étapes email suivantes
  // repartaient vers l'adresse invalide (réputation domaine dégradée) et la
  // condition if_bounced ne matchait jamais. On stoppe l'enrollment + suppress.
  const isBounce =
    senderEmail.startsWith('mailer-daemon@') ||
    senderEmail.startsWith('postmaster@') ||
    /undeliverable|delivery status notification|delivery has failed|mail delivery (failed|subsystem)|returned mail|failure notice|delivery failure|delivery incomplete/i.test(subjectLower);

  if (isBounce) {
    await handleBounce(supabase, account_id, payload, senderEmail);
    return;
  }

  // Skip auto-replies (out-of-office, etc.) — ni réponse ni bounce.
  const isAutoReply = subjectLower.includes('auto-reply') ||
    subjectLower.includes('out of office') ||
    subjectLower.includes('absence du bureau') ||
    subjectLower.includes('réponse automatique') ||
    senderEmail.startsWith('no-reply@') ||
    senderEmail.startsWith('noreply@');

  if (isAutoReply) {
    console.log('[unipile-webhook][mail] Skipping auto-reply from', senderEmail);
    return;
  }

  // Skip si c'est un email QU'ON A ENVOYÉ (cas Unipile inclut sent in webhook)
  // Vérifier que le sender ne match pas l'identifier du compte connecté
  const recipientEmails = (to_attendees || [])
    .map(a => (a.identifier || '').toLowerCase().trim())
    .filter(Boolean);
  if (recipientEmails.length === 0) {
    console.log('[unipile-webhook][mail] No recipients, skipping');
    return;
  }

  console.log(
    `[unipile-webhook][mail] from=${senderEmail} to=${recipientEmails.join(',')} ` +
    `account=${account_id} email_id=${email_id || '?'} subject="${subjectLower.slice(0, 80)}"`,
  );

  // 1. Récupérer les enrollments actifs avec email_used = senderEmail sur ce account_id
  const { data: enrollments, error: enrErr } = await supabase
    .from('sequence_enrollments')
    .select('id, sequence_id, profile_id, account_id, email_used')
    .eq('account_id', account_id)
    .eq('status', 'active')
    .ilike('email_used', senderEmail);

  if (enrErr) {
    console.error('[unipile-webhook][mail] Error fetching enrollments:', enrErr);
    return;
  }

  if (!enrollments || enrollments.length === 0) {
    console.log('[unipile-webhook][mail] No active enrollment matched for', senderEmail);
    return;
  }

  console.log(`[unipile-webhook][mail] Matched ${enrollments.length} enrollment(s)`);

  // 2. Marquer chaque enrollment comme replied + canceller les étapes pending
  for (const enrollment of enrollments) {
    const { error: updErr } = await supabase
      .from('sequence_enrollments')
      .update({
        status: 'replied',
        replied_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id);

    if (updErr) {
      console.error('[unipile-webhook][mail] Error updating enrollment:', updErr);
      continue;
    }

    await supabase
      .from('sequence_step_executions')
      .update({
        status: 'cancelled',
        skip_reason: 'Email reply detected via webhook',
        updated_at: new Date().toISOString(),
      })
      .eq('enrollment_id', enrollment.id)
      .eq('status', 'scheduled');

    // Incrément atomique (cf. increment_sequence_analytics)
    await supabase.rpc('increment_sequence_analytics', {
      p_sequence_id: enrollment.sequence_id,
      p_field: 'replies_received',
    });

    // Update job_candidate_status si on a un profile_id
    if (enrollment.profile_id) {
      const { data: jcsRows } = await supabase
        .from('job_candidate_status')
        .select('id, pipeline_stage')
        .eq('candidate_id', enrollment.profile_id)
        .in('status', ['contacted', 'shortlisted', 'scored', 'new', 'messaged', 'discovered', 'untreated']);
      if (jcsRows && jcsRows.length > 0) {
        for (const row of jcsRows) {
          const shouldUpdatePipeline = !row.pipeline_stage ||
            row.pipeline_stage === 'Nouveau' ||
            row.pipeline_stage === 'Contacté';
          await supabase
            .from('job_candidate_status')
            .update({
              status: 'replied',
              ...(shouldUpdatePipeline ? { pipeline_stage: 'Pré-qualif' } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
        }
      }
    }

    console.log('[unipile-webhook][mail] Enrollment', enrollment.id, 'marked replied (email)');
  }
}

/**
 * Traite un NDR (bounce email). L'adresse qui a bouncé n'est PAS l'expéditeur
 * (mailer-daemon), elle est dans le corps du NDR. On l'en extrait, puis — pour
 * chaque adresse qu'on a RÉELLEMENT séquencée depuis ce compte (garde-fou
 * anti faux-positif sur un parsing bruité) — on l'ajoute à suppressed_emails,
 * on passe les enrollments actifs/en pause en 'bounced' et on annule leurs
 * étapes encore en attente.
 */
async function handleBounce(supabase: SupabaseClient, accountId: string, payload: WebhookPayload, senderEmail: string) {
  // PostgREST ilike : '_' et '%' sont des jokers → on les échappe pour un
  // match exact insensible à la casse sur l'adresse.
  const escapeLike = (s: string) => s.replace(/([%_\\])/g, '\\$1');

  const bodyText = `${payload.subject || ''}\n${payload.body_plain || payload.body || ''}`;
  const ourAddresses = new Set(
    (payload.to_attendees || []).map(a => (a.identifier || '').toLowerCase().trim()).filter(Boolean),
  );
  const emailRegex = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
  const found = [...new Set((bodyText.match(emailRegex) || []).map(e => e.toLowerCase().trim()))];
  const candidates = found.filter(e =>
    !ourAddresses.has(e) &&
    e !== senderEmail &&
    !e.startsWith('mailer-daemon@') &&
    !e.startsWith('postmaster@') &&
    !e.startsWith('noreply@') &&
    !e.startsWith('no-reply@'),
  );

  if (candidates.length === 0) {
    console.log('[unipile-webhook][bounce] No candidate address extracted from NDR — skipping', { account: accountId });
    return;
  }

  for (const addr of candidates) {
    // On ne suppress QUE les adresses qu'on a réellement séquencées depuis ce
    // compte — sinon un NDR bruité pourrait blacklister une adresse au hasard.
    const { data: enrs, error: enrErr } = await supabase
      .from('sequence_enrollments')
      .select('id, status')
      .eq('account_id', accountId)
      .ilike('email_used', escapeLike(addr));
    if (enrErr) {
      console.error('[unipile-webhook][bounce] enrollment lookup failed:', enrErr);
      continue;
    }
    if (!enrs || enrs.length === 0) continue;

    // Hard bounce → ne plus jamais emailer cette adresse.
    const { error: supErr } = await supabase
      .from('suppressed_emails')
      .upsert({ email: addr, reason: 'bounce' }, { onConflict: 'email' });
    if (supErr) console.error('[unipile-webhook][bounce] suppress failed:', supErr);

    for (const enr of enrs) {
      if (enr.status === 'active' || enr.status === 'paused') {
        await supabase
          .from('sequence_enrollments')
          .update({ status: 'bounced', updated_at: new Date().toISOString() })
          .eq('id', enr.id);
      }
      // Annuler les étapes encore en attente pour ce candidat.
      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Email bounced (NDR)', updated_at: new Date().toISOString() })
        .eq('enrollment_id', enr.id)
        .in('status', ['scheduled', 'waiting_event', 'quota_blocked']);
    }
    console.log(`[unipile-webhook][bounce] Suppressed ${addr} + bounced ${enrs.length} enrollment(s) on account ${accountId}`);
  }
}
