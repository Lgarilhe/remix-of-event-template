/**
 * Edge Function: sequence-send-email
 *
 * Sends an outreach email for a sequence step execution.
 * Called by process-sequences when it encounters an email step.
 * Handles: variable resolution, AI personalization, tracking pixel/link injection,
 * and sending via Microsoft Graph API or VPS MCP endpoint.
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MCP_ENDPOINT = Deno.env.get('OUTLOOK_MCP_ENDPOINT') || 'https://srv883112.hstgr.cloud/mcp/claude';

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

      const ragRes = await fetch(`${SUPABASE_URL}/functions/v1/${ragEndpoint}`, {
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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      console.warn('[sequence-send-email] Anthropic API error:', response.status);
      return null;
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text;
    return text || null;
  } catch (err) {
    console.warn('[sequence-send-email] AI personalization error:', err);
    return null;
  }
}

// ============ EMAIL SENDING ============

async function sendViaGraphApi(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  cc?: string[],
  bcc?: string[],
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const toRecipients = [{ emailAddress: { address: to } }];
  const ccRecipients = (cc || []).map(e => ({ emailAddress: { address: e } }));
  const bccRecipients = (bcc || []).map(e => ({ emailAddress: { address: e } }));

  const payload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients,
      ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
      ...(bccRecipients.length > 0 ? { bccRecipients } : {}),
      from: { emailAddress: { address: from } },
    },
    saveToSentItems: true,
  };

  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 202 || res.ok) {
      // Microsoft Graph returns 202 Accepted for sendMail
      // Message-ID is not directly available from sendMail, check sent items
      return { success: true, messageId: `graph-${crypto.randomUUID().slice(0, 8)}` };
    }

    const errorBody = await res.text();
    return { success: false, error: `Graph API ${res.status}: ${errorBody}` };
  } catch (err) {
    return { success: false, error: `Graph API error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function sendViaMcp(
  to: string,
  subject: string,
  htmlBody: string,
  cc?: string[],
  bcc?: string[],
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_email',
        to,
        subject,
        body: htmlBody,
        content_type: 'html',
        ...(cc?.length ? { cc } : {}),
        ...(bcc?.length ? { bcc } : {}),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, messageId: data.message_id || `mcp-${crypto.randomUUID().slice(0, 8)}` };
    }

    const errorBody = await res.text();
    return { success: false, error: `MCP ${res.status}: ${errorBody}` };
  } catch (err) {
    return { success: false, error: `MCP error: ${err instanceof Error ? err.message : String(err)}` };
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
      await supabase.from('sequence_step_executions').update({
        status: 'failed',
        error_message: 'no_email: No email address available for this candidate',
        executed_at: new Date().toISOString(),
      }).eq('id', execution_id);

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
      aiSnippet = await generateAiSnippet(supabase, enrollment, step, orgId);

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

    // 7. Add unsubscribe footer if enabled
    if (step.include_unsubscribe) {
      const unsubLink = `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?email=${encodeURIComponent(recipientEmail)}`;
      htmlBody += `<br/><br/><p style="font-size:11px;color:#999;">Si vous ne souhaitez plus recevoir ces messages, <a href="${unsubLink}" style="color:#999;">cliquez ici</a>.</p>`;
    }

    // 8. Email tracking
    const trackingId = generateTrackingId();

    // Insert tracking record
    await supabase.from('sequence_email_tracking').insert({
      execution_id,
      tracking_id: trackingId,
    });

    // Wrap links for click tracking
    htmlBody = wrapLinksForTracking(htmlBody, trackingId, SUPABASE_URL);

    // Add tracking pixel
    htmlBody = addTrackingPixel(htmlBody, trackingId, SUPABASE_URL);

    // 9. Send email
    const cc = step.cc_emails as string[] || [];
    const bcc = step.bcc_emails as string[] || [];

    let sendResult: { success: boolean; messageId?: string; error?: string };

    // Try Microsoft Graph API first if OAuth token is available
    const graphToken = Deno.env.get('MICROSOFT_GRAPH_TOKEN');
    if (graphToken) {
      sendResult = await sendViaGraphApi(graphToken, senderEmail, recipientEmail, subject, htmlBody, cc, bcc);
    } else {
      // Fallback to VPS MCP endpoint
      sendResult = await sendViaMcp(recipientEmail, subject, htmlBody, cc, bcc);
    }

    // 10. Update execution status
    if (sendResult.success) {
      await supabase.from('sequence_step_executions').update({
        status: 'sent',
        executed_at: new Date().toISOString(),
        final_message: htmlBody,
        final_subject: subject,
        channel: 'email',
        ai_snippet: aiSnippet,
        personalized_subject: subject,
      }).eq('id', execution_id);

      // Update tracking record with message ID
      if (sendResult.messageId) {
        await supabase.from('sequence_email_tracking').update({
          email_message_id: sendResult.messageId,
        }).eq('tracking_id', trackingId);
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
        await supabase.from('sequence_step_executions').update({
          status: 'scheduled',
          error_message: `Rate limit, rescheduled: ${sendResult.error}`,
          scheduled_at: retryAt,
        }).eq('id', execution_id);
      } else {
        const isBounce = errorStr.includes('bounce') || errorStr.includes('invalid') || errorStr.includes('not found');
        await supabase.from('sequence_step_executions').update({
          status: isBounce ? 'bounced' : 'failed',
          error_message: sendResult.error,
          executed_at: new Date().toISOString(),
          channel: 'email',
        }).eq('id', execution_id);
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
