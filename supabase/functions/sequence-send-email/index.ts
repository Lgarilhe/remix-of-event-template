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

function resolveVariables(template: string, vars: Record<string, string | undefined>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  return result;
}

function generateTrackingId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function wrapLinksForTracking(html: string, trackingId: string, baseUrl: string): string {
  // Replace href="..." in anchor tags with tracking redirect
  return html.replace(
    /(<a\s[^>]*href=")([^"]+)("[^>]*>)/gi,
    (match, prefix, url, suffix) => {
      // Don't track mailto: or tel: links
      if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('#')) {
        return match;
      }
      const trackUrl = `${baseUrl}/functions/v1/sequence-email-track?tid=${trackingId}&evt=click&url=${encodeURIComponent(url)}`;
      return `${prefix}${trackUrl}${suffix}`;
    }
  );
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

    const { callAnthropicWithRetry: callWithRetry } = await import('../_shared/ai-config.ts');
    const result = await callWithRetry(ANTHROPIC_API_KEY!, {
      model: anthropicModel,
      max_tokens: 150,
      system: systemPrompt,
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
    return { success: false, error: 'Unipile not configured (no API key or DSN resolved for this org)' };
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
    return { success: false, error: `Unipile ${res.status}: ${errorBody}` };
  } catch (err) {
    return { success: false, error: `Unipile error: ${err instanceof Error ? err.message : String(err)}` };
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

  // Auth: service_role only
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token !== SUPABASE_SERVICE_ROLE_KEY) {
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

    // 4. Resolve variables in templates
    const candidateName = (enrollment.profile_name || '') as string;
    const nameParts = candidateName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Try to get calendly link from project
    let calendlyLink = '';
    if (enrollment.job_id) {
      const { data: project } = await supabase.from('sourcing_projects')
        .select('job_details')
        .eq('id', enrollment.job_id)
        .single();
      if (project?.job_details?.calendly_link) {
        calendlyLink = project.job_details.calendly_link;
      }
    }

    const templateVars: Record<string, string | undefined> = {
      first_name: firstName,
      last_name: lastName,
      company: enrollment.company_name as string || '',
      job_title: enrollment.job_title as string || enrollment.profile_headline as string || '',
      city: '',
      sender_name: senderName,
      calendly_link: calendlyLink,
    };

    // Use pre-personalized message from process-sequences if available (rich AI pipeline)
    // Otherwise fall back to template variable resolution + basic AI snippet
    let messageBody: string;
    let subject: string;

    if (pre_personalized_message) {
      // process-sequences already ran the full AI personalization pipeline
      messageBody = pre_personalized_message;
      subject = pre_personalized_subject || resolveVariables(step.subject_template || '', templateVars);
      console.log('[sequence-send-email] Using pre-personalized message from process-sequences');
    } else {
      messageBody = resolveVariables(step.message_template || '', templateVars);
      subject = resolveVariables(step.subject_template || '', templateVars);
    }

    // 5. AI Personalization (only if NOT pre-personalized)
    let aiSnippet: string | null = null;
    if (!pre_personalized_message && step.use_ai_personalization) {
      const orgId = sequence?.organization_id || enrollment.organization_id || null;
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
    if (step.include_unsubscribe) {
      const unsubLink = `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?email=${encodeURIComponent(recipientEmail)}`;
      htmlBody += `<br/><br/><p style="font-size:11px;color:#999;">Si vous ne souhaitez plus recevoir ces messages, <a href="${unsubLink}" style="color:#999;">cliquez ici</a>.</p>`;
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

    // Wrap links for click tracking
    htmlBody = wrapLinksForTracking(htmlBody, trackingId, SUPABASE_URL);

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
        sendResult = { success: false, error: 'No email sending method available. Connect an email account in Unipile or configure MICROSOFT_GRAPH_TOKEN.' };
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
