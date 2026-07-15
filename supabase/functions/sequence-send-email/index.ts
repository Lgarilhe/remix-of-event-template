/**
 * Edge Function: sequence-send-email
 *
 * Sends an outreach email for a sequence step execution.
 * Called by process-sequences when it encounters an email step.
 * Handles: variable resolution, AI personalization, tracking pixel/link injection,
 * and sending via Microsoft Graph API or VPS MCP endpoint.
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";
import { resolveUnipileCredentials } from "../_shared/resolve-org-credentials.ts";
import { interpolatePlaceholders, buildSequenceContext } from "../_shared/template-interpolation.ts";
import { loadAiContextForEnrollment } from "../_shared/ai-context.ts";

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
// Note : UNIPILE_API_KEY/UNIPILE_DSN ne sont plus utilisés en globals.
// On résout les creds par organization via resolveUnipileCredentials() pour
// supporter le multi-tenant proprement (chaque org peut avoir son propre
// compte Unipile via organization_integrations).

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
async function signTrackedUrl(trackingId: string, url: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SUPABASE_SERVICE_ROLE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${trackingId}|${url}`));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function wrapLinksForTracking(html: string, trackingId: string, baseUrl: string): Promise<string> {
  const linkRegex = /(<a\s[^>]*href=")([^"]+)("[^>]*>)/gi;
  const shouldSkip = (url: string) =>
    url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('#') || url.includes('/unsubscribe?token=');

  // Passe 1 : collecter les urls à tracker et pré-calculer leur signature
  // (String.replace ne supporte pas les callbacks async).
  const sigs = new Map<string, string>();
  for (const m of html.matchAll(linkRegex)) {
    const url = m[2];
    if (!shouldSkip(url) && !sigs.has(url)) {
      sigs.set(url, await signTrackedUrl(trackingId, url));
    }
  }

  // Passe 2 : réécriture
  return html.replace(linkRegex, (match, prefix, url, suffix) => {
    // Don't track mailto: / tel: / anchor links, nor the unsubscribe link
    // (le réécrire en redirect de tracking compterait une désinscription
    // comme un clic et casserait la sémantique du lien opt-out).
    if (shouldSkip(url)) return match;
    const sig = sigs.get(url) || '';
    const trackUrl = `${baseUrl}/functions/v1/sequence-email-track?tid=${trackingId}&evt=click&url=${encodeURIComponent(url)}&sig=${sig}`;
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

    // Load AI context (Settings → Contexte IA) — user + org
    const emailAiContext = await loadAiContextForEnrollment(supabase, enrollment, step as { sender_id?: string | null });

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
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!unipileApiKey || !unipileDsn) {
    console.error('[sequence-send-email] Email provider not configured: missing API key or DSN for org');
    return { success: false, error: 'email_provider_not_configured' };
  }

  try {
    const toRecipients = [{ display_name: '', identifier: to }];
    const ccRecipients = (cc || []).filter(Boolean).map(e => ({ display_name: '', identifier: e }));
    const bccRecipients = (bcc || []).filter(Boolean).map(e => ({ display_name: '', identifier: e }));

    const payload: Record<string, unknown> = {
      account_id: accountId,
      subject,
      body: htmlBody,
      to: toRecipients,
      ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
      ...(bccRecipients.length > 0 ? { bcc: bccRecipients } : {}),
      ...(senderName ? { from: { display_name: senderName } } : {}),
      // Enable Unipile's native email tracking (opens + clicks) in addition to our pixel
      tracking_options: { opens: true, links: true },
    };

    const res = await fetchWithTimeout(`${unipileDsn}/api/v1/emails`, {
      method: 'POST',
      headers: {
        'X-API-KEY': unipileApiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      const messageId = data.email_id || data.id || data.message_id || `unipile-${crypto.randomUUID().slice(0, 8)}`;
      console.log(`[sequence-send-email] Unipile email sent: ${messageId}`);
      return { success: true, messageId };
    }

    const errorBody = await res.text();
    console.error(`[sequence-send-email] Email provider returned ${res.status}: ${errorBody}`);
    return { success: false, error: `email_send_failed_${res.status}` };
  } catch (err) {
    console.error(`[sequence-send-email] Email provider error:`, err);
    return { success: false, error: 'email_send_failed' };
  }
}

/**
 * Fallback: Send email via Microsoft Graph API (if Unipile email account not available).
 */
async function sendViaGraphApi(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  cc?: string[],
  bcc?: string[],
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients: [{ emailAddress: { address: to } }],
          ...(cc?.length ? { ccRecipients: cc.map(e => ({ emailAddress: { address: e } })) } : {}),
          ...(bcc?.length ? { bccRecipients: bcc.map(e => ({ emailAddress: { address: e } })) } : {}),
          from: { emailAddress: { address: from } },
        },
        saveToSentItems: true,
      }),
    });

    if (res.status === 202 || res.ok) {
      return { success: true, messageId: `graph-${crypto.randomUUID().slice(0, 8)}` };
    }

    const errorBody = await res.text();
    return { success: false, error: `Graph API ${res.status}: ${errorBody}` };
  } catch (err) {
    return { success: false, error: `Graph API error: ${err instanceof Error ? err.message : String(err)}` };
  }
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
      return new Response(JSON.stringify({ success: true, skipped: 'already_processed', status: execution.status }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
        return new Response(JSON.stringify({ error: 'Failed to update execution status' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'no_email' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
        return new Response(JSON.stringify({ success: false, error: 'suppression_check_failed' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (suppressed) {
        await supabase.from('sequence_step_executions').update({
          status: 'skipped',
          skip_reason: `Adresse en liste de suppression (${suppressed.reason || 'opt-out'})`,
          executed_at: new Date().toISOString(),
        }).eq('id', execution_id);
        console.warn(`[sequence-send-email] Recipient suppressed (${suppressed.reason}) — skipping send for execution ${execution_id}`);
        return new Response(JSON.stringify({ success: true, skipped: 'suppressed' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 3. Resolve sender info
    let senderEmail = '';
    let senderName = '';
    // Try to get sender from step.sender_id or sequence creator
    if (step.sender_id || sequence?.created_by) {
      const senderId = step.sender_id || sequence.created_by;
      const { data: profile } = await supabase.from('profiles').select('email, first_name, last_name').eq('id', senderId).single();
      if (profile) {
        senderEmail = profile.email || '';
        senderName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
      }
    }

    // org_id hoisted — needed both by AI snippet generator (line ~410) and
    // resolveUnipileCredentials (line ~490). Was previously block-scoped inside
    // the AI block, causing ReferenceError on the Unipile send path.
    const orgId = (sequence?.organization_id || enrollment.organization_id || null) as string | null;

    // 4. Resolve variables in templates via unified interpolation
    // (30+ vars FR + EN aliases + custom user variables + pipe filters)
    const senderUserId = (step.sender_id as string) || (sequence?.created_by as string) || null;
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
      aiSnippet = await generateAiSnippet(supabase as any, enrollment, step, orgId);

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

    // 6b. Add email signature if configured
    if (step.signature_id) {
      try {
        const { data: sig } = await supabase.from('email_signatures').select('content').eq('id', step.signature_id).single();
        if (sig?.content) {
          htmlBody += `<br/><br/>${sig.content}`;
        }
      } catch { /* signature not found — skip silently */ }
    }
    // Also handle {{signature}} variable in the body (for manual insertion)
    if (htmlBody.includes('{{signature}}') && step.signature_id) {
      try {
        const { data: sig } = await supabase.from('email_signatures').select('content').eq('id', step.signature_id).single();
        if (sig?.content) {
          htmlBody = htmlBody.replace(/\{\{signature\}\}/g, sig.content);
        }
      } catch { /* skip */ }
    }
    // Clean up any remaining {{signature}} if no signature configured
    htmlBody = htmlBody.replace(/\{\{signature\}\}/g, '');

    // 7. Add unsubscribe footer if enabled
    // Le lien pointe vers la page /unsubscribe du front (GET valide le token,
    // POST désinscrit + ajoute à suppressed_emails). L'ancien lien
    // `handle-email-unsubscribe?email=...` renvoyait 400 (le handler attend un
    // `token`, pas un `email`) → le candidat ne pouvait JAMAIS se désinscrire.
    if (step.include_unsubscribe) {
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

    // Insert tracking record
    const { error: trackingInsertError } = await supabase.from('sequence_email_tracking').insert({
      execution_id,
      tracking_id: trackingId,
    });
    if (trackingInsertError) {
      console.error('[sequence-send-email] Failed to insert tracking record', { error: trackingInsertError, execution_id, trackingId });
      return new Response(JSON.stringify({ error: 'Failed to create email tracking record' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Wrap links for click tracking (liens signés HMAC — anti open-redirect)
    htmlBody = await wrapLinksForTracking(htmlBody, trackingId, SUPABASE_URL);

    // Add tracking pixel
    htmlBody = addTrackingPixel(htmlBody, trackingId, SUPABASE_URL);

    // 9. Send email — priority: Unipile (uses connected email account) > Microsoft Graph (fallback)
    const cc = step.cc_emails as string[] || [];
    const bcc = step.bcc_emails as string[] || [];

    let sendResult: { success: boolean; messageId?: string; error?: string };

    // Determine which email account to use for sending
    // Priority: step.sender_id > enrollment.assigned_sender_id > enrollment.account_id
    const emailAccountId = (step.sender_id || enrollment.assigned_sender_id || enrollment.account_id || '') as string;

    // Resolve Unipile credentials per organization (multi-tenant safe).
    // Fallback automatique sur les env vars si pas de creds org-specific.
    const unipileCreds = await resolveUnipileCredentials(orgId, supabase);

    if (emailAccountId && unipileCreds?.apiKey && unipileCreds?.dsn) {
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
      // Fallback: Microsoft Graph API (if configured)
      const graphToken = Deno.env.get('MICROSOFT_GRAPH_TOKEN');
      if (graphToken) {
        sendResult = await sendViaGraphApi(graphToken, senderEmail, recipientEmail, subject, htmlBody, cc, bcc);
      } else {
        console.error('[sequence-send-email] No email sending method available (no email account connected, no fallback token configured)');
        sendResult = { success: false, error: 'no_email_method_available' };
      }
    }

    // 10. Update execution status
    if (sendResult.success) {
      const { error: sentUpdateError } = await supabase.from('sequence_step_executions').update({
        status: 'sent',
        executed_at: new Date().toISOString(),
        final_message: htmlBody,
        final_subject: subject,
        channel: 'email',
        ai_snippet: aiSnippet,
        personalized_subject: subject,
      }).eq('id', execution_id);
      if (sentUpdateError) {
        console.error('[sequence-send-email] Failed to update execution status (sent)', { error: sentUpdateError, execution_id });
        return new Response(JSON.stringify({ error: 'Email sent but failed to update execution status' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update tracking record with message ID
      if (sendResult.messageId) {
        const { error: trackingUpdateError } = await supabase.from('sequence_email_tracking').update({
          email_message_id: sendResult.messageId,
        }).eq('tracking_id', trackingId);
        if (trackingUpdateError) {
          console.error('[sequence-send-email] Failed to update tracking record with message ID', { error: trackingUpdateError, trackingId });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message_id: sendResult.messageId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      // Check if rate limited
      const errorStr = (sendResult.error || '').toLowerCase();
      const isRateLimit = errorStr.includes('429') || errorStr.includes('rate limit') || errorStr.includes('throttl');

      if (isRateLimit) {
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
        const isBounce = errorStr.includes('bounce') || errorStr.includes('invalid') || errorStr.includes('not found');
        const { error: failUpdateError } = await supabase.from('sequence_step_executions').update({
          status: isBounce ? 'bounced' : 'failed',
          error_message: sendResult.error,
          executed_at: new Date().toISOString(),
          channel: 'email',
        }).eq('id', execution_id);
        if (failUpdateError) {
          console.error('[sequence-send-email] Failed to update execution status (failed/bounced)', { error: failUpdateError, execution_id });
        }
      }

      return new Response(JSON.stringify({
        success: false,
        error: sendResult.error,
      }), {
        status: 200, // Return 200 so process-sequences knows the function executed
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
