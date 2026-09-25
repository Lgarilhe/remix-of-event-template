/**
 * Edge Function: sequence-send-email
 *
 * Sends an outreach email for a sequence step execution.
 * Called by process-sequences when it encounters an email step.
 * Handles: variable resolution, AI personalization, tracking pixel/link injection,
 * and sending via the organisation's connected email account.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";
import { resolveUnipileCredentials } from "../_shared/resolve-org-credentials.ts";
import { interpolatePlaceholders, buildSequenceContext } from "../_shared/template-interpolation.ts";
import { loadAiContextForEnrollment } from "../_shared/ai-context.ts";
import {
  decodeHrefUrl,
  enrollmentSendDecision,
  linkSigningSecret,
  pickMailbox,
  providerMessageId,
  recipientList,
  resolveEmailSender,
  sentProofValue,
  signTrackedUrl,
} from "../_shared/sequence-email-policy.mjs";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Clé de signature des liens suivis : secret dédié EMAIL_LINK_SIGNING_SECRET,
// repli sur la clé de service (ancien comportement). sequence-email-track
// accepte aussi la clé précédente, une rotation ne casse donc pas les liens
// déjà envoyés.
const LINK_SIGNING_SECRET = linkSigningSecret((key) => Deno.env.get(key));
// Note : UNIPILE_API_KEY/UNIPILE_DSN ne sont plus utilisés en globals.
// On résout les creds par organization via resolveUnipileCredentials() pour
// supporter le multi-tenant proprement (chaque org peut avoir son propre
// compte Unipile via organization_integrations).

// Textes lus par le recruteur dans l'historique de la séquence (jamais de nom de fournisseur).
const SENDER_NOT_IN_ORG_REASON = "Compte d'envoi non rattaché à l'organisation";
const NO_SENDER_MAILBOX_MESSAGE = "Aucune boîte e-mail n'est reliée pour l'expéditeur : reliez-la dans Paramètres, Connexions.";
const SENDER_MAILBOX_DISCONNECTED_MESSAGE = "Boîte e-mail de l'expéditeur déconnectée : reconnectez-la dans Paramètres, Connexions.";
const SUPPRESSED_SKIP_REASON = 'Adresse bloquée pour les envois e-mail';
const UNCERTAIN_SEND_MESSAGE = "Envoi incertain : vérifiez le dossier Envoyés de la boîte d'envoi avant de relancer.";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============ HELPERS ============

function generateTrackingId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// Génère un token hex 32 octets pour le lien de désinscription.
function generateUnsubscribeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Récupère (ou crée) le token unsubscribe unique par adresse email. Même schéma
// que send-transactional-email : une seule ligne par email (onConflict email).
// Retourne '' en cas d'échec (ex. table absente) → le caller dégrade en envoyant
// sans footer plutôt que de bloquer l'envoi.
// deno-lint-ignore no-explicit-any
async function getOrCreateUnsubscribeToken(supabase: any, email: string): Promise<string> {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return '';
  try {
    const { data: existing } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token, used_at')
      .eq('email', normalized)
      .maybeSingle();
    if (existing?.token) return existing.token;

    const token = generateUnsubscribeToken();
    await supabase
      .from('email_unsubscribe_tokens')
      .upsert({ token, email: normalized }, { onConflict: 'email', ignoreDuplicates: true });
    // Re-read : si une requête concurrente a gagné la course, on récupère SON token.
    const { data: stored } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalized)
      .maybeSingle();
    return stored?.token || token;
  } catch (e) {
    console.warn('[sequence-send-email] getOrCreateUnsubscribeToken failed (dégradé):', e);
    return '';
  }
}

// Signature HMAC des liens trackés (anti open-redirect, audit 2026-07 M4) :
// le endpoint public sequence-email-track ne redirige vers l'url demandée que
// si sig = HMAC-SHA256(tid + '|' + url) est valide — sinon un phisher pourrait
// utiliser notre domaine comme tremplin vers n'importe quel site.
// signTrackedUrl vit dans _shared/sequence-email-policy.mjs (même calcul des
// deux côtés).
async function wrapLinksForTracking(html: string, trackingId: string, baseUrl: string): Promise<string> {
  const linkRegex = /(<a\s[^>]*href=")([^"]+)("[^>]*>)/gi;
  const shouldSkip = (url: string) =>
    url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('#') || url.includes('/unsubscribe?token=');

  // Passe 1 : collecter les urls à tracker et pré-calculer leur signature
  // (String.replace ne supporte pas les callbacks async). L'attribut href est
  // du HTML : `&amp;` y désigne `&`. On signe et on redirige vers l'URL réelle,
  // sinon le site cible reçoit un paramètre `amp;b` au lieu de `b`.
  const sigs = new Map<string, string>();
  for (const m of html.matchAll(linkRegex)) {
    const target = decodeHrefUrl(m[2]);
    if (!shouldSkip(target) && !sigs.has(target)) {
      sigs.set(target, await signTrackedUrl(LINK_SIGNING_SECRET, trackingId, target));
    }
  }

  // Passe 2 : réécriture
  return html.replace(linkRegex, (match, prefix, url, suffix) => {
    // Don't track mailto: / tel: / anchor links, nor the unsubscribe link
    // (le réécrire en redirect de tracking compterait une désinscription
    // comme un clic et casserait la sémantique du lien opt-out).
    const target = decodeHrefUrl(url);
    if (shouldSkip(target)) return match;
    const sig = sigs.get(target) || '';
    const trackUrl = `${baseUrl}/functions/v1/sequence-email-track?tid=${trackingId}&evt=click&url=${encodeURIComponent(target)}&sig=${sig}`;
    return `${prefix}${trackUrl}${suffix}`;
  });
}

function addTrackingPixel(html: string, trackingId: string, baseUrl: string): string {
  const pixel = `<img src="${baseUrl}/functions/v1/sequence-email-track?tid=${trackingId}&evt=open" width="1" height="1" style="display:none;border:0;" alt="" />`;
  // Insert before </body> if present, otherwise append
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}

function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
    .replace(/\r/g, '');
}

// ============ AI PERSONALIZATION ============

async function generateAiSnippet(
  supabase: ReturnType<typeof createClient>,
  enrollment: Record<string, unknown>,
  step: Record<string, unknown>,
  orgId: string | null,
  senderUserId: string | null,
): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('[sequence-send-email] No ANTHROPIC_API_KEY, skipping AI personalization');
    return null;
  }

  let context = '';
  const source = (step.ai_personalization_source as string) || 'profile_only';

  // Profile-based context (always included)
  const profileParts: string[] = [];
  if (enrollment.profile_name) profileParts.push(`Name: ${enrollment.profile_name}`);
  if (enrollment.profile_headline) profileParts.push(`Headline: ${enrollment.profile_headline}`);
  if (enrollment.company_name) profileParts.push(`Company: ${enrollment.company_name}`);
  context = profileParts.join('\n');

  // RAG context if requested
  if ((source === 'rag_full' || source === 'rag_notes_only') && orgId) {
    try {
      const candidateId = (enrollment.profile_id || enrollment.resolved_profile_id || '') as string;
      const ragEndpoint = source === 'rag_notes_only'
        ? 'retrieve-context'
        : 'retrieve-context';

      const ragRes = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/${ragEndpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id: orgId,
          entity_type: 'candidate',
          entity_id: candidateId,
          query: (step.message_template as string || '').substring(0, 500),
          limit: source === 'rag_notes_only' ? 4 : 8,
          ...(source === 'rag_notes_only' ? { source_filter: 'recruiter_notes' } : {}),
        }),
      });

      if (ragRes.ok) {
        const ragData = await ragRes.json();
        if (ragData?.formatted_context) {
          context += '\n\nRecruiter context:\n' + ragData.formatted_context.substring(0, 2000);
        }
      }
    } catch (err) {
      console.warn('[sequence-send-email] RAG fetch error:', err);
    }
  }

  const customPrompt = (step.ai_personalization_prompt as string) || '';
  const systemPrompt = `You are a recruitment outreach assistant. Generate a short, personalized snippet (1-3 sentences max) to insert into a recruiter's email. Be natural, specific, and professional. Write in the same language as the email template.`;
  const userPrompt = `Candidate context:\n${context}\n\n${customPrompt ? `Special instruction: ${customPrompt}\n\n` : ''}Generate a brief personalized snippet for the email.`;

  try {
    // Resolve model from org settings (same pattern as process-sequences)
    let modelId = 'claude-sonnet-4-6';
    let anthropicModel = 'claude-sonnet-4-6';
    try {
      const { getModel: gm, getAnthropicModelId: gam } = await import('../_shared/ai-config.ts');
      let orgModelDefault: string | null = null;
      if (orgId) {
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: orgRow } = await adminClient.from('organizations').select('ai_model_default').eq('id', orgId).maybeSingle();
        orgModelDefault = orgRow?.ai_model_default || null;
      }
      modelId = gm('default', null, orgModelDefault);
      anthropicModel = gam(modelId);
    } catch { /* use defaults */ }

    // Load AI context (Settings → Contexte IA) — user + org. Même expéditeur
    // que le nom affiché et les variables : le titulaire de la boîte d'envoi,
    // passé en expéditeur déjà résolu (4e paramètre, prioritaire).
    const emailAiContext = await loadAiContextForEnrollment(supabase, enrollment, null, senderUserId);

    const { callAnthropicWithRetry: callWithRetry } = await import('../_shared/ai-config.ts');
    const result = await callWithRetry(ANTHROPIC_API_KEY!, {
      model: anthropicModel,
      max_tokens: 150,
      system: emailAiContext
        ? [
            { type: 'text', text: systemPrompt },
            { type: 'text', text: emailAiContext, cache_control: { type: 'ephemeral' } },
          ]
        : systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = (result as any)?.content?.[0]?.text;

    // Settle credits (fire-and-forget)
    if (orgId && result?.usage) {
      try {
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { settleCredits: settle } = await import('../_shared/settle-credits.ts');
        settle(adminClient as any, {
          organizationId: orgId,
          userId: '', // no user context in email send (service role call)
          aiAction: 'outreach_message',
          modelId,
          tokensInput: result.usage.input_tokens || 0,
          tokensOutput: result.usage.output_tokens || 0,
          description: 'Sequence email AI snippet (fallback)',
        }).catch(e => console.warn('[sequence-send-email] settle error:', e));
      } catch { /* non-blocking */ }
    }

    return (text as string) || null;
  } catch (err) {
    console.warn('[sequence-send-email] AI personalization error:', err);
    return null;
  }
}

// ============ EMAIL SENDING ============

/**
 * Send email via Unipile API (primary method).
 * Uses the same Unipile infrastructure as LinkedIn messaging.
 * Requires an email account connected in Unipile (Gmail, Outlook, IMAP).
 */
async function sendViaUnipile(
  unipileApiKey: string,
  unipileDsn: string,
  accountId: string,
  senderName: string,
  to: string,
  subject: string,
  htmlBody: string,
  cc?: string[],
  bcc?: string[],
): Promise<{ success: boolean; messageId?: string | null; error?: string }> {
  if (!unipileApiKey || !unipileDsn) {
    console.error('[sequence-send-email] Email provider not configured: missing API key or DSN for org');
    return { success: false, error: 'email_provider_not_configured' };
  }

  const toRecipients = [{ display_name: '', identifier: to }];
  const ccRecipients = (cc || []).filter(Boolean).map(e => ({ display_name: '', identifier: e }));
  const bccRecipients = (bcc || []).filter(Boolean).map(e => ({ display_name: '', identifier: e }));

  // Pas de suivi natif du fournisseur (tracking_options) : ses événements ne
  // sont rattachés à rien, il doublait le pixel et chaque redirection de lien.
  const payload: Record<string, unknown> = {
    account_id: accountId,
    subject,
    body: htmlBody,
    to: toRecipients,
    ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
    ...(bccRecipients.length > 0 ? { bcc: bccRecipients } : {}),
    ...(senderName ? { from: { display_name: senderName } } : {}),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(`${unipileDsn}/api/v1/emails`, {
      method: 'POST',
      headers: {
        'X-API-KEY': unipileApiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Délai dépassé ou coupure réseau pendant le POST : l'e-mail a pu partir.
    // Jamais de relance automatique (double envoi), vérification manuelle.
    console.error(`[sequence-send-email] Email provider error (issue inconnue):`, err);
    return { success: false, error: 'send_uncertain' };
  }

  if (res.ok) {
    // Envoi accepté : une réponse illisible ne doit pas le faire passer pour
    // un échec. Identifiant réel du fournisseur, jamais un identifiant inventé.
    const data = await res.json().catch(() => null);
    const messageId = providerMessageId(data);
    console.log(`[sequence-send-email] Unipile email sent: ${messageId ?? '(sans identifiant)'}`);
    return { success: true, messageId };
  }

  const errorBody = await res.text().catch(() => '');
  console.error(`[sequence-send-email] Email provider returned ${res.status}: ${errorBody}`);
  // 5xx : le fournisseur a pu accepter l'e-mail avant d'échouer. Même règle
  // que le délai dépassé : issue inconnue, pas de relance automatique.
  if (res.status >= 500) return { success: false, error: 'send_uncertain' };
  return { success: false, error: `email_send_failed_${res.status}` };
}

// ============ SENDING MAILBOX ============

type SendingMailbox =
  | { kind: 'ok'; mailboxId: string; senderUserId: string | null }
  | { kind: 'not_in_org' }
  | { kind: 'no_mailbox' }
  | { kind: 'mailbox_disconnected'; mailboxId: string; status: string | null }
  | { kind: 'lookup_failed'; error: string };

/**
 * Boîte en état d'envoyer : état OK (ou CONNECTED), ou inconnu (liaison sans
 * état). Tout autre état (CREDENTIALS, ERROR, CONNECTING…) : la boîte est à
 * reconnecter, rien n'est envoyé. Même règle que l'écran Connexions
 * (isUsableEmailAccountStatus). pickMailbox choisit la boîte, comme le moteur ;
 * ce contrôle refuse ensuite une boîte retenue faute de mieux (SEQ-067).
 */
function isUsableMailboxStatus(status: string | null | undefined): boolean {
  if (typeof status !== 'string' || !status.trim()) return true;
  const normalized = status.trim().toUpperCase();
  return normalized === 'OK' || normalized === 'CONNECTED';
}

/**
 * Boîte e-mail d'envoi, résolue dans l'organisation de l'inscription.
 * Les identifiants candidats (étape, rotation, inscription) ne servent qu'à
 * désigner l'expéditeur : un compte e-mail rattaché à l'organisation sert
 * directement, un compte LinkedIn rattaché désigne son titulaire dont on prend
 * la boîte. On n'envoie jamais depuis l'identifiant du compte LinkedIn, ni
 * depuis un compte absent de l'organisation.
 */
async function resolveSendingMailbox(
  supabase: SupabaseClient,
  orgId: string | null,
  candidates: unknown[],
  fallbackUserId: string | null,
): Promise<SendingMailbox> {
  if (!orgId) return { kind: 'not_in_org' };
  const ids = [...new Set(candidates.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))];

  let emailAccounts: Array<{ email_account_id: string; user_id: string | null; account_status: string | null }> = [];
  let linkedinAccounts: Array<{ linkedin_account_id: string; user_id: string | null }> = [];
  if (ids.length > 0) {
    const [emailRes, linkedinRes] = await Promise.all([
      supabase.from('member_email_accounts').select('email_account_id, user_id, account_status')
        .eq('organization_id', orgId).in('email_account_id', ids),
      supabase.from('member_linkedin_accounts').select('linkedin_account_id, user_id')
        .eq('organization_id', orgId).in('linkedin_account_id', ids),
    ]);
    const lookupError = emailRes.error || linkedinRes.error;
    if (lookupError) return { kind: 'lookup_failed', error: lookupError.message };
    emailAccounts = (emailRes.data || []) as typeof emailAccounts;
    linkedinAccounts = (linkedinRes.data || []) as typeof linkedinAccounts;
  }

  const decision = resolveEmailSender({ candidates: ids, emailAccounts, linkedinAccounts, fallbackUserId });
  if (decision.kind === 'not_in_org') return { kind: 'not_in_org' };
  if (decision.kind === 'mailbox') {
    const status = emailAccounts.find((row) => row.email_account_id === decision.mailboxId)?.account_status ?? null;
    if (!isUsableMailboxStatus(status)) return { kind: 'mailbox_disconnected', mailboxId: decision.mailboxId, status };
    return { kind: 'ok', mailboxId: decision.mailboxId, senderUserId: decision.ownerUserId };
  }
  if (!decision.ownerUserId) return { kind: 'no_mailbox' };

  const { data: ownerMailboxes, error: mailboxError } = await supabase
    .from('member_email_accounts')
    .select('email_account_id, account_status')
    .eq('organization_id', orgId)
    .eq('user_id', decision.ownerUserId);
  if (mailboxError) return { kind: 'lookup_failed', error: mailboxError.message };
  const ownerRows = (ownerMailboxes || []) as Array<{ email_account_id: string; account_status: string | null }>;
  const mailboxId = pickMailbox(ownerRows);
  if (!mailboxId) return { kind: 'no_mailbox' };
  const status = ownerRows.find((row) => row.email_account_id === mailboxId)?.account_status ?? null;
  if (!isUsableMailboxStatus(status)) return { kind: 'mailbox_disconnected', mailboxId, status };
  return { kind: 'ok', mailboxId, senderUserId: decision.ownerUserId };
}

// ============ MAIN HANDLER ============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: service_role only — comparaison à temps constant (anti timing attack)
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const tokenBytes = new TextEncoder().encode(token);
  const keyBytes = new TextEncoder().encode(SUPABASE_SERVICE_ROLE_KEY);
  let tokenDiff = tokenBytes.length === keyBytes.length ? 0 : 1;
  for (let i = 0; i < Math.min(tokenBytes.length, keyBytes.length); i++) tokenDiff |= tokenBytes[i] ^ keyBytes[i];
  if (tokenDiff !== 0) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { execution_id, enrollment_id, step_id, pre_personalized_message, pre_personalized_subject } = await req.json();
    if (!execution_id || !enrollment_id || !step_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Load all required data
    const [executionRes, enrollmentRes, stepRes] = await Promise.all([
      supabase.from('sequence_step_executions').select('*').eq('id', execution_id).single(),
      supabase.from('sequence_enrollments').select('*, sequence:outreach_sequences(*)').eq('id', enrollment_id).single(),
      supabase.from('sequence_steps').select('*').eq('id', step_id).single(),
    ]);

    if (executionRes.error || !executionRes.data) {
      throw new Error(`Execution not found: ${executionRes.error?.message}`);
    }
    if (enrollmentRes.error || !enrollmentRes.data) {
      throw new Error(`Enrollment not found: ${enrollmentRes.error?.message}`);
    }
    if (stepRes.error || !stepRes.data) {
      throw new Error(`Step not found: ${stepRes.error?.message}`);
    }

    const execution = executionRes.data;
    const enrollment = enrollmentRes.data;
    const step = stepRes.data;
    const sequence = enrollment.sequence;

    // Garde d'idempotence (audit 2026-07, Delivery M2) : cette fonction peut
    // être invoquée deux fois pour la même exécution (retry HTTP du caller
    // dont le timeout est 30s alors qu'on peut dépasser, re-schedule janitor
    // pendant qu'un premier appel lent est encore en vol). On ne traite que
    // les exécutions encore en cours de traitement — un statut terminal
    // (sent/opened/failed/cancelled/bounced…) signifie que quelqu'un est déjà
    // passé : renvoyer succès sans ré-envoyer.
    if (!['sending', 'scheduled'].includes(execution.status)) {
      console.warn(`[sequence-send-email] Execution ${execution_id} already in status '${execution.status}' — skipping duplicate send`);
      return json({ success: true, skipped: 'already_processed', status: execution.status });
    }

    // Preuve d'envoi (audit séquences 2026-09, SEQ-005) : une tentative
    // précédente a pu envoyer l'e-mail sans réussir à écrire le statut 'sent'.
    // Sa ligne de suivi porte alors un email_message_id non nul, écrit juste
    // après l'acceptation par le fournisseur. La ligne de suivi seule ne prouve
    // rien (elle est créée avant l'envoi) : seul l'identifiant compte.
    {
      const { data: proofRows, error: proofError } = await supabase
        .from('sequence_email_tracking')
        .select('email_message_id, created_at')
        .eq('execution_id', execution_id)
        .not('email_message_id', 'is', null)
        .limit(1);
      if (proofError) {
        // Rien n'est envoyé tant qu'on ne sait pas si un envoi a déjà eu lieu.
        console.error('[sequence-send-email] sent-proof check failed — aborting send', { error: proofError, execution_id });
        return json({ success: false, error: 'sent_proof_check_failed' }, 500);
      }
      if (proofRows && proofRows.length > 0) {
        const proof = proofRows[0];
        const { error: markSentError } = await supabase.from('sequence_step_executions').update({
          status: 'sent',
          executed_at: proof.created_at || new Date().toISOString(),
          error_message: null,
          channel: 'email',
        }).eq('id', execution_id).in('status', ['sending', 'scheduled']);
        if (markSentError) {
          console.error('[sequence-send-email] already sent, status not saved', { error: markSentError, execution_id });
        }
        console.warn(`[sequence-send-email] Execution ${execution_id} already sent (${proof.email_message_id}) — no second send`);
        return json({ success: true, skipped: 'already_sent', message_id: proof.email_message_id });
      }
    }

    // Statut de l'inscription (SEQ-200, contrat §1). En pause : l'étape n'est
    // ni envoyée, ni annulée, elle retrouve son attente avec sa date. Clôturée :
    // l'étape est annulée. success: false pour que le moteur n'avance pas
    // l'inscription (le statut de l'exécution est déjà écrit ici).
    const stopBeforeSend = async (decision: 'hold' | 'cancel', enrollmentStatus: unknown): Promise<Response> => {
      if (decision === 'hold') {
        const { error: holdError } = await supabase.from('sequence_step_executions')
          .update({ status: 'scheduled' })
          .eq('id', execution_id)
          .eq('status', 'sending');
        if (holdError) console.error('[sequence-send-email] Failed to put execution back on hold', { error: holdError, execution_id });
        console.warn(`[sequence-send-email] Enrollment ${enrollment_id} paused — execution ${execution_id} kept for the resume`);
        return json({ success: false, skipped: 'enrollment_paused', error: 'enrollment_paused' });
      }
      const { error: cancelError } = await supabase.from('sequence_step_executions').update({
        status: 'cancelled',
        // Même format que le contrôle de dernière minute du moteur, traduit à l'affichage.
        skip_reason: `Enrollment became ${String(enrollmentStatus ?? 'deleted')} before send (email re-check)`,
        executed_at: new Date().toISOString(),
      }).eq('id', execution_id).in('status', ['sending', 'scheduled']);
      if (cancelError) console.error('[sequence-send-email] Failed to cancel execution (enrollment closed)', { error: cancelError, execution_id });
      console.warn(`[sequence-send-email] Enrollment ${enrollment_id} is '${String(enrollmentStatus)}' — execution ${execution_id} cancelled`);
      return json({ success: false, skipped: 'enrollment_inactive', error: 'enrollment_inactive', enrollment_status: enrollmentStatus ?? null });
    };

    const initialDecision = enrollmentSendDecision(enrollment.status);
    if (initialDecision !== 'send') return await stopBeforeSend(initialDecision, enrollment.status);

    // 2. Determine recipient email
    const recipientEmail = enrollment.email_used || null;
    if (!recipientEmail) {
      const { error: noEmailUpdateError } = await supabase.from('sequence_step_executions').update({
        status: 'failed',
        error_message: 'no_email: No email address available for this candidate',
        executed_at: new Date().toISOString(),
      }).eq('id', execution_id);

      if (noEmailUpdateError) {
        console.error('[sequence-send-email] Failed to update execution status (no_email)', { error: noEmailUpdateError, execution_id });
        return json({ error: 'Failed to update execution status' }, 500);
      }

      return json({ error: 'no_email' });
    }

    // 2b. Suppression list — re-vérifiée AU MOMENT de l'envoi (audit 2026-07,
    // Delivery M10). Avant, seul process-sequences la vérifiait, et uniquement
    // si stop_conditions.on_unsubscribe était activé : un désabonnement ou un
    // bounce enregistré entre la planification et l'envoi partait quand même
    // (risque légal opt-out + réputation). Ici : jamais d'email vers une
    // adresse supprimée, quel que soit le réglage de la séquence.
    {
      const { data: suppressed, error: supErr } = await supabase
        .from('suppressed_emails')
        .select('id, reason')
        .eq('email', recipientEmail.toLowerCase().trim())
        .maybeSingle();
      if (supErr) {
        console.warn('[sequence-send-email] suppression check failed (fail-open would risk opt-out violation) — aborting send:', supErr);
        return json({ success: false, error: 'suppression_check_failed' }, 500);
      }
      if (suppressed) {
        // La liste est commune à toutes les organisations : la raison
        // (désinscription, rebond, plainte) n'est pas exposée dans l'historique.
        await supabase.from('sequence_step_executions').update({
          status: 'skipped',
          skip_reason: SUPPRESSED_SKIP_REASON,
          executed_at: new Date().toISOString(),
        }).eq('id', execution_id);
        console.warn(`[sequence-send-email] Recipient suppressed (${suppressed.reason}) — skipping send for execution ${execution_id}`);
        return json({ success: true, skipped: 'suppressed' });
      }
    }

    // 3. Organisation, boîte d'envoi et expéditeur (SEQ-010, SEQ-067, SEQ-100).
    // L'organisation de référence est celle de l'inscription.
    const orgId = (enrollment.organization_id || sequence?.organization_id || null) as string | null;
    const mailbox = await resolveSendingMailbox(
      supabase,
      orgId,
      [step.sender_id, enrollment.assigned_sender_id, enrollment.account_id],
      (enrollment.created_by as string) || null,
    );
    if (mailbox.kind === 'lookup_failed') {
      // Rien n'est parti : une nouvelle tentative est sans risque.
      console.error('[sequence-send-email] Sending mailbox lookup failed', { error: mailbox.error, execution_id });
      return json({ success: false, error: 'sender_lookup_failed' }, 500);
    }
    if (mailbox.kind === 'not_in_org') {
      const { error: notInOrgError } = await supabase.from('sequence_step_executions').update({
        status: 'cancelled',
        skip_reason: SENDER_NOT_IN_ORG_REASON,
        executed_at: new Date().toISOString(),
        channel: 'email',
      }).eq('id', execution_id).in('status', ['sending', 'scheduled']);
      if (notInOrgError) console.error('[sequence-send-email] Failed to cancel execution (sender not in org)', { error: notInOrgError, execution_id });
      console.error(`[sequence-send-email] Sender account of enrollment ${enrollment_id} is not attached to organization ${orgId} — no send`);
      return json({ success: false, error: 'sender_account_not_in_org' });
    }
    if (mailbox.kind === 'no_mailbox') {
      const { error: noMailboxError } = await supabase.from('sequence_step_executions').update({
        status: 'failed',
        error_message: NO_SENDER_MAILBOX_MESSAGE,
        executed_at: new Date().toISOString(),
        channel: 'email',
      }).eq('id', execution_id).in('status', ['sending', 'scheduled']);
      if (noMailboxError) console.error('[sequence-send-email] Failed to update execution status (no mailbox)', { error: noMailboxError, execution_id });
      console.warn(`[sequence-send-email] No email account linked for the sender of enrollment ${enrollment_id}`);
      return json({ success: false, error: 'no_sender_mailbox' });
    }
    if (mailbox.kind === 'mailbox_disconnected') {
      // Boîte à reconnecter : rien n'est parti, échec explicite (SEQ-067).
      const { error: disconnectedError } = await supabase.from('sequence_step_executions').update({
        status: 'failed',
        error_message: SENDER_MAILBOX_DISCONNECTED_MESSAGE,
        executed_at: new Date().toISOString(),
        channel: 'email',
      }).eq('id', execution_id).in('status', ['sending', 'scheduled']);
      if (disconnectedError) console.error('[sequence-send-email] Failed to update execution status (mailbox disconnected)', { error: disconnectedError, execution_id });
      console.warn(`[sequence-send-email] Sending mailbox ${mailbox.mailboxId} of enrollment ${enrollment_id} is '${String(mailbox.status)}' — no send`);
      return json({ success: false, error: 'sender_mailbox_disconnected' });
    }
    const emailAccountId = mailbox.mailboxId;
    // Expéditeur = titulaire de la boîte d'envoi, repli sur l'auteur de
    // l'inscription (jamais le créateur de la séquence) : même règle pour le
    // nom affiché, les variables {{mon_prenom}} et le contexte de l'IA.
    const senderUserId = mailbox.senderUserId || (enrollment.created_by as string) || null;

    let senderName = '';
    if (senderUserId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', senderUserId)
        .maybeSingle();
      senderName = profile?.display_name || '';
    }

    // 4. Resolve variables in templates via unified interpolation
    // (30+ vars FR + EN aliases + custom user variables + pipe filters)
    const templateCtx = await buildSequenceContext(supabase, {
      enrollment,
      senderUserId,
      organizationName: undefined, // resolved inside via orgId lookup
    });

    // Use pre-personalized message from process-sequences if available (rich AI pipeline)
    // Otherwise fall back to template variable resolution + basic AI snippet
    let messageBody: string;
    let subject: string;

    if (pre_personalized_message) {
      // process-sequences already ran the full AI personalization pipeline
      messageBody = pre_personalized_message;
      subject = pre_personalized_subject || interpolatePlaceholders(step.subject_template || '', templateCtx);
      console.log('[sequence-send-email] Using pre-personalized message from process-sequences');
    } else {
      messageBody = interpolatePlaceholders(step.message_template || '', templateCtx);
      subject = interpolatePlaceholders(step.subject_template || '', templateCtx);
    }

    // 5. AI Personalization (only if NOT pre-personalized)
    let aiSnippet: string | null = null;
    if (!pre_personalized_message && step.use_ai_personalization) {
      aiSnippet = await generateAiSnippet(supabase as any, enrollment, step, orgId, senderUserId);

      if (aiSnippet) {
        // Insert at {ai_snippet} marker or prepend
        if (messageBody.includes('{ai_snippet}')) {
          messageBody = messageBody.replace('{ai_snippet}', aiSnippet);
        } else {
          messageBody = aiSnippet + '\n\n' + messageBody;
        }
      }
    }

    // 6. Convert to HTML
    let htmlBody = messageBody.includes('<') && messageBody.includes('>')
      ? messageBody // Already HTML
      : textToHtml(messageBody);

    // 6b. Add email signature if configured — seulement une signature de
    // l'organisation de l'inscription (lecture par la clé de service).
    let signatureContent: string | null = null;
    if (step.signature_id && orgId) {
      const { data: sig, error: sigError } = await supabase
        .from('email_signatures')
        .select('content')
        .eq('id', step.signature_id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (sigError) console.warn('[sequence-send-email] signature lookup failed — sending without it:', sigError);
      signatureContent = sig?.content || null;
    }
    if (signatureContent) {
      htmlBody += `<br/><br/>${signatureContent}`;
      // Also handle {{signature}} variable in the body (for manual insertion)
      if (htmlBody.includes('{{signature}}')) {
        htmlBody = htmlBody.replace(/\{\{signature\}\}/g, signatureContent);
      }
    }
    // Clean up any remaining {{signature}} if no signature configured
    htmlBody = htmlBody.replace(/\{\{signature\}\}/g, '');

    // Copies (CC/BCC) : elles reçoivent le même corps que le candidat. Sans
    // instrumentation dans ce cas : pas de pixel ni de liens suivis (une
    // ouverture ou un clic d'une copie serait attribué au candidat), pas de
    // pied de désinscription au jeton du candidat.
    const cc = recipientList(step.cc_emails);
    const bcc = recipientList(step.bcc_emails);
    const hasCopies = cc.length > 0 || bcc.length > 0;

    // 7. Add unsubscribe footer if enabled
    // Le lien pointe vers la page /unsubscribe du front (GET valide le token,
    // POST désinscrit + ajoute à suppressed_emails). L'ancien lien
    // `handle-email-unsubscribe?email=...` renvoyait 400 (le handler attend un
    // `token`, pas un `email`) → le candidat ne pouvait JAMAIS se désinscrire.
    if (step.include_unsubscribe && !hasCopies) {
      const unsubToken = await getOrCreateUnsubscribeToken(supabase, recipientEmail);
      if (unsubToken) {
        const appUrl = (Deno.env.get('APP_URL') || 'https://konekt-app-navy.vercel.app').replace(/\/+$/, '');
        const unsubLink = `${appUrl}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
        htmlBody += `<br/><br/><p style="font-size:11px;color:#999;">Si vous ne souhaitez plus recevoir ces messages, <a href="${unsubLink}" style="color:#999;">cliquez ici</a>.</p>`;
      } else {
        console.warn('[sequence-send-email] Pas de token unsubscribe disponible — envoi sans footer (dégradé)');
      }
    }

    // 8. Email tracking
    const trackingId = generateTrackingId();

    if (!hasCopies) {
      // Wrap links for click tracking (liens signés HMAC — anti open-redirect)
      htmlBody = await wrapLinksForTracking(htmlBody, trackingId, SUPABASE_URL);

      // Add tracking pixel
      htmlBody = addTrackingPixel(htmlBody, trackingId, SUPABASE_URL);
    }

    // 9. Send email via the connected email account (Unipile) — no global fallback
    let sendResult: { success: boolean; messageId?: string | null; error?: string };

    // Resolve Unipile credentials per organization (multi-tenant safe).
    // Fallback automatique sur les env vars si pas de creds org-specific.
    const unipileCreds = await resolveUnipileCredentials(orgId, supabase);

    // Dernier contrôle juste avant l'envoi : une réponse du candidat, une pause
    // ou un arrêt a pu arriver pendant la préparation (SEQ-200).
    {
      const { data: latestEnrollment, error: latestError } = await supabase
        .from('sequence_enrollments')
        .select('status')
        .eq('id', enrollment_id)
        .maybeSingle();
      if (latestError) {
        console.error('[sequence-send-email] enrollment re-check failed — aborting send', { error: latestError, execution_id });
        return json({ success: false, error: 'enrollment_check_failed' }, 500);
      }
      const latestDecision = enrollmentSendDecision(latestEnrollment?.status);
      if (latestDecision !== 'send') return await stopBeforeSend(latestDecision, latestEnrollment?.status ?? null);
    }

    // Ligne de suivi, créée avant l'envoi : elle porte le tracking_id du pixel
    // et des liens, puis la preuve d'envoi (email_message_id) juste après.
    const { error: trackingInsertError } = await supabase.from('sequence_email_tracking').insert({
      execution_id,
      tracking_id: trackingId,
    });
    if (trackingInsertError) {
      console.error('[sequence-send-email] Failed to insert tracking record', { error: trackingInsertError, execution_id, trackingId });
      return json({ error: 'Failed to create email tracking record' }, 500);
    }

    if (unipileCreds?.apiKey && unipileCreds?.dsn) {
      // Primary: send via Unipile (same infra as LinkedIn — supports Gmail, Outlook, IMAP)
      sendResult = await sendViaUnipile(
        unipileCreds.apiKey,
        unipileCreds.dsn,
        emailAccountId,
        senderName,
        recipientEmail,
        subject,
        htmlBody,
        cc,
        bcc,
      );
    } else {
      // Pas d'identifiants d'envoi pour l'organisation : pas de repli global
      // (l'ancien jeton Microsoft Graph unique pour toutes les organisations a été retiré).
      console.error('[sequence-send-email] No email sending method available (no provider credentials)');
      sendResult = { success: false, error: 'no_email_method_available' };
    }

    // 10. Update execution status
    if (sendResult.success) {
      // a) Preuve d'envoi d'abord (SEQ-005) : identifiant du fournisseur, ou
      // marqueur non nul s'il n'en renvoie pas. C'est elle qu'une nouvelle
      // invocation lit avant tout envoi.
      const { error: proofWriteError } = await supabase.from('sequence_email_tracking').update({
        email_message_id: sentProofValue(sendResult.messageId, trackingId),
      }).eq('tracking_id', trackingId);
      if (proofWriteError) {
        console.error('[sequence-send-email] Failed to write sent proof on tracking record', { error: proofWriteError, trackingId });
      }

      // b) Puis le statut. error_message remis à null : une tentative
      // précédente (limite d'envoi, reprise) ne doit plus s'afficher en erreur.
      const { data: sentRows, error: sentUpdateError } = await supabase.from('sequence_step_executions').update({
        status: 'sent',
        executed_at: new Date().toISOString(),
        error_message: null,
        final_message: htmlBody,
        final_subject: subject,
        channel: 'email',
        ai_snippet: aiSnippet,
        personalized_subject: subject,
      }).eq('id', execution_id).in('status', ['sending', 'scheduled']).select('id');
      if (sentUpdateError || !sentRows || sentRows.length === 0) {
        // L'e-mail EST parti : succès, jamais d'erreur qui déclencherait une
        // relance. Le moteur avance l'inscription et marque l'étape envoyée.
        console.error('[sequence-send-email] Email sent but execution status not saved', { error: sentUpdateError, execution_id });
        return json({ success: true, message_id: sendResult.messageId ?? null, status_update_failed: true });
      }

      return json({ success: true, message_id: sendResult.messageId ?? null });
    } else {
      // Check if rate limited
      const errorStr = (sendResult.error || '').toLowerCase();
      const isRateLimit = errorStr.includes('429') || errorStr.includes('rate limit') || errorStr.includes('throttl');

      if (sendResult.error === 'send_uncertain') {
        // Issue inconnue (délai dépassé, erreur serveur du fournisseur) :
        // échec sans relance automatique, à vérifier avant de relancer.
        const { error: uncertainUpdateError } = await supabase.from('sequence_step_executions').update({
          status: 'failed',
          error_message: UNCERTAIN_SEND_MESSAGE,
          executed_at: new Date().toISOString(),
          channel: 'email',
        }).eq('id', execution_id);
        if (uncertainUpdateError) {
          console.error('[sequence-send-email] Failed to update execution status (uncertain send)', { error: uncertainUpdateError, execution_id });
        }
      } else if (isRateLimit) {
        // Reschedule in 1 hour
        const retryAt = new Date(Date.now() + 3600000).toISOString();
        const { error: rateLimitUpdateError } = await supabase.from('sequence_step_executions').update({
          status: 'scheduled',
          error_message: `Rate limit, rescheduled: ${sendResult.error}`,
          scheduled_at: retryAt,
        }).eq('id', execution_id);
        if (rateLimitUpdateError) {
          console.error('[sequence-send-email] Failed to reschedule rate-limited execution', { error: rateLimitUpdateError, execution_id });
        }
      } else {
        // Échec d'envoi : 'failed'. Le statut 'bounced' n'est posé qu'à la
        // réception d'un rebond réel (unipile-webhook, handleBounce) : aucune
        // erreur renvoyée ici ne signale un rebond (SEQ-107).
        const { error: failUpdateError } = await supabase.from('sequence_step_executions').update({
          status: 'failed',
          error_message: sendResult.error,
          executed_at: new Date().toISOString(),
          channel: 'email',
        }).eq('id', execution_id);
        if (failUpdateError) {
          console.error('[sequence-send-email] Failed to update execution status (failed)', { error: failUpdateError, execution_id });
        }
      }

      return json({
        success: false,
        error: sendResult.error,
      }); // 200 so process-sequences knows the function executed
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sequence-send-email] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
