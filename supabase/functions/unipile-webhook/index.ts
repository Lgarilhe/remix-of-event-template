// Deno.serve used directly
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";
import { resolveUnipileCredentials } from "../_shared/resolve-org-credentials.ts";
import { flattenV2WebhookEnvelope, resolveV2WebhookToken } from "../_shared/unipile-v2.ts";
import { ACCOUNT_DISCONNECTED_PAUSE_REASON, ACCOUNT_DISCONNECTED_SKIP_REASON } from "../_shared/linkedin-quotas.ts";
import { timingSafeEqual } from "../_shared/timing-safe-equal.ts";
import { stopLinkedInAccountSending } from "../_shared/linkedin-sending-stop.ts";
import { resumeDate } from "../_shared/sequence-resume.ts";
import { inReplyToCandidates } from "../_shared/sequence-email-policy.mjs";
import {
  cancelScheduledInMails,
  candidateSlugs,
  closeSiblingEnrollments,
  closedContactEnd,
  lateReplyEnrollments,
  linkedInSlugOf,
  replySiblingScope,
  type ReplyAnchor,
} from "../_shared/candidate-reply-closure.ts";
import { candidateRef, recordInbound, recordOwnMessage, type CandidateRef } from "../_shared/candidate-stage-events.ts";
import { isCandidateErasedForOrg } from "../_shared/get-or-fetch-contact.ts";
import { captureCandidateActionIncoming } from "../_shared/candidate-actions/incoming.ts";
import { candidateActionPhone } from "../_shared/candidate-actions/transport.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, unipile-auth, x-unipile-signature',
};

const WEBHOOK_SECRET = Deno.env.get('UNIPILE_WEBHOOK_SECRET');
/** webhook_event_log.event_type d'une clé dont le traitement a échoué et que la purge n'a pas pu retirer. */
const FAILED_EVENT_MARKER = 'processing_failed';
// Note : le handler est fail-closed (500 si secret absent, 401 si header
// invalide) — ce warn signale juste une config incomplète au boot.
if (!WEBHOOK_SECRET) console.warn('[unipile-webhook] ⚠️ UNIPILE_WEBHOOK_SECRET not set — all requests will be REJECTED until configured');

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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

/**
 * Exécute une recherche d'enrollments deux fois : sur `account_id` (compte
 * d'enrôlement) puis sur `assigned_sender_id` (compte réellement utilisé en
 * rotation multi-sender), et fusionne sans doublon.
 *
 * Sans le second passage, une réponse ou une acceptation reçue sur le compte
 * qui a réellement envoyé n'était rattachée à aucun enrollment : relances
 * envoyées après la réponse du candidat, wait_connection bloqué jusqu'au
 * timeout (BUG-023). Deux requêtes plutôt qu'un `or` : les appelants combinent
 * déjà un `or` sur le profil, et deux `or` dans une même requête PostgREST se
 * lisent mal.
 *
 * Erreur du second passage (SEQ-013) : tant que la migration qui passe
 * assigned_sender_id en texte n'est pas en base, la colonne est un uuid et un
 * identifiant de compte y lève 22P02 à chaque appel. Aucune ligne ne peut
 * alors porter ce compte : l'erreur est journalisée et le résultat du premier
 * passage est gardé (la remonter mettrait 100 % des webhooks en 500). Toute
 * autre erreur est remontée : l'appelant répond 500 et le prestataire rejoue.
 */
const UUID_COLUMN_ERROR = '22P02';

async function findEnrollmentsBySenderAccount<T extends { id: string }>(
  runQuery: (column: 'account_id' | 'assigned_sender_id') => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; error: unknown }> {
  const byAccount = await runQuery('account_id');
  if (byAccount.error) return { rows: [], error: byAccount.error };
  const bySender = await runQuery('assigned_sender_id');
  if (bySender.error) {
    if ((bySender.error as { code?: string } | null)?.code === UUID_COLUMN_ERROR) {
      console.warn('[unipile-webhook] assigned_sender_id lookup skipped (column still uuid, migration pending):', bySender.error);
      return { rows: byAccount.data ?? [], error: null };
    }
    return { rows: [], error: bySender.error };
  }

  const merged = new Map<string, T>();
  for (const row of [...(byAccount.data ?? []), ...(bySender.data ?? [])]) merged.set(row.id, row);
  return { rows: [...merged.values()], error: null };
}

/** Exécutions encore à venir, annulées à toute clôture d'inscription (jamais 'sending'). */
const PENDING_EXECUTION_STATUSES = ['scheduled', 'waiting_event', 'quota_blocked'];
/** Une réponse, un rebond ou une acceptation concernent aussi une inscription en pause. */
const OPEN_ENROLLMENT_STATUSES = ['active', 'paused'];

/**
 * Inscriptions déjà closes auxquelles un message du candidat se rattache
 * encore (terminée, ou déjà « répondu » par le moteur ou par un premier
 * passage de ce webhook) : leur statut ne change pas, elles désignent
 * l'organisation où tout s'arrête (SEQ-212, _shared/candidate-reply-closure.ts).
 */
const REPLY_CLOSED_ENROLLMENT_STATUSES = ['replied', 'completed'];

/** Mission (outreach_sequences.project_id) de chaque séquence, pour les liens des notifications. */
async function loadSequenceProjects(supabase: SupabaseClient, sequenceIds: string[]): Promise<Map<string, string>> {
  const projectBySequence = new Map<string, string>();
  const ids = [...new Set(sequenceIds.filter(Boolean))];
  if (ids.length === 0) return projectBySequence;
  const { data, error } = await supabase
    .from('outreach_sequences')
    .select('id, project_id')
    .in('id', ids);
  if (error) console.warn('[unipile-webhook] Could not load sequence missions:', error);
  for (const s of (data ?? []) as Array<{ id: string; project_id: string | null }>) {
    if (s.project_id) projectBySequence.set(s.id, s.project_id);
  }
  return projectBySequence;
}

/** metadata.source des alertes « relances non arrêtées après une réponse » (décision 10). */
const SIBLING_STOP_FAILED_SOURCE = 'reply_sibling_stop_failed';

/**
 * Décision 10 : après une réponse, l'arrêt des autres inscriptions ou des
 * InMails programmés du candidat a échoué. Le webhook répond toujours 500
 * (rejeu du prestataire) et le recruteur est prévenu, une seule fois par
 * événement et par organisation : si aucun rejeu n'aboutit, une relance
 * pourrait partir. Non bloquant.
 */
async function alertSiblingStopFailure(
  supabase: SupabaseClient,
  eventKey: string,
  alerts: Array<{
    organizationId: string;
    userIds: Array<string | null | undefined>;
    candidateName: string | null;
    sequenceId: string | null;
    enrollmentIds: string[];
  }>,
): Promise<void> {
  for (const alert of alerts) {
    const userIds = [...new Set(alert.userIds.filter((u): u is string => !!u))];
    if (userIds.length === 0) continue;
    try {
      // Déjà prévenu par un passage précédent du même événement.
      const { data: existing, error: existingError } = await supabase
        .from('notifications')
        .select('id')
        .eq('organization_id', alert.organizationId)
        .in('user_id', userIds)
        .eq('metadata->>source', SIBLING_STOP_FAILED_SOURCE)
        .eq('metadata->>event_key', eventKey)
        .limit(1);
      if (existingError) console.warn('[unipile-webhook] sibling stop alert lookup failed:', existingError);
      else if ((existing ?? []).length > 0) continue;
      const projectId = alert.sequenceId
        ? (await loadSequenceProjects(supabase, [alert.sequenceId])).get(alert.sequenceId)
        : undefined;
      const { error } = await supabase.from('notifications').insert(userIds.map((userId) => ({
        user_id: userId,
        organization_id: alert.organizationId,
        type: 'action',
        title: 'Relances non arrêtées après une réponse',
        body: `${alert.candidateName || 'Le candidat'} a répondu, mais ses autres séquences ou InMails programmés n'ont pas pu être arrêtés. Un nouvel essai automatique est en cours : vérifiez ses inscriptions pour qu'aucune relance ne parte.`,
        link: projectId ? `/missions/${projectId}?tab=outreach` : '/missions',
        metadata: {
          source: SIBLING_STOP_FAILED_SOURCE,
          event_key: eventKey,
          enrollment_ids: alert.enrollmentIds,
          ...(alert.sequenceId ? { sequence_id: alert.sequenceId } : {}),
          profile_name: alert.candidateName,
          ...(projectId ? { project_id: projectId } : {}),
        },
      })));
      if (error) console.warn('[unipile-webhook] sibling stop alert failed:', error);
    } catch (e) {
      console.warn('[unipile-webhook] sibling stop alert failed:', e);
    }
  }
}

/** Notification « Compte LinkedIn déconnecté », commune aux événements v1 (statut) et v2. */
function linkedinDisconnectedNotification(
  row: { user_id: string; organization_id: string; linkedin_account_name?: string | null },
  accountId: string,
) {
  // Schéma notifications : body + read_at (NULL = non lue), pas message/read.
  return {
    user_id: row.user_id,
    organization_id: row.organization_id,
    type: 'linkedin_disconnected',
    title: 'Compte LinkedIn déconnecté',
    body: `Votre compte LinkedIn${row.linkedin_account_name ? ` « ${row.linkedin_account_name} »` : ''} n'est plus connecté. Reconnectez-le depuis Paramètres > Mon compte pour reprendre vos recherches et vos séquences.`,
    link: '/settings?tab=account',
    metadata: { linkedin_account_id: accountId },
  };
}

/**
 * Reprise des inscriptions mises en pause par process-sequences quand ce
 * compte était en CREDENTIALS / ERROR (pause_reason = account_disconnected) :
 * l'inscription repasse 'active' (pause_reason NULL) et l'exécution annulée à
 * la mise en pause est re-planifiée à max(date prévue, maintenant + 1 min)
 * (le processeur applique ensuite heures ouvrées et quotas). Compte d'enrôlement ou compte d'envoi en
 * rotation. Non bloquant : le rattachement du compte ne dépend pas de ce pas.
 *
 * Séquence désactivée (décision D1) : jamais de réactivation. L'inscription
 * reste en pause avec pause_reason 'sequence_inactive' : la réactivation de la
 * séquence la reprendra (resume_enrollments, qui contrôle le compte d'envoi
 * et réarme l'exécution annulée). Un update PostgREST ne filtre pas sur une
 * table jointe : lecture d'abord (avec la séquence), écritures par id ensuite.
 */
async function resumeEnrollmentsAfterReconnect(supabase: SupabaseClient, accountId: string | undefined) {
  if (!accountId) return;
  try {
    const nowIso = new Date().toISOString();
    const activeSequenceIds = new Set<string>();
    const inactiveSequenceIds = new Set<string>();
    const PAGE = 1000;
    for (const column of ['account_id', 'assigned_sender_id'] as const) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('sequence_enrollments')
          .select('id, sequence:outreach_sequences(is_active)')
          .eq(column, accountId)
          .eq('status', 'paused')
          .eq('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON)
          .order('id')
          .range(from, from + PAGE - 1);
        if (error) {
          console.warn(`[unipile-webhook] account_connected: resume lookup by ${column} failed:`, error);
          break;
        }
        const rows = (data ?? []) as Array<{ id: string; sequence: { is_active: boolean | null } | Array<{ is_active: boolean | null }> | null }>;
        for (const row of rows) {
          const seq = Array.isArray(row.sequence) ? row.sequence[0] : row.sequence;
          // Séquence illisible : traitée comme désactivée (échec fermé).
          if (seq?.is_active === true) activeSequenceIds.add(row.id);
          else inactiveSequenceIds.add(row.id);
        }
        if (rows.length < PAGE) break;
      }
    }

    const resumedIds = new Set<string>();
    const activeIds = [...activeSequenceIds];
    for (let i = 0; i < activeIds.length; i += 100) {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'active', pause_reason: null, updated_at: nowIso })
        .in('id', activeIds.slice(i, i + 100))
        .eq('status', 'paused')
        .eq('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON)
        .select('id');
      if (error) {
        console.warn('[unipile-webhook] account_connected: resume failed:', error);
        continue;
      }
      for (const row of (data ?? []) as Array<{ id: string }>) resumedIds.add(row.id);
    }

    let relabeled = 0;
    const inactiveIds = [...inactiveSequenceIds];
    for (let i = 0; i < inactiveIds.length; i += 100) {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .update({ pause_reason: 'sequence_inactive', updated_at: nowIso })
        .in('id', inactiveIds.slice(i, i + 100))
        .eq('status', 'paused')
        .eq('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON)
        .select('id');
      if (error) {
        console.warn('[unipile-webhook] account_connected: relabel to sequence_inactive failed:', error);
        continue;
      }
      relabeled += (data ?? []).length;
    }

    // Réarmement seulement pour les inscriptions réellement reprises, à
    // max(date prévue, maintenant + 1 min) : une relance prévue jeudi ne part
    // pas lundi à la reconnexion.
    const nowMs = Date.now();
    for (const enrollmentId of resumedIds) {
      const { data: cancelled } = await supabase
        .from('sequence_step_executions')
        .select('id, scheduled_at')
        .eq('enrollment_id', enrollmentId)
        .eq('status', 'cancelled')
        .eq('skip_reason', ACCOUNT_DISCONNECTED_SKIP_REASON)
        .order('step_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled?.id) continue;
      const { error: execError } = await supabase
        .from('sequence_step_executions')
        .update({ status: 'scheduled', skip_reason: null, scheduled_at: resumeDate(cancelled.scheduled_at, nowMs), updated_at: nowIso })
        .eq('id', cancelled.id)
        .eq('status', 'cancelled');
      if (execError) console.warn(`[unipile-webhook] account_connected: execution ${cancelled.id} not rescheduled:`, execError);
    }

    console.log(`[unipile-webhook] account_connected: ${resumedIds.size} enrollment(s) resumed, ${relabeled} left paused (sequence inactive) after reconnect of ${accountId}`);
  } catch (e) {
    console.warn('[unipile-webhook] account_connected: enrollment resume failed (non-blocking):', e);
  }
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
    const { data: linkedInAccount } = await supabase
      .from('member_linkedin_accounts')
      .select('organization_id')
      .eq('linkedin_account_id', accountId)
      .maybeSingle();

    let organizationId = linkedInAccount?.organization_id as string | undefined;
    if (!organizationId) {
      const { data: emailAccount } = await supabase
        .from('member_email_accounts')
        .select('organization_id')
        .eq('email_account_id', accountId)
        .maybeSingle();
      organizationId = emailAccount?.organization_id as string | undefined;
    }

    if (!organizationId) {
      const { data: whatsappAccount } = await supabase.from('member_whatsapp_accounts')
        .select('organization_id').eq('whatsapp_account_id', accountId).maybeSingle();
      organizationId = whatsappAccount?.organization_id as string | undefined;
    }

    if (!organizationId) return fallback;

    const creds = await resolveUnipileCredentials(organizationId, supabase);
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
  account_type?: string;
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
  /** En-têtes du message, quand la charge utile les expose (réponses automatiques). */
  headers?: Array<{ name?: string; value?: unknown }> | Record<string, unknown>;
  // account_status webhook : payload peut arriver wrappé en AccountStatus
  AccountStatus?: { account_id?: string; account_type?: string; message?: string };
  // API v2 (account.add / account.reconnect) : le state du hosted auth arrive
  // dans un champ dédié `state` au lieu d'être encodé dans `name` comme en v1.
  state?: string;
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
  providers: string[];
  expiresAtMs: number | null;
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
    providers: (map.providers || '')
      .split(',')
      .map((provider) => provider.trim().toUpperCase())
      .filter(Boolean),
    expiresAtMs: /^\d{13}$/.test(map.expires || '') ? Number(map.expires) : null,
  };
}

const EMAIL_ACCOUNT_TYPES = new Set([
  'GOOGLE', 'GOOGLE_OAUTH', 'GMAIL',
  'OUTLOOK', 'MICROSOFT', 'EXCHANGE',
  'IMAP', 'MAIL', 'ICLOUD',
]);

function normalizeAccountType(payload: WebhookPayload, hostedProviders: string[] = []): string {
  const raw = payload.account_type
    || payload.AccountStatus?.account_type
    || (payload.data as Record<string, unknown> | undefined)?.account_type
    || (payload.data as Record<string, unknown> | undefined)?.type
    || hostedProviders[0]
    || '';
  return String(raw).trim().toUpperCase();
}

async function resolveConnectedAccountMetadata(
  payload: WebhookPayload,
  organizationId: string,
  supabase: SupabaseClient,
  hostedProviders: string[],
): Promise<{ accountType: string; emailAddress: string | null; displayName: string | null }> {
  let accountType = normalizeAccountType(payload, hostedProviders);
  let emailAddress: string | null = null;
  let displayName: string | null = null;
  const payloadData = (payload.data as Record<string, unknown> | undefined) || {};
  if (typeof payloadData.name === 'string') displayName = payloadData.name;
  if (typeof payloadData.identifier === 'string') emailAddress = payloadData.identifier;

  if (accountType !== 'WHATSAPP' && accountType && (displayName || !EMAIL_ACCOUNT_TYPES.has(accountType))) {
    return { accountType, emailAddress, displayName };
  }

  try {
    const credentials = await resolveUnipileCredentials(organizationId, supabase);
    if (!credentials || !payload.account_id) return { accountType, emailAddress, displayName };
    const response = await fetchWithTimeout(
      `${credentials.dsn}/api/v1/accounts/${encodeURIComponent(payload.account_id)}`,
      { headers: { 'X-API-KEY': credentials.apiKey, Accept: 'application/json' } },
    );
    if (!response.ok) return { accountType, emailAddress, displayName };
    const account = await response.json() as {
      type?: unknown;
      account_type?: unknown;
      name?: unknown;
      identifier?: unknown;
      connection_params?: {
        mail?: { imap_user?: unknown; smtp_user?: unknown };
        im?: { phone_number?: unknown };
      };
    };
    accountType = String(account.type || account.account_type || accountType).trim().toUpperCase();
    displayName = typeof account.name === 'string' ? account.name : displayName;
    const mail = account.connection_params?.mail;
    const resolvedAddress = accountType === 'WHATSAPP'
      ? account.connection_params?.im?.phone_number
      : mail?.imap_user || mail?.smtp_user || account.identifier;
    emailAddress = typeof resolvedAddress === 'string' ? resolvedAddress : accountType === 'WHATSAPP' ? null : emailAddress || displayName;
  } catch (error) {
    console.warn('[unipile-webhook] Could not resolve connected account metadata:', error);
  }
  return { accountType, emailAddress, displayName };
}

interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  profile_id: string;
  account_id: string;
  status: string;
  connection_status: string | null;
  // Présents avec select('*') : servent à la notification new_message et au
  // rattachement des identifiants LinkedIn (Recruiter / classique).
  organization_id?: string | null;
  profile_name?: string | null;
  profile_headline?: string | null;
  profile_url?: string | null;
  provider_id?: string | null;
  resolved_profile_id?: string | null;
  created_by?: string | null;
  job_id?: string | null;
  replied_at?: string | null;
  completed_at?: string | null;
  tracking_data?: Record<string, unknown> | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Hoistés pour être accessibles dans le catch (purge de la ligne de dédup
  // en cas d'échec réel — voir commentaire du catch).
  let dedupKeyForCleanup: string | null = null;
  let supabaseForCleanup: SupabaseClient | null = null;

  try {
    const rawPayload = await req.json() as Partial<WebhookPayload>;
    // Verify webhook authenticity
    const authHeader = req.headers.get('unipile-auth');
    if (!WEBHOOK_SECRET) {
      console.error('[unipile-webhook] ⚠️ UNIPILE_WEBHOOK_SECRET not set — rejecting request. Configure this secret!');
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const headerAuthenticated = Boolean(authHeader && timingSafeEqual(authHeader, WEBHOOK_SECRET));
    // Webhooks API v2 : l'enregistrement v2 n'accepte pas de headers custom →
    // le token dérivé voyage en query param, posé par unipile-manage-webhooks
    // (action register + api_version v2). Même niveau de confiance que le header.
    const v2Token = new URL(req.url).searchParams.get('v2_token');
    const expectedV2Token = v2Token ? await resolveV2WebhookToken() : null;
    const v2Authenticated = Boolean(v2Token && expectedV2Token && timingSafeEqual(v2Token, expectedV2Token));
    const fullyAuthenticated = headerAuthenticated || v2Authenticated;
    const hostedSignature = new URL(req.url).searchParams.get('hosted_sig');
    const hostedState = parseHostedAuthState(rawPayload.name);
    const hostedStateFresh = Boolean(
      hostedState?.expiresAtMs
      && hostedState.expiresAtMs > Date.now()
      && hostedState.expiresAtMs <= Date.now() + 31 * 60 * 1000,
    );
    const expectedHostedSignature = hostedSignature && rawPayload.name && hostedStateFresh
      ? await hmacSha256Hex(WEBHOOK_SECRET, rawPayload.name)
      : null;
    const hostedAuthenticated = Boolean(
      hostedSignature
      && expectedHostedSignature
      && timingSafeEqual(hostedSignature, expectedHostedSignature),
    );
    if (!fullyAuthenticated && !hostedAuthenticated) {
      console.error('[unipile-webhook] Invalid webhook authentication');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const hostedAuthSucceeded = Boolean(
      rawPayload.name
      && rawPayload.account_id
      && (rawPayload.status === 'CREATION_SUCCESS' || rawPayload.status === 'RECONNECTED'),
    );
    if (hostedAuthenticated && !fullyAuthenticated && (!hostedAuthSucceeded || rawPayload.event)) {
      return new Response(JSON.stringify({ error: 'Invalid hosted auth callback' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // API v2 : enveloppe { type, id: evt_…, account_id, payload: {…} } remise
    // au format des handlers v1 (voir flattenV2WebhookEnvelope).
    const source = (flattenV2WebhookEnvelope(rawPayload) ?? rawPayload) as Partial<WebhookPayload>;
    const payload: WebhookPayload = {
      ...source,
      event: source.event
        || (source.AccountStatus ? 'account_status_updated' : '')
        || (hostedAuthSucceeded ? 'account_connected' : ''),
      account_id: source.account_id || source.AccountStatus?.account_id || '',
    };

    // ─── Aliases API v2 (BETA) ─────────────────────────────────────────────
    // La v2 renomme les événements — on les remappe sur les handlers v1
    // existants (dont le parsing est défensif multi-format). Chaque clé doit
    // figurer dans V2_TRIGGER_EVENTS (_shared/unipile-v2.ts).
    const V2_EVENT_ALIASES: Record<string, string> = {
      'relation.new': 'new_relation',
      'message.new': 'new_message',
      'email.new': 'mail_received',
      'account.add': 'account_connected',
      'account.reconnect': 'account_connected',
      'account.remove': 'account_disconnected',
      'account.status.disconnected': 'account_disconnected',
      'account.status.errored': 'account_error',
      'account.status.running': 'account_status_updated',
      'account.status.degraded': 'account_status_updated',
      'account.status.partial': 'account_status_updated',
      'account.locked': 'account_locked',
      'account.unlocked': 'account_unlocked',
    };
    // account.status.{running|degraded|partial} portent le statut dans le NOM
    // de l'événement : il fait foi et remplace un éventuel payload.status (une
    // valeur v2 en minuscules comme 'running' n'est pas 'OK' pour les gardes
    // d'envoi de process-sequences et process-inmail-queue).
    // - running : compte opérationnel → OK ;
    // - degraded : un produit (ex. Recruiter) en erreur de service, un autre
    //   actif → DEGRADED, envois reportés d'heure en heure jusqu'au retour à OK ;
    // - partial : un produit à réauthentifier, un autre actif → PARTIAL,
    //   « à reconnecter » côté front (src/lib/linkedinStatus.ts).
    const V2_STATUS_BY_EVENT: Record<string, string> = {
      'account.status.running': 'OK',
      'account.status.degraded': 'DEGRADED',
      'account.status.partial': 'PARTIAL',
    };
    const v2OriginEvent = V2_EVENT_ALIASES[payload.event] ? payload.event : null;
    // Le schéma des payloads v2 n'est pas documenté : l'identifiant d'événement
    // (préfixe evt_, cf. GET /v2/webhooks/conversations/) n'est retenu que s'il
    // en a la forme.
    const v2EventId = v2OriginEvent
      ? [(source as Record<string, unknown>).event_id, (rawPayload as Record<string, unknown>).event_id, (rawPayload as Record<string, unknown>).id]
          .find((v): v is string => typeof v === 'string' && v.startsWith('evt_')) ?? null
      : null;
    if (v2OriginEvent) {
      if (V2_STATUS_BY_EVENT[v2OriginEvent]) payload.status = V2_STATUS_BY_EVENT[v2OriginEvent];
      payload.event = V2_EVENT_ALIASES[v2OriginEvent];
    }

    // Conformité LinkedIn (warning #260513-007211) : ne JAMAIS logger le payload
    // brut — il peut contenir du contenu de messages, PII destinataires, et
    // potentiellement des identifiants de session. On loggue uniquement les
    // métadonnées structurelles de l'event.
    console.log('[unipile-webhook] event:', payload.event,
      'v2_origin:', v2OriginEvent,
      'v2_evt:', v2EventId,
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
    // Le statut et l'identifiant du message imbriqué font partie de la clé : sans
    // eux, « CREDENTIALS » puis « OK » dans la même minute (format à plat, API v2)
    // ne comptaient qu'une fois et le compte restait noté déconnecté.
    const eventIdRaw =
      (payload as any).message_id
      || (payload as any).email_id
      || (payload as any).data?.message?.id
      || ((payload as any).AccountStatus
          ? `${(payload as any).AccountStatus.account_id}:${(payload as any).AccountStatus.message}:${Math.floor(Date.now() / 60000)}`
          : null)
      // Identifiant d'événement v2 (evt_…, commun à toutes les tentatives d'un
      // même événement) quand le payload le porte : dédoublonnage exact, sans
      // fenêtre à la minute qui écarterait un retour running → degraded →
      // running rapide.
      || (v2OriginEvent && v2EventId ? `${payload.account_id || 'no-acc'}:${v2OriginEvent}:${v2EventId}` : null)
      // Nom v2 d'origine : degraded, partial et running partagent le même
      // alias (account_status_updated) ; sans lui, un retour à running dans la
      // même minute qu'un degraded serait écarté comme doublon.
      || `${payload.account_id || 'no-acc'}:${v2OriginEvent || payload.event}:${(payload as any).chat_id || ''}:${(payload as any).user_provider_id || ''}:${payload.status || (payload.data as any)?.status || ''}:${Math.floor(Date.now() / 60000)}`;
    const eventKey = `unipile:${payload.event}:${eventIdRaw}`.slice(0, 500);
    dedupKeyForCleanup = eventKey;
    supabaseForCleanup = supabase;

    try {
      const { data: isNew } = await supabase.rpc('record_webhook_event', {
        p_event_key: eventKey,
        p_provider: 'unipile',
        p_event_type: payload.event,
        p_account_id: payload.account_id || null,
      });
      if (isNew === false) {
        // Clé laissée par un traitement en échec dont la purge a échoué aussi
        // (marquée par le catch plus bas) : ce rejeu la reprend et traite
        // l'événement, au lieu de l'ignorer comme doublon (SEQ-040).
        const { data: reclaimed } = await supabase
          .from('webhook_event_log')
          .update({ event_type: payload.event, received_at: new Date().toISOString() })
          .eq('event_key', eventKey)
          .eq('event_type', FAILED_EVENT_MARKER)
          .select('event_key');
        if ((reclaimed ?? []).length === 0) {
          console.log('[unipile-webhook] Duplicate event ignored:', eventKey);
          return new Response(JSON.stringify({ ok: true, deduplicated: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.warn('[unipile-webhook] Retrying event whose dedup purge had failed:', eventKey);
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
        const captured = await captureCandidateActionIncoming(supabase, payload as unknown as Record<string, unknown>, rawPayload);
        // WhatsApp has a personal binding and its own history. It must never
        // pass through the LinkedIn enrollment/stage handler.
        if (captured.channel !== 'whatsapp') await handleNewMessage(supabase, payload, uCreds, eventKey);
        break;
      }

      case 'mail_received':
      case 'mail.received':
      case 'new_email': {
        const captured = await captureCandidateActionIncoming(supabase, payload as unknown as Record<string, unknown>, rawPayload);
        // Un email a été reçu sur un compte connecté → vérifier si c'est une
        // réponse à une étape de séquence email pour stopper les suivantes.
        if (captured.audience !== 'team') await handleNewMail(supabase, payload, eventKey);
        break;
      }
      
      case 'account_connected': {
        console.log('[unipile-webhook] Account connected:', payload.account_id, 'name:', payload.name);

        // Parse le state encodé dans `name` par hosted_auth (user + org).
        // API v2 : le state arrive dans un champ dédié `state` (même encodage).
        const hostedState = parseHostedAuthState(payload.name || payload.state);

        if (hostedState) {
          // Flow hosted_auth moderne : UPSERT avec user_id + org_id pour garantir
          // le mapping même si la row n'existait pas (cas après "Dissocier").
          // C'est le FIX du dead-end où un nouveau compte Unipile était créé
          // mais jamais lié à un user -> invisible dans Settings.
          try {
            const metadata = await resolveConnectedAccountMetadata(
              payload,
              hostedState.organizationId,
              supabase,
              hostedState.providers,
            );

            if (EMAIL_ACCOUNT_TYPES.has(metadata.accountType)) {
              const { data: existing } = await supabase
                .from('member_email_accounts')
                .select('id, user_id')
                .eq('organization_id', hostedState.organizationId)
                .eq('email_account_id', payload.account_id)
                .maybeSingle();

              if (existing && existing.user_id !== hostedState.userId) {
                console.error('[unipile-webhook] Refusing to reassign an email account to another user');
              } else {
                const emailRow = {
                  organization_id: hostedState.organizationId,
                  user_id: hostedState.userId,
                  email_account_id: payload.account_id,
                  email_address: metadata.emailAddress,
                  provider: metadata.accountType,
                  account_status: 'OK',
                  linked_by: hostedState.userId,
                };
                const { error } = existing
                  ? await supabase.from('member_email_accounts').update(emailRow).eq('id', existing.id)
                  : await supabase.from('member_email_accounts').insert(emailRow);
                if (error) throw error;
                console.log('[unipile-webhook] Mapped email account via hosted_auth for current user');
              }
            } else if (metadata.accountType === 'WHATSAPP') {
              const { data: existing, error: existingError } = await supabase.from('member_whatsapp_accounts')
                .select('id,organization_id,user_id,account_status').eq('whatsapp_account_id', payload.account_id).maybeSingle();
              if (existingError) throw existingError;
              if (existing && (existing.organization_id !== hostedState.organizationId || existing.user_id !== hostedState.userId)) {
                throw Object.assign(new Error('WhatsApp account already linked to another member'), { code: '23505' });
              }
              if (existing?.account_status === 'DELETED') throw Object.assign(new Error('WhatsApp account binding has been revoked'), { code: '42501' });
              const whatsappRow = {
                organization_id: hostedState.organizationId, user_id: hostedState.userId,
                whatsapp_account_id: payload.account_id, phone_number: candidateActionPhone(metadata.emailAddress) || null,
                name: metadata.displayName, account_status: 'OK', updated_at: new Date().toISOString(),
              };
              const result = existing
                ? await supabase.from('member_whatsapp_accounts').update(whatsappRow).eq('id', existing.id)
                : await supabase.from('member_whatsapp_accounts').insert(whatsappRow);
              if (result.error) throw result.error;
            } else {
              // Nouveau compte à la place du compte relié de ce membre (SEQ-041) :
              // l'ancien compte cesse d'envoyer AVANT que la liaison ne soit
              // repointée (même arrêt que « Dissocier »). Échec = rattachement
              // refusé, le membre est prévenu par la notification ci-dessous.
              //
              // Propriété du nouveau compte vérifiée AVANT l'arrêt, comme
              // claim_linkedin_account : un compte déjà relié à une autre
              // organisation (trigger no_cross_tenant, 42501) ou à un autre
              // membre (UNIQUE, 23505) ferait échouer le rattachement APRÈS
              // avoir gelé les séquences de l'ancien compte, qui reste relié.
              const { data: owners, error: ownersError } = await supabase
                .from('member_linkedin_accounts')
                .select('organization_id, user_id')
                .eq('linkedin_account_id', payload.account_id);
              if (ownersError) throw ownersError;
              const ownerRows = (owners ?? []) as Array<{ organization_id: string; user_id: string | null }>;
              if (ownerRows.some((r) => r.organization_id !== hostedState.organizationId)) {
                throw Object.assign(new Error('LinkedIn account already linked to another organization'), { code: '42501' });
              }
              if (ownerRows.some((r) => r.user_id !== hostedState.userId)) {
                throw Object.assign(new Error('LinkedIn account already linked to another member'), { code: '23505' });
              }

              const { data: currentLink, error: currentLinkError } = await supabase
                .from('member_linkedin_accounts')
                .select('linkedin_account_id')
                .eq('organization_id', hostedState.organizationId)
                .eq('user_id', hostedState.userId)
                .maybeSingle();
              if (currentLinkError) throw currentLinkError;
              const previousAccountId = (currentLink as { linkedin_account_id?: string | null } | null)?.linkedin_account_id;
              const accountChanged = !!previousAccountId && previousAccountId !== payload.account_id;
              if (accountChanged && previousAccountId) {
                await stopLinkedInAccountSending(supabase, {
                  organizationId: hostedState.organizationId,
                  accountId: previousAccountId,
                });
              }
              const nowIso = new Date().toISOString();

              const { error } = await supabase
                .from('member_linkedin_accounts')
                .upsert({
                  user_id: hostedState.userId,
                  organization_id: hostedState.organizationId,
                  linkedin_account_id: payload.account_id,
                  linkedin_account_name: metadata.displayName || 'Compte LinkedIn',
                  account_status: 'OK',
                  last_checked_at: nowIso,
                  failure_reason: null,
                  // NOT NULL sans défaut : l'utilisateur qui a initié le flow hosted_auth.
                  linked_by: hostedState.userId,
                  // Nouveau compte sur la liaison : la montée en charge repart de
                  // zéro, comme claim_linkedin_account (une reconnexion du même
                  // compte garde son ancienneté).
                  ...(accountChanged ? { linked_at: nowIso } : {}),
                }, {
                  onConflict: 'user_id,organization_id',
                });
              if (error) throw error;
              console.log('[unipile-webhook] Mapped LinkedIn account via hosted_auth for current user');
            }
          } catch (e) {
            console.error('[unipile-webhook] Upsert via hosted_auth failed:', e);
            // L'utilisateur qui a lancé la connexion attend le rattachement : on le prévient.
            const code = (e as { code?: string })?.code;
            const channelLabel = hostedState.providers.includes('WHATSAPP') ? 'WhatsApp'
              : hostedState.providers.some(provider => EMAIL_ACCOUNT_TYPES.has(provider)) ? 'e-mail' : 'LinkedIn';
            const body = code === '42501'
              ? `Ce compte ${channelLabel} est déjà rattaché à un autre espace de travail.`
              : code === '23505'
                ? `Ce compte ${channelLabel} est déjà rattaché à un autre membre de votre organisation.`
                : `Le compte ${channelLabel} est connecté mais n'a pas pu être rattaché. Réessayez depuis Paramètres > Mon compte.`;
            try {
              await supabase.from('notifications').insert({
                user_id: hostedState.userId,
                organization_id: hostedState.organizationId,
                type: 'error',
                title: `Compte ${channelLabel} non rattaché`,
                body,
                link: '/settings/account/connections',
                metadata: { account_id: payload.account_id },
              });
            } catch (notifErr) {
              console.warn('[unipile-webhook] Notification insert failed:', notifErr);
            }
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

        // Lot P0-D : les inscriptions mises en pause à la déconnexion de ce
        // compte reprennent d'elles-mêmes (pause explicite, reprise automatique).
        await resumeEnrollmentsAfterReconnect(supabase, payload.account_id);
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
            const accountType = normalizeAccountType(payload);
            if (accountType === 'WHATSAPP') {
              const { error } = await supabase.from('member_whatsapp_accounts')
                .update({ account_status: normalizedStatus, updated_at: new Date().toISOString() })
                .eq('whatsapp_account_id', accId).neq('account_status', 'DELETED');
              if (error) throw error;
            } else if (EMAIL_ACCOUNT_TYPES.has(accountType)) {
              await supabase
                .from('member_email_accounts')
                .update({ account_status: normalizedStatus })
                .eq('email_account_id', accId);
            } else {
            // Statut précédent lu AVANT l'écriture : la notification de
            // déconnexion n'est créée qu'au passage OK → panne (SEQ-208), pas à
            // chaque événement répété.
            const { data: linkedRows, error: linkedRowsError } = await supabase
              .from('member_linkedin_accounts')
              .select('user_id, organization_id, linkedin_account_name, account_status')
              .eq('linkedin_account_id', accId);
            if (linkedRowsError) console.warn('[unipile-webhook] status_updated: previous status lookup failed:', linkedRowsError);
            await supabase
              .from('member_linkedin_accounts')
              .update({
                account_status: normalizedStatus,
                last_checked_at: new Date().toISOString(),
                // Si on repasse OK, on efface la raison d'échec précédente
                ...(normalizedStatus === 'OK' ? { failure_reason: null } : {}),
              })
              .eq('linkedin_account_id', accId);
            if (['CREDENTIALS', 'ERROR', 'PERMISSIONS'].includes(String(normalizedStatus))) {
              const newlyBroken = ((linkedRows ?? []) as Array<{
                user_id: string;
                organization_id: string;
                linkedin_account_name: string | null;
                account_status: string | null;
              }>).filter((row) => row.account_status === 'OK');
              if (newlyBroken.length > 0) {
                const { error: notifError } = await supabase
                  .from('notifications')
                  .insert(newlyBroken.map((row) => linkedinDisconnectedNotification(row, accId)));
                if (notifError) console.warn('[unipile-webhook] status_updated: disconnect notifications failed:', notifError);
              }
            }
            // Reconnexion par cookie ou par statut : les inscriptions mises en
            // pause pour compte déconnecté reprennent (idempotent).
            if (normalizedStatus === 'OK') {
              await resumeEnrollmentsAfterReconnect(supabase, accId);
            }
            }
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
          await supabase
            .from('member_email_accounts')
            .update({ account_status: reason === 'disconnected' ? 'CREDENTIALS' : 'ERROR' })
            .eq('email_account_id', payload.account_id);
          const { error: whatsappError } = await supabase.from('member_whatsapp_accounts')
            .update({ account_status: reason === 'disconnected' ? 'DISCONNECTED' : 'ERROR', updated_at: new Date().toISOString() })
            .eq('whatsapp_account_id', payload.account_id).neq('account_status', 'DELETED');
          if (whatsappError) throw whatsappError;
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
            const notifications = (linkedUsers as Array<{ user_id: string; organization_id: string; linkedin_account_name: string | null }>)
              .map((u) => linkedinDisconnectedNotification(u, payload.account_id));

            const { error: notifError } = await supabase.from('notifications').insert(notifications);
            if (notifError) console.warn('[unipile-webhook] Could not create notifications:', notifError);
          }
        } catch (e) {
          console.warn('[unipile-webhook] Error creating disconnect notifications:', e);
        }
        break;
      }

      // API v2 : accès au compte verrouillé puis déverrouillé (drapeau is_locked,
      // indépendant du statut). LOCKED bloque les envois comme tout statut
      // différent de OK, sans pause ni notification : l'utilisateur n'a rien à
      // faire. Le verrouillage ne touche qu'un compte OK (ou sans statut) et le
      // déverrouillage ne relève que LOCKED : l'aller-retour est exact. Un
      // compte déjà bloqué (CREDENTIALS, PARTIAL, DEGRADED…) garde son statut,
      // sinon le déverrouillage le rendrait OK et les envois repartiraient.
      case 'account_locked':
      case 'account_unlocked': {
        const locking = payload.event === 'account_locked';
        const accId = payload.account_id;
        if (!accId) break;
        try {
          const linkedinUpdate = supabase
            .from('member_linkedin_accounts')
            .update({ account_status: locking ? 'LOCKED' : 'OK', last_checked_at: new Date().toISOString() })
            .eq('linkedin_account_id', accId);
          const emailUpdate = supabase
            .from('member_email_accounts')
            .update({ account_status: locking ? 'LOCKED' : 'OK' })
            .eq('email_account_id', accId);
          const whatsappUpdate = supabase.from('member_whatsapp_accounts')
            .update({ account_status: locking ? 'LOCKED' : 'OK', updated_at: new Date().toISOString() })
            .eq('whatsapp_account_id', accId);
          const results = locking
            ? await Promise.all([
                linkedinUpdate.or('account_status.is.null,account_status.eq.OK'),
                emailUpdate.or('account_status.is.null,account_status.eq.OK'),
                whatsappUpdate.or('account_status.is.null,account_status.eq.OK'),
              ])
            : await Promise.all([
                linkedinUpdate.eq('account_status', 'LOCKED'),
                emailUpdate.eq('account_status', 'LOCKED'),
                whatsappUpdate.eq('account_status', 'LOCKED'),
              ]);
          for (const { error } of results) {
            if (error) console.warn(`[unipile-webhook] ${payload.event} update failed:`, error.message);
          }
        } catch (e) {
          console.warn(`[unipile-webhook] ${payload.event} handler failed:`, e);
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
    // Échec RÉEL de traitement (DB down, RPC en erreur…) → 500 pour exploiter
    // les retries Unipile (5×) au lieu de perdre l'event définitivement
    // (audit 2026-07, Delivery M11 : un blip DB de 30s pendant un
    // mail_received = réponse du candidat jamais enregistrée → on continuait
    // de le relancer). On purge d'abord la ligne de dédup, sinon le retry
    // serait ignoré comme doublon. Le client ne lève pas : un échec arrive
    // dans { error } (il passait inaperçu, et le rejeu répondait
    // « deduplicated »). Repli : la clé est marquée en échec, et le rejeu la
    // reprend (voir la dédup plus haut).
    if (dedupKeyForCleanup && supabaseForCleanup) {
      try {
        const { error: cleanupError } = await supabaseForCleanup
          .from('webhook_event_log')
          .delete()
          .eq('event_key', dedupKeyForCleanup);
        if (cleanupError) {
          console.error('[unipile-webhook] Dedup cleanup failed:', cleanupError);
          const { error: markError } = await supabaseForCleanup
            .from('webhook_event_log')
            .update({ event_type: FAILED_EVENT_MARKER })
            .eq('event_key', dedupKeyForCleanup);
          if (markError) {
            console.error('[unipile-webhook] Dedup key kept: the provider retry will be ignored as a duplicate:', markError);
          }
        }
      } catch (cleanupErr) {
        console.error('[unipile-webhook] Dedup cleanup failed:', cleanupErr);
      }
    }
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
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

  // Inscriptions de ce candidat sur ce compte, actives OU en pause (SEQ-012 :
  // une acceptation pendant une pause n'était jamais consignée). Plus de
  // filtre sur connection_status (SEQ-209 : NULL, valeur par défaut des
  // inscriptions de l'interface, était exclu) : les inscriptions déjà
  // 'connected' sont ignorées dans la boucle.
  // Match on profile_id OR resolved_profile_id to handle Recruiter IDs (AEM -> ACo)
  const { rows: enrollments, error: enrollError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
    (column) => supabase
      .from('sequence_enrollments')
      .select('*')
      .eq(column, account_id)
      .in('status', OPEN_ENROLLMENT_STATUSES)
      .or(`profile_id.eq.${sanitizeFilterId(profileId)},resolved_profile_id.eq.${sanitizeFilterId(profileId)},provider_id.eq.${sanitizeFilterId(profileId)}`),
  );

  // Lecture impossible : on lève, le catch global purge la dédup et répond
  // 500, le prestataire rejoue (SEQ-040).
  if (enrollError) throw enrollError;

  const toUpdate = (enrollments ?? []).filter((e) => e.connection_status !== 'connected');
  if (toUpdate.length === 0) {
    console.log('[unipile-webhook] No enrollment waiting for this connection');
    return;
  }

  console.log(`[unipile-webhook] Found ${toUpdate.length} enrollments to update`);

  const failures: unknown[] = [];
  for (const enrollment of toUpdate) {
    const isActive = enrollment.status === 'active';

    // 1. Étape d'attente réarmée (inscription active seulement ; une
    //    inscription en pause reprendra son attente à la reprise). Fait AVANT
    //    le passage à 'connected' : si la suite échoue, le rejeu retrouve
    //    l'inscription (pas encore 'connected') et termine le travail.
    if (isActive) {
      const { data: waitSteps, error: waitStepsError } = await supabase
        .from('sequence_step_executions')
        .select('id, step_id, step_order')
        .eq('enrollment_id', enrollment.id)
        .in('status', ['waiting_event', 'scheduled'])
        .order('step_order', { ascending: true })
        .limit(1);
      if (waitStepsError) {
        failures.push(waitStepsError);
        continue;
      }

      if (waitSteps && waitSteps.length > 0) {
        const waitStep = waitSteps[0];
        // Verify this is indeed a wait_connection step
        const { data: stepDef, error: stepDefError } = await supabase
          .from('sequence_steps')
          .select('action_type')
          .eq('id', waitStep.step_id)
          .maybeSingle();
        if (stepDefError) {
          failures.push(stepDefError);
          continue;
        }

        if (stepDef?.action_type === 'wait_connection') {
          // Re-arme l'étape d'attente et laisse process-sequences la franchir au
          // prochain cycle (moins d'une minute). Une seule logique de
          // progression, celle du moteur (BUG-024). Garde de statut (SEQ-190) :
          // une exécution réclamée ('sending') ou franchie entre-temps n'est
          // jamais ramenée à 'scheduled'.
          const { error: rearmError } = await supabase
            .from('sequence_step_executions')
            .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
            .eq('id', waitStep.id)
            .in('status', ['waiting_event', 'scheduled']);
          if (rearmError) {
            failures.push(rearmError);
            continue;
          }
          console.log(`[unipile-webhook] Re-armed wait_connection step for enrollment ${enrollment.id}`);
        }
      }
    }

    // 2. Connexion consignée (actives et en pause). last_check_at seulement
    //    pour une inscription active. Mise à jour conditionnée : un second
    //    événement pour la même acceptation (relation.new puis
    //    relation.request.accept) ne recompte pas l'invitation acceptée.
    const { data: changed, error: updateError } = await supabase
      .from('sequence_enrollments')
      .update({
        connection_status: 'connected',
        network_distance: 'FIRST_DEGREE',
        ...(isActive ? { last_check_at: new Date().toISOString() } : {}),
      })
      .eq('id', enrollment.id)
      .or('connection_status.is.null,connection_status.neq.connected')
      .select('id');

    if (updateError) {
      failures.push(updateError);
      continue;
    }
    if (!changed || changed.length === 0) continue;

    // Log analytics — RPC d'incrément atomique (l'ancien upsert REMETTAIT le
    // compteur à 1 à partir du 2e événement du jour, faussant toutes les stats)
    await supabase.rpc('increment_sequence_analytics', {
      p_sequence_id: enrollment.sequence_id,
      p_field: 'invites_accepted',
    });

    console.log('[unipile-webhook] Updated enrollment:', enrollment.id, 'to connected');
  }

  // Échec d'une écriture : les autres lignes sont traitées, puis on lève
  // pour que le prestataire rejoue l'événement (idempotent).
  if (failures.length > 0) {
    console.error(`[unipile-webhook] new_relation: ${failures.length} enrollment(s) not updated:`, failures[0]);
    throw failures[0];
  }
}

// Réponse envoyée hors de l'application (LinkedIn mobile par exemple) : la
// conversation est traitée, ses notifications new_message non lues passent en
// lues pour les utilisateurs liés à ce compte. Non bloquant.
// Limite connue : un envoi automatique de séquence dans la même conversation
// a le même effet. Il est rare après une réponse, puisque la réponse du
// candidat annule les étapes restantes.
async function markChatNotificationsRead(
  supabase: SupabaseClient,
  accountId: string | undefined,
  chatId: string | undefined,
): Promise<void> {
  if (!chatId || !accountId) return;
  try {
    const { data: accountUsers, error: usersError } = await supabase
      .from('member_linkedin_accounts')
      .select('user_id')
      .eq('linkedin_account_id', accountId);
    if (usersError) {
      console.warn('[unipile-webhook] Own message: linked users lookup failed:', usersError);
      return;
    }
    const userIds = [...new Set((accountUsers ?? []).map((u: { user_id: string }) => u.user_id))];
    if (userIds.length === 0) return;
    const { error: readError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('user_id', userIds)
      .eq('type', 'new_message')
      .is('read_at', null)
      .eq('metadata->>chat_id', chatId);
    if (readError) console.warn('[unipile-webhook] Own message: marking notifications read failed:', readError);
  } catch (e) {
    console.warn('[unipile-webhook] Own message: marking notifications read failed:', e);
  }
}

/** Participant d'une conversation, tel que le rend GET /chats/{id}/attendees. */
interface ChatAttendee {
  is_self?: unknown;
  role?: unknown;
  provider_id?: unknown;
  public_identifier?: unknown;
  profile_url?: unknown;
  name?: unknown;
  specifics?: { public_identifier?: unknown } | null;
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Candidat d'une conversation à deux : le seul participant qui n'est pas le
 * compte. Aucun ou plusieurs (conversation de groupe) : null, pour ne jamais
 * attribuer un message au mauvais candidat.
 */
function otherParticipantRef(attendees: unknown[]): CandidateRef | null {
  const others = attendees.filter((a): a is ChatAttendee => {
    if (!a || typeof a !== 'object') return false;
    const att = a as ChatAttendee;
    return !(att.is_self === true || att.is_self === 1 || att.role === 'self');
  });
  if (others.length !== 1) return null;
  const other = others[0];
  const ref = candidateRef({
    ids: [textOrNull(other.provider_id)],
    slug: textOrNull(other.public_identifier) ?? textOrNull(other.specifics?.public_identifier),
    profileUrl: textOrNull(other.profile_url),
    name: textOrNull(other.name),
  });
  return ref.ids.length > 0 || ref.slug ? ref : null;
}

/** Autre participant d'une conversation, lu auprès du prestataire ; null si illisible. */
async function fetchChatOtherParticipant(
  uCreds: { apiKey: string; dsn: string },
  chatId: string,
): Promise<CandidateRef | null> {
  try {
    const res = await fetchWithTimeout(`${uCreds.dsn}/api/v1/chats/${encodeURIComponent(chatId)}/attendees`, {
      headers: { 'X-API-KEY': uCreds.apiKey },
    });
    if (!res.ok) {
      await res.text(); // consume body
      console.warn(`[unipile-webhook] Own message: chat attendees unavailable (status ${res.status})`);
      return null;
    }
    const body = await res.json();
    const attendees = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
    return otherParticipantRef(attendees);
  } catch (e) {
    console.warn('[unipile-webhook] Own message: chat attendees lookup failed:', e);
    return null;
  }
}

/**
 * Candidat effacé (RGPD, D5) dans cette organisation : son étape n'est plus
 * écrite, comme ses inscriptions ne changent plus. Lecture impossible : levée
 * (l'appelant décide : rejeu pour une réponse, rien pour un message propre).
 */
async function stageErasedFor(supabase: SupabaseClient, organizationId: string, candidate: CandidateRef): Promise<boolean> {
  return await isCandidateErasedForOrg(supabase, {
    organizationId,
    linkedinIds: candidate.ids,
    linkedinUrl: candidate.profile_url ?? (candidate.slug ? `https://www.linkedin.com/in/${candidate.slug}` : null),
  });
}

/**
 * Conversation ou candidat déjà lié à une mission de cette organisation sur
 * ce compte (mission_conversations). Sert au compte relié à plusieurs
 * organisations (état hérité, antérieur à prevent_linkedin_account_cross_tenant).
 * Lecture impossible : levée.
 */
async function missionLinkOnAccount(
  supabase: SupabaseClient,
  organizationId: string,
  accountId: string,
  chatId: string | null | undefined,
  candidateIds: string[],
): Promise<boolean> {
  const ids = candidateIds.map(sanitizeFilterId).filter(Boolean);
  const filters = [
    ...(chatId ? [`chat_id.eq.${sanitizeFilterId(chatId)}`] : []),
    ...(ids.length > 0 ? [`candidate_id.in.(${ids.join(',')})`, `candidate_ids.ov.{${ids.join(',')}}`] : []),
  ];
  if (filters.length === 0) return false;
  const { data, error } = await supabase
    .from('mission_conversations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('account_id', accountId)
    .or(filters.join(','))
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Message écrit depuis le compte du recruteur, dans Konekt ou hors Konekt
 * (plan 0b, décision 5 et section 4.2) : record_own_message dans chaque
 * organisation reliée au compte. Écho d'un envoi Konekt ou note d'invitation :
 * rien ; conversation déjà rattachée : « Contacté » pour un candidat Retenu
 * dans la mission de ce lien seulement ; sinon Retenu dans une seule mission :
 * « Contacté ». Candidat inconnu (format new_message) et conversation sans
 * lien : ses participants sont lus une fois, puis second appel. Compte relié
 * à plusieurs organisations : seules celles où la conversation ou le candidat
 * est déjà lié sur ce compte sont écrites (jamais U-I7), comme pour la
 * réponse. Non bloquant : aucune erreur ne remonte, le webhook répond 200.
 */
async function handleOwnMessage(
  supabase: SupabaseClient,
  uCreds: { apiKey: string; dsn: string },
  accountId: string | undefined,
  chatId: string | undefined,
  messageId: string | null,
  otherParticipant: CandidateRef | null,
): Promise<void> {
  if (!accountId) return;
  try {
    const { data: rows, error } = await supabase
      .from('member_linkedin_accounts')
      .select('organization_id')
      .eq('linkedin_account_id', accountId);
    if (error) {
      console.warn('[unipile-webhook] Own message: linked organizations lookup failed:', error);
      return;
    }
    const orgIds = [...new Set(((rows ?? []) as Array<{ organization_id: string | null }>)
      .map((r) => r.organization_id)
      .filter((org): org is string => !!org))];
    // undefined : participants pas encore lus (une seule lecture pour toutes les organisations).
    let fetched: CandidateRef | null | undefined;
    const sharedAccount = orgIds.length > 1;
    for (const organizationId of orgIds) {
      const call = (candidate: CandidateRef | null) => recordOwnMessage(supabase, {
        organizationId, accountId, chatId: chatId ?? null, messageId, candidate,
      });
      // Candidat effacé (RGPD) dans cette organisation : rien n'est écrit.
      const erased = async (candidate: CandidateRef) => {
        try {
          return await stageErasedFor(supabase, organizationId, candidate);
        } catch (e) {
          console.warn('[unipile-webhook] Own message: erasure check failed, nothing recorded:', e);
          return true;
        }
      };
      if (sharedAccount) {
        try {
          let linked = await missionLinkOnAccount(supabase, organizationId, accountId, chatId, otherParticipant?.ids ?? []);
          if (!linked && !otherParticipant && chatId) {
            if (fetched === undefined) fetched = await fetchChatOtherParticipant(uCreds, chatId);
            if (fetched) linked = await missionLinkOnAccount(supabase, organizationId, accountId, chatId, fetched.ids);
          }
          if (!linked) {
            console.log(`[unipile-webhook] Own message in org ${organizationId}: shared account, no link on it`);
            continue;
          }
        } catch (e) {
          console.warn('[unipile-webhook] Own message: conversation links unreadable, nothing recorded:', e);
          continue;
        }
      }
      if (otherParticipant && await erased(otherParticipant)) continue;
      let result = await call(otherParticipant);
      if (result.ok && result.data.result === 'no_candidate' && !otherParticipant && chatId) {
        if (fetched === undefined) fetched = await fetchChatOtherParticipant(uCreds, chatId);
        if (fetched && !(await erased(fetched))) result = await call(fetched);
      }
      if (result.ok) console.log(`[unipile-webhook] Own message in org ${organizationId}: ${result.data.result}`);
      else console.error('[unipile-webhook] Own message: stage not recorded:', result.fn, result.kind, result.error);
    }
  } catch (e) {
    console.warn('[unipile-webhook] Own message: stage update failed (non-blocking):', e);
  }
}

async function handleNewMessage(supabase: SupabaseClient, payload: WebhookPayload, uCreds: { apiKey: string; dsn: string }, eventKey: string) {
  const { account_id, data } = payload;
  
  // Handle two payload formats:
  // 1. new_message: { data: { message: {...}, chat: {...} } }
  // 2. message_received: { chat_id, sender: {...}, attendees: [...] } (flat, no data)
  
  let chatId: string | undefined;
  let senderId: string | undefined;
  let isSenderSelf: boolean | undefined;
  let senderAttendeeId: string | undefined;
  let needsAttendeeVerification = false;
  // Identifiant du message (même source que la clé de dédoublonnage) : écho d'un envoi Konekt.
  let messageId: string | null = payload.message_id || null;

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
      id?: string;
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
    messageId = messageId || message?.id || null;
  } else {
    console.log('[unipile-webhook] handleNewMessage: Unrecognized payload format, keys:', Object.keys(payload));
    return;
  }
  
  // Skip if this is a message WE sent
  if (isSenderSelf === true) {
    await markChatNotificationsRead(supabase, account_id, chatId);
    // Candidat inconnu ici : celui de la conversation liée, sinon ses participants.
    await handleOwnMessage(supabase, uCreds, account_id, chatId, messageId, null);
    console.log('[unipile-webhook] Skipping - this is our own sent message');
    return;
  }
  
  // For ambiguous cases (is_sender undefined), resolve via chat attendees API.
  // For message_received payloads we fail-closed: if we cannot positively
  // confirm the sender is NOT our own attendee, skip — better to miss a reply
  // than to mark a candidate "Répondu" for our own outbound invitation note.
  // Format new_message sans is_sender (décision 11) : expéditeur non vérifié
  // = échec (500) et rejeu du prestataire, jamais une clôture à l'aveugle.
  if (isSenderSelf === undefined && chatId && senderAttendeeId) {
    let confirmedNotSelf = false;
    // Vérification IMPOSSIBLE (réponse non OK, délai, réseau) ≠ expéditeur
    // confirmé comme nous (SEQ-040) : dans le premier cas, pour le format
    // message_received, on lève pour que le prestataire rejoue l'événement,
    // au lieu d'abandonner la réponse avec un 200.
    let verificationUnavailable: unknown = null;
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
            // Format v1 (message_received) : c'est ici qu'une réponse envoyée
            // depuis LinkedIn (mobile par exemple) est reconnue comme la nôtre.
            // C'est aussi la forme de l'écho de notre note d'invitation.
            await markChatNotificationsRead(supabase, account_id, chatId);
            await handleOwnMessage(supabase, uCreds, account_id, chatId, messageId, otherParticipantRef(attendeeList));
            console.log('[unipile-webhook] Skipping - sender is our own attendee');
            return;
          }
          confirmedNotSelf = true;
        }
      } else {
        await attRes.text(); // consume body
        verificationUnavailable = new Error(`attendee verification unavailable (status ${attRes.status})`);
      }
    } catch (e) {
      console.warn('[unipile-webhook] Failed to verify sender via attendees:', e);
      verificationUnavailable = e;
    }
    if (!confirmedNotSelf) {
      if (verificationUnavailable) {
        console.error('[unipile-webhook] Sender verification unavailable — event will be retried');
        throw verificationUnavailable instanceof Error
          ? verificationUnavailable
          : new Error('attendee verification unavailable');
      }
      if (!needsAttendeeVerification) {
        console.error('[unipile-webhook] new_message: no own attendee to verify the sender — event will be retried');
        throw new Error('new_message sender not verifiable (no own attendee)');
      }
      // Réponse OK sans participant « nous » identifiable : cas persistant, un
      // rejeu échouerait de même. Échec fermé comme avant.
      console.log('[unipile-webhook] Skipping - cannot confirm sender is not self (fail-closed for message_received)');
      return;
    }
  } else if (needsAttendeeVerification) {
    // message_received without chat_id or sender.attendee_id → cannot verify
    console.log('[unipile-webhook] Skipping - message_received missing fields needed to verify sender');
    return;
  } else if (isSenderSelf === undefined) {
    console.error('[unipile-webhook] new_message without sender indication nor fields to verify it — event will be retried');
    throw new Error('new_message sender not verifiable (no is_sender, chat or sender attendee)');
  }
  
  if (!senderId) {
    console.log('[unipile-webhook] No sender ID found in payload');
    return;
  }

  console.log('[unipile-webhook] Message from:', senderId, '| Chat:', chatId, '| Account:', account_id);

  // Inscriptions de ce candidat sur ce compte, actives OU en pause (SEQ-012 :
  // une réponse reçue pendant une pause était ignorée, et la reprise relançait
  // le candidat qui avait déjà répondu). Rattachement exact d'abord, puis repli
  // sur profile_url, puis identifiants alternatifs résolus auprès du
  // prestataire (SEQ-110 : InMail envoyé sur un identifiant Recruiter, réponse
  // reçue d'un identifiant classique).
  // LinkedIn IDs can come in different formats: "AEMAABl08fo...", "ACo...", "urn:li:member:..."
  let enrollments: SequenceEnrollment[] = [];
  const safeSenderId = sanitizeFilterId(senderId);

  const { rows: exactMatch, error: exactError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
    (column) => supabase
      .from('sequence_enrollments')
      .select('*')
      .eq(column, account_id)
      .in('status', OPEN_ENROLLMENT_STATUSES)
      .or(`profile_id.eq.${safeSenderId},resolved_profile_id.eq.${safeSenderId},provider_id.eq.${safeSenderId}`),
  );
  // Lecture impossible : on lève (catch global → 500 → rejeu, SEQ-040).
  if (exactError) throw exactError;

  if (exactMatch && exactMatch.length > 0) {
    enrollments = exactMatch;
  } else {
    // Try matching by profile URL containing the sender ID (for cases where format differs)
    const { rows: urlMatch, error: urlError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
      (column) => supabase
        .from('sequence_enrollments')
        .select('*')
        .eq(column, account_id)
        .in('status', OPEN_ENROLLMENT_STATUSES)
        .like('profile_url', `%${safeSenderId}%`),
    );
    if (urlError) throw urlError;
    if (urlMatch && urlMatch.length > 0) {
      enrollments = urlMatch;
      console.log('[unipile-webhook] Matched via profile_url fallback');
    }
  }

  // Identifiants alternatifs du candidat (résolus une seule fois, réutilisés
  // pour l'arrêt de ses autres inscriptions et la file InMail plus bas).
  // Best-effort : un échec n'empêche pas la suite, le contrôle avant envoi du
  // moteur reste le filet.
  let senderAltIds: string[] | null = null;
  let senderPublicIdentifier: string | null = null;
  const resolveSenderAltIds = async (): Promise<string[]> => {
    if (senderAltIds) return senderAltIds;
    senderAltIds = [];
    try {
      const userRes = await fetchWithTimeout(`${uCreds.dsn}/api/v1/users/${encodeURIComponent(senderId as string)}?account_id=${encodeURIComponent(account_id)}`, {
        headers: { 'X-API-KEY': uCreds.apiKey },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        const altIds = new Set<string>();
        for (const candidate of [userData?.provider_id, userData?.id, userData?.profile?.provider_id]) {
          if (typeof candidate === 'string' && candidate && candidate !== senderId) altIds.add(candidate);
        }
        senderAltIds = [...altIds];
        if (typeof userData?.public_identifier === 'string' && userData.public_identifier) {
          senderPublicIdentifier = userData.public_identifier.toLowerCase();
        }
        if (senderAltIds.length > 0) console.log(`[unipile-webhook] Resolved sender ${senderId} → alt IDs:`, senderAltIds);
      } else {
        await userRes.text(); // consume body
      }
    } catch (e) {
      console.warn('[unipile-webhook] Failed to resolve sender alternative IDs:', e);
    }
    return senderAltIds;
  };

  if (enrollments.length === 0) {
    const altIds = (await resolveSenderAltIds()).map(sanitizeFilterId).filter(Boolean);
    if (altIds.length > 0) {
      const list = altIds.join(',');
      const { rows: altMatch, error: altError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', OPEN_ENROLLMENT_STATUSES)
          .or(`profile_id.in.(${list}),resolved_profile_id.in.(${list}),provider_id.in.(${list})`),
      );
      if (altError) throw altError;
      enrollments = altMatch;
    }
    const slug = senderPublicIdentifier as string | null;
    if (enrollments.length === 0 && slug) {
      const escapedSlug = slug.replace(/([%_\\])/g, '\\$1');
      const { rows: slugMatch, error: slugError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', OPEN_ENROLLMENT_STATUSES)
          .ilike('profile_url', `%/in/${escapedSlug}%`),
      );
      if (slugError) throw slugError;
      // Slug exact (le motif ilike accepte « marie-martin-4b2a1 » pour « marie-martin »).
      enrollments = slugMatch.filter((e) => linkedInSlugOf(e.profile_url) === slug);
    }
    if (enrollments.length > 0) console.log('[unipile-webhook] Matched via resolved sender identifiers');
  }

  // Inscriptions réellement closes par CE traitement (réponse comptée une fois).
  const closedEnrollments: SequenceEnrollment[] = [];
  const failures: unknown[] = [];
  // Clôture « A répondu » depuis `fromStatuses` : inscription ouverte, ou
  // terminée (décision 8, plus bas ; sa date de fin est gardée).
  const recordReply = async (enrollment: SequenceEnrollment, fromStatuses: string[]) => {
    const nowIso = new Date().toISOString();
    // Clôture conditionnée au statut (SEQ-191) : si le moteur l'a déjà close,
    // aucune ligne ne change et la réponse n'est pas recomptée.
    const { data: changed, error: updateError } = await supabase
      .from('sequence_enrollments')
      .update({
        status: 'replied',
        replied_at: nowIso,
        updated_at: nowIso,
        pause_reason: null,
        // Identifiant classique mémorisé (SEQ-110) : les prochains
        // rattachements et le contrôle avant envoi le trouvent directement.
        ...(!enrollment.resolved_profile_id && enrollment.profile_id !== senderId ? { resolved_profile_id: senderId } : {}),
      })
      .eq('id', enrollment.id)
      .in('status', fromStatuses)
      .select('id');

    if (updateError) {
      failures.push(updateError);
      return;
    }

    // Cancel any pending step executions — TOUS les statuts pendants, pas
    // seulement 'scheduled' (audit 2026-07, Delivery M6). Fait aussi quand
    // l'inscription était déjà close (aucune ligne changée) : elle est alors
    // terminale et ne doit plus rien avoir en attente (rejeu idempotent).
    // Un échec est remonté (500, rejeu) sans sauter le compte de la réponse
    // de la clôture effective : le rejeu ne retrouve plus l'inscription parmi
    // les ouvertes, et les étapes restées en attente ne partent jamais
    // (contrôle avant envoi du moteur, SEQ-189).
    const { error: cancelError } = await supabase
      .from('sequence_step_executions')
      .update({
        status: 'cancelled',
        skip_reason: 'Reply detected via webhook',
        updated_at: nowIso,
      })
      .eq('enrollment_id', enrollment.id)
      .in('status', PENDING_EXECUTION_STATUSES);
    if (cancelError) failures.push(cancelError);

    if (!changed || changed.length === 0) return;
    closedEnrollments.push(enrollment);

    // Log analytics — incrément atomique (cf. increment_sequence_analytics)
    await supabase.rpc('increment_sequence_analytics', {
      p_sequence_id: enrollment.sequence_id,
      p_field: 'replies_received',
    });

    console.log('[unipile-webhook] Enrollment', enrollment.id, 'marked as replied');
    // Étape du candidat : plus bas, pour tout message du candidat (rejeu compris).
  };
  if (enrollments.length === 0) {
    console.log('[unipile-webhook] No open enrollments found for sender:', senderId);
  } else {
    // Extra validation: log the matched profiles to help debug false positives
    console.log(`[unipile-webhook] Found ${enrollments.length} enrollment(s) - marking as replied:`, 
      enrollments.map(e => ({ id: e.id, profile_id: e.profile_id })));
    for (const enrollment of enrollments) await recordReply(enrollment, OPEN_ENROLLMENT_STATUSES);
  }

  // Identifiants alternatifs résolus aussi quand le rattachement exact a
  // réussi : l'inscription du candidat sous son identifiant Recruiter, sur le
  // compte d'un collègue, fait partie de celles à arrêter plus bas (SEQ-212).
  const resolvedAltIds = await resolveSenderAltIds();

  // Aucune inscription ouverte : message reçu sur une inscription déjà close
  // de ce compte (terminée ; déjà « répondu » par le moteur, ou par un premier
  // passage dont l'arrêt des autres inscriptions a échoué, rejoué ici). Elle
  // rattache le candidat à son organisation pour l'arrêt plus bas. Déjà
  // « répondu » : rien ne change, la réponse n'est pas recomptée (SEQ-191).
  // Terminée : réponse à la dernière relance (décision 8, plus bas).
  let closedAnchors: SequenceEnrollment[] = [];
  if (enrollments.length === 0 && safeSenderId) {
    const idList = [safeSenderId, ...resolvedAltIds.map(sanitizeFilterId)].filter(Boolean).join(',');
    const byId = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
      (column) => supabase
        .from('sequence_enrollments')
        .select('*')
        .eq(column, account_id)
        .in('status', REPLY_CLOSED_ENROLLMENT_STATUSES)
        .or(`profile_id.in.(${idList}),resolved_profile_id.in.(${idList}),provider_id.in.(${idList})`),
    );
    if (byId.error) throw byId.error;
    closedAnchors = byId.rows;
    if (closedAnchors.length === 0) {
      const byUrl = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', REPLY_CLOSED_ENROLLMENT_STATUSES)
          .like('profile_url', `%${safeSenderId}%`),
      );
      if (byUrl.error) throw byUrl.error;
      closedAnchors = byUrl.rows;
    }
    const slug = senderPublicIdentifier as string | null;
    if (closedAnchors.length === 0 && slug) {
      const bySlug = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', REPLY_CLOSED_ENROLLMENT_STATUSES)
          .ilike('profile_url', `%/in/${slug.replace(/([%_\\])/g, '\\$1')}%`),
      );
      if (bySlug.error) throw bySlug.error;
      closedAnchors = bySlug.rows.filter((e) => linkedInSlugOf(e.profile_url) === slug);
    }
    if (closedAnchors.length > 0) console.log(`[unipile-webhook] Message on ${closedAnchors.length} closed enrollment(s)`);
  }

  // Décision 8 : la plus récente inscription close de ce compte, si elle est
  // terminée, passe « A répondu » (réponse comptée),
  // comme « Marquer comme répondu ». Clôture conditionnée à 'completed'.
  for (const enrollment of lateReplyEnrollments(closedAnchors)) await recordReply(enrollment, ['completed']);

  // Also update inmail_queue entries for this sender (for ATS tracking).
  // Limité au compte qui reçoit la réponse (SEQ-111) : un InMail du même
  // candidat envoyé par un autre compte, ou une autre organisation, n'est pas
  // une réponse à celui-là. Les InMails déjà « répondu » sont relus aussi : ils
  // rattachent le candidat à son organisation (rejeu). Lecture impossible :
  // levée (500, rejeu) ; marquage non bloquant.
  // Identifiant exact et identifiants alternatifs lus ensemble : InMails
  // envoyés sur un identifiant AEM…, réponses reçues d'un ACo… (ou l'inverse),
  // et un ancien InMail « répondu » sur l'un ne masque pas un InMail « envoyé »
  // sur l'autre (SEQ-110, SEQ-212).
  type InMailMatch = { id: string; recipient_profile_id: string; organization_id: string | null; status: string; updated_at: string };
  const { data: inmailRows, error: inmailLookupError } = await supabase
    .from('inmail_queue')
    .select('id, recipient_profile_id, organization_id, status, updated_at')
    .eq('account_id', account_id)
    .in('status', ['sent', 'replied'])
    .in('recipient_profile_id', [senderId, ...resolvedAltIds]);
  if (inmailLookupError) {
    console.warn('[unipile-webhook] inmail lookup failed:', inmailLookupError);
    failures.push(inmailLookupError);
  }
  const inmailMatches = inmailRows as InMailMatch[] | null;

  const sentInmails = (inmailMatches ?? []).filter((m) => m.status === 'sent');
  if (sentInmails.length > 0) {
    console.log(`[unipile-webhook] Marking ${sentInmails.length} inmail_queue entries as replied`);
    const inmailIds = sentInmails.map(m => m.id);
    const { error: inmailUpdateError } = await supabase
      .from('inmail_queue')
      .update({
        status: 'replied',
        updated_at: new Date().toISOString(),
      })
      .in('id', inmailIds)
      .eq('status', 'sent');
    if (inmailUpdateError) console.warn('[unipile-webhook] inmail replied update failed:', inmailUpdateError);
  }

  // Même candidat ailleurs dans l'organisation (SEQ-212) : autres inscriptions
  // arrêtées, InMails pas encore partis annulés. Organisations : celles des
  // inscriptions et des InMails de ce compte auxquels le message se rattache,
  // jamais une organisation sans contact avec lui (compte relié à plusieurs
  // organisations, SEQ-006). Portée bornée quand le contact était déjà clos
  // (replySiblingScope, contrat §8).
  const anchorsByOrg = new Map<string, ReplyAnchor[]>();
  const addAnchor = (orgId: string | null | undefined, anchor: ReplyAnchor) => {
    if (orgId) anchorsByOrg.set(orgId, [...(anchorsByOrg.get(orgId) ?? []), anchor]);
  };
  for (const e of enrollments) addAnchor(e.organization_id, { live: true });
  // Fin du contact clos : date de fin gardée par une inscription terminée puis
  // « répondu » (décision 8), aussi au rejeu (closedContactEnd).
  for (const e of closedAnchors) addAnchor(e.organization_id, { live: false, endedAt: closedContactEnd(e) });
  for (const m of inmailMatches ?? []) addAnchor(m.organization_id, m.status === 'sent' ? { live: true } : { live: false, endedAt: m.updated_at });

  const anchorRows = [...enrollments, ...closedAnchors];
  const candidate = {
    ids: [
      senderId, ...resolvedAltIds,
      ...anchorRows.flatMap((e) => [e.profile_id, e.provider_id, e.resolved_profile_id]),
      ...(inmailMatches ?? []).map((m) => m.recipient_profile_id),
    ],
    slugs: [senderPublicIdentifier, ...anchorRows.map((e) => e.profile_url)],
  };
  const handledIds = new Set(anchorRows.map((e) => e.id));
  // Organisations où l'arrêt a échoué : le recruteur est prévenu (décision 10).
  const stopFailedOrgs = new Set<string>();
  for (const [orgId, anchors] of anchorsByOrg) {
    const scope = replySiblingScope(anchors);
    try {
      await closeSiblingEnrollments(supabase, orgId, candidate, handledIds, scope);
    } catch (siblingError) {
      failures.push(siblingError);
      stopFailedOrgs.add(orgId);
    }
    try {
      await cancelScheduledInMails(supabase, { organizationId: orgId }, candidate.ids, scope);
    } catch (inmailError) {
      failures.push(inmailError);
      stopFailedOrgs.add(orgId);
    }
  }
  // Le compte qui vient de recevoir le message du candidat ne lui envoie pas
  // ensuite l'InMail qu'il avait programmé, même sans autre contact connu.
  let accountInMailsFailed = false;
  try {
    await cancelScheduledInMails(supabase, { accountId: account_id }, candidate.ids);
  } catch (inmailError) {
    failures.push(inmailError);
    accountInMailsFailed = true;
  }

  // Étape du candidat (plan 0b, section 3) : pour tout message confirmé du
  // candidat, avec ou sans inscription, record_candidate_inbound dans chaque
  // organisation du compte et de ses contacts rattachés. Seule la mission
  // résolue change (conversation, profil, inscription, lignes contactées :
  // décision 3). Décision 9 : erreur transitoire → rejeu (500), levé après les
  // notifications ; refus métier ou fonction absente → journal seul. Le rejeu
  // refait l'appel sans effet.
  const { data: memberRows, error: membersReadError } = await supabase
    .from('member_linkedin_accounts')
    .select('user_id, organization_id')
    .eq('linkedin_account_id', account_id);
  if (membersReadError) failures.push(membersReadError);
  const linkedMembers = (memberRows ?? []) as Array<{ user_id: string; organization_id: string | null }>;
  const stageCandidate = candidateRef({ ids: candidate.ids, slug: candidateSlugs(candidate.slugs)[0] ?? null });
  const stageOrgIds = [...new Set([...linkedMembers.map((m) => m.organization_id), ...anchorsByOrg.keys()]
    .filter((org): org is string => !!org))];
  const missionByOrg = new Map<string, string>();
  const stageFailures: Error[] = [];
  // Compte relié à plusieurs organisations (état hérité, antérieur à
  // prevent_linkedin_account_cross_tenant) : une organisation sans contact
  // rattaché sur ce compte (inscription, InMail) n'est écrite que si la
  // conversation ou le candidat y est déjà lié à une mission sur ce compte.
  // Sinon ses lignes contactées depuis un autre compte ne deviennent pas la
  // cible d'une réponse reçue ici.
  const sharedAccount = new Set(linkedMembers.map((m) => m.organization_id).filter(Boolean)).size > 1;
  const linkedOnAccount = (orgId: string): Promise<boolean> =>
    missionLinkOnAccount(supabase, orgId, account_id, chatId, stageCandidate.ids);
  for (const orgId of stageOrgIds) {
    if (sharedAccount && !anchorsByOrg.has(orgId)) {
      try {
        if (!(await linkedOnAccount(orgId))) {
          console.log(`[unipile-webhook] Reply stage skipped in org ${orgId}: shared account, no contact on it`);
          continue;
        }
      } catch (e) {
        console.error('[unipile-webhook] Reply stage: conversation links unreadable:', e);
        stageFailures.push(e instanceof Error ? e : new Error(String(e)));
        continue;
      }
    }
    // Candidat effacé (RGPD) dans cette organisation : aucune étape (D5).
    // Registre illisible : rejeu, comme une erreur transitoire.
    try {
      if (await stageErasedFor(supabase, orgId, stageCandidate)) {
        console.log(`[unipile-webhook] Reply stage skipped in org ${orgId}: candidate erased`);
        continue;
      }
    } catch (e) {
      console.error('[unipile-webhook] Reply stage: erasure check failed:', e);
      stageFailures.push(e instanceof Error ? e : new Error(String(e)));
      continue;
    }
    const inbound = await recordInbound(supabase, {
      organizationId: orgId,
      accountId: account_id,
      candidate: stageCandidate,
      chatId: chatId ?? null,
      enrollmentIds: anchorRows.filter((e) => e.organization_id === orgId).map((e) => e.id),
    });
    if (inbound.ok) {
      if (inbound.data.project_id) missionByOrg.set(orgId, inbound.data.project_id);
      console.log(`[unipile-webhook] Reply stage in org ${orgId}:`,
        inbound.data.project_id ?? ('reason' in inbound.data ? inbound.data.reason : null));
      continue;
    }
    console.error('[unipile-webhook] Reply stage not recorded:', inbound.fn, inbound.kind, inbound.error);
    if (inbound.kind === 'transient') stageFailures.push(new Error(`${inbound.fn}: ${inbound.error.message}`));
  }

  if (failures.length > 0) {
    console.error(`[unipile-webhook] new_message: ${failures.length} write(s) failed:`, failures[0]);
    if (stopFailedOrgs.size > 0 || accountInMailsFailed) {
      // Destinataires : membres reliés au compte qui a reçu la réponse et
      // auteurs des inscriptions auxquelles elle se rattache, par organisation.
      const { data: accountMembers, error: membersError } = await supabase
        .from('member_linkedin_accounts')
        .select('user_id, organization_id')
        .eq('linkedin_account_id', account_id);
      if (membersError) console.warn('[unipile-webhook] sibling stop alert: linked members lookup failed:', membersError);
      const members = (accountMembers ?? []) as Array<{ user_id: string; organization_id: string | null }>;
      if (accountInMailsFailed) for (const m of members) if (m.organization_id) stopFailedOrgs.add(m.organization_id);
      await alertSiblingStopFailure(supabase, eventKey, [...stopFailedOrgs].map((orgId) => {
        const orgRows = anchorRows.filter((e) => e.organization_id === orgId);
        return {
          organizationId: orgId,
          userIds: [...members.filter((m) => m.organization_id === orgId).map((m) => m.user_id), ...orgRows.map((e) => e.created_by)],
          candidateName: orgRows[0]?.profile_name || payload.sender?.attendee_name || null,
          sequenceId: orgRows[0]?.sequence_id ?? null,
          enrollmentIds: orgRows.map((e) => e.id),
        };
      }));
    }
    throw failures[0];
  }

  // ── Create notification for new message ──
  // Find the user(s) linked to this LinkedIn account
  const senderName = payload.sender?.attendee_name 
    || (data?.message as any)?.sender?.name 
    || senderId || 'Quelqu\'un';
  // Membres reliés au compte : lus plus haut (étape du candidat).

  // Candidat déjà sorti de la séquence (a déjà répondu, séquence terminée) :
  // aucune inscription ouverte, mais c'est bien un candidat. Lecture seule,
  // pour la notification uniquement : aucun statut n'est modifié. Les
  // inscriptions en pause ne sont plus ici : elles sont closes plus haut.
  let notifEnrollments: SequenceEnrollment[] = enrollments;
  if (notifEnrollments.length === 0 && linkedMembers && linkedMembers.length > 0) {
    const past = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
      (column) => supabase
        .from('sequence_enrollments')
        .select('*')
        .eq(column, account_id)
        .in('status', ['replied', 'completed'])
        .or(`profile_id.eq.${safeSenderId},resolved_profile_id.eq.${safeSenderId}`)
        .order('updated_at', { ascending: false })
        .limit(5),
    );
    if (past.error) console.warn('[unipile-webhook] Past enrollments lookup failed:', past.error);
    notifEnrollments = past.rows ?? [];
    // Même repli que la recherche active : identifiant présent seulement dans profile_url.
    if (notifEnrollments.length === 0 && !past.error) {
      const pastByUrl = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', ['replied', 'completed'])
          .like('profile_url', `%${safeSenderId}%`)
          .order('updated_at', { ascending: false })
          .limit(5),
      );
      if (pastByUrl.error) console.warn('[unipile-webhook] Past enrollments lookup (url) failed:', pastByUrl.error);
      notifEnrollments = pastByUrl.rows ?? [];
    }
  }

  // Mission des séquences concernées : outreach_sequences.project_id (clé
  // étrangère vers sourcing_projects), nul pour une séquence globale.
  // enrollment.job_id n'est pas utilisé : il vaut tantôt sourcing_projects.id,
  // tantôt sourcing_projects.job_id.
  const projectBySequence = new Map<string, string>();
  if (linkedMembers && linkedMembers.length > 0 && notifEnrollments.length > 0) {
    const sequenceIds = [...new Set(notifEnrollments.map(e => e.sequence_id).filter(Boolean))];
    const { data: sequences, error: sequencesError } = await supabase
      .from('outreach_sequences')
      .select('id, project_id')
      .in('id', sequenceIds);
    if (sequencesError) console.warn('[unipile-webhook] Could not load sequence missions:', sequencesError);
    for (const s of (sequences ?? []) as Array<{ id: string; project_id: string | null }>) {
      if (s.project_id) projectBySequence.set(s.id, s.project_id);
    }
  }

  // Rejeu après une écriture de l'étape en échec transitoire (levée plus bas,
  // après les notifications) : la notification du premier passage n'est pas
  // doublée. Lecture impossible : notification envoyée (doublon plutôt qu'oubli).
  const alreadyNotified = new Set<string>();
  if (linkedMembers.length > 0) {
    const { data: notified, error: notifiedError } = await supabase
      .from('notifications')
      .select('user_id, organization_id')
      .eq('type', 'new_message')
      .eq('metadata->>event_key', eventKey)
      .in('user_id', [...new Set(linkedMembers.map((m) => m.user_id))]);
    if (notifiedError) console.warn('[unipile-webhook] Replayed notification lookup failed:', notifiedError);
    for (const n of (notified ?? []) as Array<{ user_id: string; organization_id: string | null }>) {
      alreadyNotified.add(`${n.user_id}:${n.organization_id}`);
    }
  }

  if (linkedMembers && linkedMembers.length > 0) {
    for (const member of linkedMembers) {
      if (alreadyNotified.has(`${member.user_id}:${member.organization_id}`)) continue;
      // Inscriptions de l'org du destinataire uniquement (même compte LinkedIn
      // rattaché à plusieurs orgs), comme pour job_candidate_status plus haut.
      const memberEnrollments = notifEnrollments.filter(e => !e.organization_id || e.organization_id === member.organization_id);
      const primary = memberEnrollments[0];
      const candidateName = primary?.profile_name || senderName;
      // Mission de la séquence, sinon celle résolue pour l'étape (décision 17).
      const projectId = (primary ? projectBySequence.get(primary.sequence_id) : undefined)
        ?? (member.organization_id ? missionByOrg.get(member.organization_id) : undefined);
      const metadata: Record<string, unknown> = {
        ...(chatId ? { chat_id: chatId } : {}),
        is_candidate: !!primary,
        ...(primary ? {
          enrollment_id: primary.id,
          enrollment_ids: memberEnrollments.map(e => e.id),
          sequence_id: primary.sequence_id,
          profile_name: primary.profile_name ?? null,
          profile_headline: primary.profile_headline ?? null,
        } : {}),
        ...(projectId ? { project_id: projectId } : {}),
        event_key: eventKey,
      };
      await supabase
        .from('notifications')
        .insert({
          user_id: member.user_id,
          organization_id: member.organization_id,
          type: 'new_message',
          title: `Nouveau message de ${candidateName}`,
          body: chatId ? `Vous avez reçu un nouveau message LinkedIn` : null,
          // /outreach est une route legacy (redirigée vers /missions, query perdue).
          link: chatId ? `/inbox?chatId=${encodeURIComponent(chatId)}` : '/inbox',
          metadata,
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

  // Analyse et indexation : une fois par événement, au premier passage qui
  // atteint les notifications, même si l'étape du candidat doit être rejouée
  // (un échec persistant de l'étape ne les perd pas). Au rejeu, la
  // notification existe déjà : pas de seconde analyse facturée. Sans membre
  // relié (rien pour repérer le rejeu) : au passage réussi seulement.
  const firstPass = linkedMembers.length > 0 ? alreadyNotified.size === 0 : stageFailures.length === 0;
  if (firstPass) {
    // ── Trigger auto-analysis for intent detection & status update ──
    if (chatId) {
      console.log(`[unipile-webhook] Triggering auto-analyze for chat: ${chatId}`);
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      // Clé service-role (auto-analyze-message rejette la clé anon en 401) +
      // organization_id du compte (linkedMembers chargé ci-dessus) pour les créds
      // par org et l'imputation des crédits.
      const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
      const autoAnalyzeOrgId = linkedMembers?.[0]?.organization_id ?? null;
    
      // Fire-and-forget: don't await to keep webhook fast. Timeout 55 s :
      // auto-analyze attend désormais analyze-response (jusqu'à ~50 s).
      fetchWithTimeout(`${supabaseUrl}/functions/v1/auto-analyze-message`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          account_id: account_id,
          sender_id: senderId,
          organization_id: autoAnalyzeOrgId,
          // Étape écrite dans chaque organisation admise : pas de rattrapage.
          stage_recorded: stageFailures.length === 0,
        }),
      }, 55000).then(res => {
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

  // Étape du candidat en échec transitoire (décision 9) : rejeu (500), après
  // les notifications, l'analyse et l'indexation.
  if (stageFailures.length > 0) {
    console.error(`[unipile-webhook] new_message: ${stageFailures.length} reply stage write(s) failed, event will be retried:`, stageFailures[0]);
    throw stageFailures[0];
  }
}

/** Valeur d'un en-tête du message (tableau {name, value} ou objet), si la charge utile les expose. */
function readMailHeader(payload: WebhookPayload, name: string): string | null {
  const headers = payload.headers;
  const wanted = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (header && typeof header.name === 'string' && header.name.toLowerCase() === wanted) {
        return header.value === undefined || header.value === null ? '' : String(header.value);
      }
    }
    return null;
  }
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== wanted) continue;
      if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : '';
      return value === undefined || value === null ? '' : String(value);
    }
  }
  return null;
}

// Réponses automatiques (absence, répondeur) : ni une réponse du candidat, ni
// un rebond. SEQ-113 : le préfixe standard d'Outlook en anglais, « Automatic
// reply: », et ses équivalents allemand, espagnol, italien n'étaient pas
// reconnus : la séquence s'arrêtait et le candidat passait « Répondu ».
const AUTO_REPLY_SUBJECT_MARKERS = [
  'auto-reply', 'autoreply', 'auto reply', 'automatic reply', 'out of office',
  'absence du bureau', 'absent du bureau', 'réponse automatique',
  'automatische antwort', 'respuesta automática', 'risposta automatica',
];
const AUTOMATED_SENDER_PREFIXES = ['no-reply@', 'noreply@', 'do-not-reply@', 'donotreply@', 'mailer@'];

function isAutoReplyMail(payload: WebhookPayload, subjectLower: string, senderEmail: string): boolean {
  if (AUTO_REPLY_SUBJECT_MARKERS.some((marker) => subjectLower.includes(marker))) return true;
  if (AUTOMATED_SENDER_PREFIXES.some((prefix) => senderEmail.startsWith(prefix))) return true;
  // En-têtes normalisés (RFC 3834) quand la charge utile les fournit.
  const autoSubmitted = readMailHeader(payload, 'auto-submitted');
  if (autoSubmitted !== null && autoSubmitted.trim().toLowerCase() !== 'no') return true;
  if (readMailHeader(payload, 'x-autoreply') !== null) return true;
  if (readMailHeader(payload, 'x-autorespond') !== null) return true;
  return false;
}

/** Organisation(s) de la boîte mail qui reçoit (member_email_accounts). Lève en cas d'erreur de lecture. */
async function resolveMailboxOrganizations(supabase: SupabaseClient, accountId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('member_email_accounts')
    .select('organization_id')
    .eq('email_account_id', accountId);
  if (error) throw error;
  return [...new Set(((data ?? []) as Array<{ organization_id: string | null }>)
    .map((row) => row.organization_id)
    .filter((org): org is string => !!org))];
}

interface MailEnrollment {
  id: string;
  sequence_id: string;
  profile_id: string | null;
  provider_id: string | null;
  resolved_profile_id: string | null;
  account_id: string;
  email_used: string | null;
  organization_id: string | null;
  created_by: string | null;
  profile_name: string | null;
  profile_headline: string | null;
  profile_url: string | null;
  job_id: string | null;
  status: string;
}
const MAIL_ENROLLMENT_COLUMNS =
  'id, sequence_id, profile_id, provider_id, resolved_profile_id, account_id, email_used, organization_id, created_by, profile_name, profile_headline, profile_url, job_id, status';

/** Échappe les jokers SQL d'une adresse pour un ilike exact. */
const escapeLike = (value: string) => value.replace(/([%_\\])/g, '\\$1');

/**
 * Inscriptions ouvertes portant cette adresse. Portée : l'organisation de la
 * boîte qui reçoit (SEQ-039 : comparer au compte d'inscription, un compte
 * LinkedIn, ne rattachait jamais rien) ; repli sur le compte quand la boîte
 * n'est pas connue.
 */
async function findOpenEnrollmentsByEmail(
  supabase: SupabaseClient,
  accountId: string,
  mailboxOrgs: string[],
  email: string,
  statuses: string[] = OPEN_ENROLLMENT_STATUSES,
): Promise<MailEnrollment[]> {
  if (mailboxOrgs.length > 0) {
    const { data, error } = await supabase
      .from('sequence_enrollments')
      .select(MAIL_ENROLLMENT_COLUMNS)
      .in('organization_id', mailboxOrgs)
      .in('status', statuses)
      .ilike('email_used', escapeLike(email));
    if (error) throw error;
    return (data ?? []) as MailEnrollment[];
  }
  const { rows, error } = await findEnrollmentsBySenderAccount<MailEnrollment>(
    (column) => supabase
      .from('sequence_enrollments')
      .select(MAIL_ENROLLMENT_COLUMNS)
      .eq(column, accountId)
      .in('status', statuses)
      .ilike('email_used', escapeLike(email)),
  );
  if (error) throw error;
  return rows;
}

/**
 * Handler pour les emails reçus (Unipile event `mail_received`).
 * Détecte si l'email entrant est une réponse à une étape de séquence email
 * et stoppe les étapes restantes de la séquence pour ce candidat.
 *
 * Stratégie de matching :
 *   1. Le message auquel il répond (in_reply_to) est retrouvé dans
 *      sequence_email_tracking : exécution, puis inscription. Indépendant du
 *      compte et de l'adresse (alias, réponse depuis une autre adresse).
 *   2. Sinon, l'adresse de l'expéditeur (from_attendee.identifier) est
 *      comparée à email_used, dans l'organisation de la boîte qui reçoit.
 *   3. Inscriptions actives OU en pause : clôture 'replied', étapes en
 *      attente annulées, réponse comptée une fois, étape « A répondu »
 *      dans la mission de l'inscription,
 *      recruteur prévenu, inscriptions du même candidat sur les autres
 *      comptes de l'organisation arrêtées.
 *
 * Une lecture ou une écriture en échec lève : le catch global purge la
 * dédup et répond 500, le prestataire rejoue (SEQ-040).
 */
async function handleNewMail(supabase: SupabaseClient, payload: WebhookPayload, eventKey: string) {
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
  // Status Notification") signale une adresse morte : l'inscription est
  // arrêtée et l'adresse supprimée des envois (handleBounce).
  const isBounce =
    senderEmail.startsWith('mailer-daemon@') ||
    senderEmail.startsWith('postmaster@') ||
    /undeliverable|delivery status notification|delivery has failed|mail delivery (failed|subsystem)|returned mail|failure notice|delivery failure|delivery incomplete/i.test(subjectLower);

  if (isBounce) {
    await handleBounce(supabase, account_id, payload, senderEmail);
    return;
  }

  // Skip auto-replies (out-of-office, etc.) — ni réponse ni bounce.
  if (isAutoReplyMail(payload, subjectLower, senderEmail)) {
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

  const mailboxOrgs = await resolveMailboxOrganizations(supabase, account_id);

  // 1. Rattachement par le message d'origine (in_reply_to), normalisé par la
  //    règle partagée avec sequence-webhooks-handler (chaîne ou objet
  //    { message_id, id }, avec et sans chevrons). email_message_id contient
  //    l'identifiant renvoyé à l'envoi, ou le marqueur konekt-sent:<tracking_id>
  //    qui ne correspond à aucune réponse : le repli par adresse (2.) reste
  //    nécessaire.
  let enrollments: MailEnrollment[] = [];
  const repliedToIds = inReplyToCandidates(payload.in_reply_to);
  if (repliedToIds.length > 0) {
    const { data: tracked, error: trackedError } = await supabase
      .from('sequence_email_tracking')
      .select('execution_id')
      .in('email_message_id', repliedToIds);
    if (trackedError) throw trackedError;
    const executionIds = [...new Set(((tracked ?? []) as Array<{ execution_id: string | null }>)
      .map((t) => t.execution_id)
      .filter((id): id is string => !!id))];
    if (executionIds.length > 0) {
      const { data: executions, error: executionsError } = await supabase
        .from('sequence_step_executions')
        .select('enrollment_id')
        .in('id', executionIds);
      if (executionsError) throw executionsError;
      const enrollmentIds = [...new Set(((executions ?? []) as Array<{ enrollment_id: string | null }>)
        .map((e) => e.enrollment_id)
        .filter((id): id is string => !!id))];
      if (enrollmentIds.length > 0) {
        let byThread = supabase
          .from('sequence_enrollments')
          .select(MAIL_ENROLLMENT_COLUMNS)
          .in('id', enrollmentIds)
          .in('status', OPEN_ENROLLMENT_STATUSES);
        // Une boîte connue ne clôt que des inscriptions de son organisation.
        if (mailboxOrgs.length > 0) byThread = byThread.in('organization_id', mailboxOrgs);
        const { data: threadRows, error: threadError } = await byThread;
        if (threadError) throw threadError;
        enrollments = (threadRows ?? []) as MailEnrollment[];
        if (enrollments.length > 0) console.log('[unipile-webhook][mail] Matched via in_reply_to');
      }
    }
  }

  // 2. Repli : adresse de l'expéditeur, dans l'organisation de la boîte.
  if (enrollments.length === 0) {
    enrollments = await findOpenEnrollmentsByEmail(supabase, account_id, mailboxOrgs, senderEmail);
  }

  if (enrollments.length === 0) {
    console.log('[unipile-webhook][mail] No open enrollment matched for', senderEmail);
    return;
  }

  console.log(`[unipile-webhook][mail] Matched ${enrollments.length} enrollment(s)`);

  // 3. Clôture 'replied' (active ou en pause) + étapes en attente annulées.
  const failures: unknown[] = [];
  const closed: MailEnrollment[] = [];
  // Mission où l'étape du candidat a été écrite, pour la notification (décision 17).
  const missionByEnrollment = new Map<string, string>();
  for (const enrollment of enrollments) {
    const nowIso = new Date().toISOString();
    const { data: changed, error: updErr } = await supabase
      .from('sequence_enrollments')
      .update({
        status: 'replied',
        replied_at: nowIso,
        updated_at: nowIso,
        pause_reason: null,
      })
      .eq('id', enrollment.id)
      .in('status', OPEN_ENROLLMENT_STATUSES)
      .select('id');

    if (updErr) {
      failures.push(updErr);
      continue;
    }

    // Tous les statuts pendants, y compris quand l'inscription était déjà
    // close entre-temps (elle est alors terminale). Un échec est remonté
    // (500, rejeu) sans sauter le compte ni le pipeline de la clôture
    // effective, comme sur le canal LinkedIn.
    const { error: cancelError } = await supabase
      .from('sequence_step_executions')
      .update({
        status: 'cancelled',
        skip_reason: 'Email reply detected via webhook',
        updated_at: nowIso,
      })
      .eq('enrollment_id', enrollment.id)
      .in('status', PENDING_EXECUTION_STATUSES);
    if (cancelError) failures.push(cancelError);

    // Réponse comptée une seule fois (SEQ-191) : seulement si CE traitement a clos l'inscription.
    if (!changed || changed.length === 0) continue;
    closed.push(enrollment);

    // Incrément atomique (cf. increment_sequence_analytics)
    await supabase.rpc('increment_sequence_analytics', {
      p_sequence_id: enrollment.sequence_id,
      p_field: 'replies_received',
    });

    // Étape du candidat (plan 0b, décision 4) : réponse vue par l'inscription,
    // sans conversation, donc la mission de l'inscription d'abord ; une ligne
    // À trier ou Retenu ne passe « A répondu » que si un envoi Konekt y est
    // prouvé (décision 13). Le rejeu ne retrouve plus l'inscription close et
    // ne referait pas l'écriture : une erreur transitoire est retentée une
    // fois ici, puis journalisée sans 500 (résiduel, plan 0b section 11).
    // Refus métier ou fonction absente : journal seul.
    if (!enrollment.organization_id) {
      console.warn('[unipile-webhook][mail] Reply stage not recorded: enrollment without organization');
    } else {
      const recordMailReply = () => recordInbound(supabase, {
        organizationId: enrollment.organization_id as string,
        accountId: null,
        candidate: candidateRef({
          ids: [enrollment.profile_id, enrollment.provider_id, enrollment.resolved_profile_id],
          profileUrl: enrollment.profile_url,
        }),
        chatId: null,
        enrollmentIds: [enrollment.id],
        enrollmentFirst: true,
      });
      let inbound = await recordMailReply();
      if (!inbound.ok && inbound.kind === 'transient') inbound = await recordMailReply();
      if (inbound.ok) {
        if (inbound.data.project_id) missionByEnrollment.set(enrollment.id, inbound.data.project_id);
      } else {
        console.error('[unipile-webhook][mail] Reply stage not recorded:', inbound.fn, inbound.kind, inbound.error);
      }
    }

    console.log('[unipile-webhook][mail] Enrollment', enrollment.id, 'marked replied (email)');
  }

  // 4. Même candidat ailleurs dans l'organisation (SEQ-212) : autres
  //    inscriptions arrêtées, InMails pas encore partis annulés.
  const handledIds = new Set(enrollments.map((e) => e.id));
  const orgIds = [...new Set(enrollments.map((e) => e.organization_id).filter((o): o is string => !!o))];
  const stopFailedOrgs = new Set<string>();
  for (const orgId of orgIds) {
    const orgRows = enrollments.filter((e) => e.organization_id === orgId);
    const candidate = {
      ids: orgRows.flatMap((e) => [e.profile_id, e.provider_id, e.resolved_profile_id]),
      slugs: orgRows.map((e) => e.profile_url),
    };
    try {
      await closeSiblingEnrollments(supabase, orgId, candidate, handledIds);
    } catch (siblingError) {
      failures.push(siblingError);
      stopFailedOrgs.add(orgId);
    }
    try {
      await cancelScheduledInMails(supabase, { organizationId: orgId }, candidate.ids);
    } catch (inmailError) {
      failures.push(inmailError);
      stopFailedOrgs.add(orgId);
    }
  }
  // Décision 10 : arrêt en échec, le recruteur de l'inscription est prévenu (le 500 reste).
  if (stopFailedOrgs.size > 0) {
    await alertSiblingStopFailure(supabase, eventKey, [...stopFailedOrgs].map((orgId) => {
      const orgRows = enrollments.filter((e) => e.organization_id === orgId);
      return {
        organizationId: orgId,
        userIds: orgRows.map((e) => e.created_by),
        candidateName: orgRows[0]?.profile_name || from_attendee?.display_name || senderEmail,
        sequenceId: orgRows[0]?.sequence_id ?? null,
        enrollmentIds: orgRows.map((e) => e.id),
      };
    }));
  }

  // 5. Le recruteur est prévenu (SEQ-115). Lien vers la séquence de la
  //    mission, pas vers la messagerie LinkedIn (aucune conversation).
  //    Non bloquant.
  if (closed.length > 0) {
    try {
      const projectBySequence = await loadSequenceProjects(supabase, closed.map((e) => e.sequence_id));
      const byOwner = new Map<string, MailEnrollment[]>();
      for (const e of closed) {
        if (!e.created_by || !e.organization_id) continue;
        const key = `${e.created_by}:${e.organization_id}`;
        byOwner.set(key, [...(byOwner.get(key) ?? []), e]);
      }
      const notifications = [...byOwner.values()].map((rows) => {
        const primary = rows[0];
        const projectId = projectBySequence.get(primary.sequence_id) ?? missionByEnrollment.get(primary.id);
        const candidateName = primary.profile_name || from_attendee?.display_name || senderEmail;
        return {
          user_id: primary.created_by,
          organization_id: primary.organization_id,
          type: 'new_message',
          title: `Nouveau message de ${candidateName}`,
          body: 'Réponse reçue par e-mail : la séquence est arrêtée pour ce candidat, aucune relance ne partira.',
          link: projectId ? `/missions/${projectId}?tab=outreach` : '/missions',
          metadata: {
            is_candidate: true,
            channel: 'email',
            enrollment_id: primary.id,
            enrollment_ids: rows.map((r) => r.id),
            sequence_id: primary.sequence_id,
            profile_name: primary.profile_name ?? null,
            profile_headline: primary.profile_headline ?? null,
            ...(projectId ? { project_id: projectId } : {}),
            ...(email_id ? { email_id } : {}),
          },
        };
      });
      if (notifications.length > 0) {
        const { error: notifError } = await supabase.from('notifications').insert(notifications);
        if (notifError) console.warn('[unipile-webhook][mail] reply notifications failed:', notifError);
      }
    } catch (notifErr) {
      console.warn('[unipile-webhook][mail] reply notifications failed:', notifErr);
    }
  }

  if (failures.length > 0) {
    console.error(`[unipile-webhook][mail] ${failures.length} write(s) failed:`, failures[0]);
    throw failures[0];
  }
}

/**
 * Marque 'bounced' la dernière exécution e-mail envoyée de l'inscription
 * (SEQ-107 : aucun écrivain n'enregistrait ce statut). Non bloquant.
 */
async function markLastEmailExecutionBounced(supabase: SupabaseClient, enrollmentId: string): Promise<void> {
  try {
    const { data: executions, error } = await supabase
      .from('sequence_step_executions')
      .select('id, step_id, channel, executed_at')
      .eq('enrollment_id', enrollmentId)
      .in('status', ['sent', 'opened', 'clicked'])
      .order('executed_at', { ascending: false, nullsFirst: false })
      .limit(20);
    if (error) {
      console.warn('[unipile-webhook][bounce] executions lookup failed:', error);
      return;
    }
    const rows = (executions ?? []) as Array<{ id: string; step_id: string | null; channel: string | null }>;
    if (rows.length === 0) return;
    const stepIds = [...new Set(rows.map((r) => r.step_id).filter((id): id is string => !!id))];
    const emailSteps = new Set<string>();
    if (stepIds.length > 0) {
      const { data: steps, error: stepsError } = await supabase
        .from('sequence_steps')
        .select('id, action_type, step_channel')
        .in('id', stepIds);
      if (stepsError) {
        console.warn('[unipile-webhook][bounce] steps lookup failed:', stepsError);
        return;
      }
      for (const step of (steps ?? []) as Array<{ id: string; action_type: string | null; step_channel: string | null }>) {
        if (step.action_type === 'email' || step.step_channel === 'email') emailSteps.add(step.id);
      }
    }
    const lastEmail = rows.find((r) => r.channel === 'email' || (r.step_id && emailSteps.has(r.step_id)));
    if (!lastEmail) return;
    const { error: updateError } = await supabase
      .from('sequence_step_executions')
      .update({ status: 'bounced', updated_at: new Date().toISOString() })
      .eq('id', lastEmail.id)
      .in('status', ['sent', 'opened', 'clicked']);
    if (updateError) console.warn('[unipile-webhook][bounce] execution not marked bounced:', updateError);
  } catch (e) {
    console.warn('[unipile-webhook][bounce] execution not marked bounced:', e);
  }
}

/**
 * Traite un NDR (bounce email). L'adresse qui a bouncé n'est PAS l'expéditeur
 * (mailer-daemon), elle est dans le corps du NDR. On l'en extrait, puis — pour
 * chaque adresse qu'on a RÉELLEMENT séquencée (garde-fou anti faux-positif sur
 * un parsing bruité), dans l'organisation de la boîte qui reçoit — on l'ajoute
 * à suppressed_emails, on passe les inscriptions actives/en pause en
 * 'bounced', on marque la dernière exécution e-mail 'bounced', on annule
 * leurs étapes encore en attente et on prévient le recruteur.
 */
async function handleBounce(supabase: SupabaseClient, accountId: string, payload: WebhookPayload, senderEmail: string) {
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

  const mailboxOrgs = await resolveMailboxOrganizations(supabase, accountId);
  const failures: unknown[] = [];
  const bouncedEnrollments: Array<MailEnrollment & { address: string }> = [];

  for (const addr of candidates) {
    // On ne suppress QUE les adresses qu'on a réellement séquencées — sinon
    // un NDR bruité pourrait blacklister une adresse au hasard.
    let enrs: MailEnrollment[];
    try {
      enrs = await findOpenEnrollmentsByEmail(
        supabase,
        accountId,
        mailboxOrgs,
        addr,
        ['active', 'paused', 'completed', 'replied', 'bounced', 'stopped', 'cancelled'],
      );
    } catch (enrErr) {
      failures.push(enrErr);
      continue;
    }
    if (enrs.length === 0) continue;

    // Hard bounce → ne plus jamais emailer cette adresse.
    const { error: supErr } = await supabase
      .from('suppressed_emails')
      .upsert({ email: addr, reason: 'bounce' }, { onConflict: 'email' });
    if (supErr) failures.push(supErr);

    for (const enr of enrs) {
      const nowIso = new Date().toISOString();
      if (enr.status === 'active' || enr.status === 'paused') {
        const { data: changed, error: bounceError } = await supabase
          .from('sequence_enrollments')
          .update({ status: 'bounced', pause_reason: null, updated_at: nowIso })
          .eq('id', enr.id)
          .in('status', OPEN_ENROLLMENT_STATUSES)
          .select('id');
        if (bounceError) {
          failures.push(bounceError);
          continue;
        }
        if (changed && changed.length > 0) {
          bouncedEnrollments.push({ ...enr, address: addr });
          await markLastEmailExecutionBounced(supabase, enr.id);
        }
      }
      // Annuler les étapes encore en attente pour ce candidat.
      const { error: cancelError } = await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Email bounced (NDR)', updated_at: nowIso })
        .eq('enrollment_id', enr.id)
        .in('status', PENDING_EXECUTION_STATUSES);
      if (cancelError) failures.push(cancelError);
    }
    console.log(`[unipile-webhook][bounce] Suppressed ${addr} + checked ${enrs.length} enrollment(s) on account ${accountId}`);
  }

  // Le recruteur est prévenu (SEQ-115). Non bloquant.
  if (bouncedEnrollments.length > 0) {
    try {
      const projectBySequence = await loadSequenceProjects(supabase, bouncedEnrollments.map((e) => e.sequence_id));
      const notifications = bouncedEnrollments
        .filter((e) => e.created_by && e.organization_id)
        .map((e) => {
          const projectId = projectBySequence.get(e.sequence_id);
          const who = e.profile_name ? `de ${e.profile_name} ` : '';
          return {
            user_id: e.created_by,
            organization_id: e.organization_id,
            type: 'action',
            title: 'Adresse e-mail invalide, séquence arrêtée',
            body: `L'adresse ${e.address} ${who}est invalide : la séquence est arrêtée et plus aucun e-mail ne lui sera envoyé.`,
            link: projectId ? `/missions/${projectId}?tab=outreach` : '/missions',
            metadata: {
              source: 'email_bounce',
              enrollment_id: e.id,
              sequence_id: e.sequence_id,
              profile_name: e.profile_name ?? null,
              ...(projectId ? { project_id: projectId } : {}),
            },
          };
        });
      if (notifications.length > 0) {
        const { error: notifError } = await supabase.from('notifications').insert(notifications);
        if (notifError) console.warn('[unipile-webhook][bounce] notifications failed:', notifError);
      }
    } catch (notifErr) {
      console.warn('[unipile-webhook][bounce] notifications failed:', notifErr);
    }
  }

  if (failures.length > 0) {
    console.error(`[unipile-webhook][bounce] ${failures.length} write(s) failed:`, failures[0]);
    throw failures[0];
  }
}
