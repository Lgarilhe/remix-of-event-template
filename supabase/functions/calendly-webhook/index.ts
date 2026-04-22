// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function verifyCalendlySignature(req: Request, body: string): Promise<boolean> {
  const signingKey = Deno.env.get('CALENDLY_WEBHOOK_SIGNING_KEY');
  if (!signingKey) {
    console.error('[calendly-webhook] ❌ CALENDLY_WEBHOOK_SIGNING_KEY not set — rejecting request. Configure this secret before using the webhook.');
    return false;
  }

  const signatureHeader = req.headers.get('Calendly-Webhook-Signature');
  if (!signatureHeader) {
    console.warn('[calendly-webhook] Missing Calendly-Webhook-Signature header');
    return false;
  }

  // Parse header: t=<timestamp>,v1=<signature>
  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key && value) parts[key.trim()] = value.trim();
  }

  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) {
    console.warn('[calendly-webhook] Invalid signature header format');
    return false;
  }

  // Check timestamp tolerance (5 minutes)
  const timestampMs = parseInt(timestamp, 10) * 1000;
  if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    console.warn('[calendly-webhook] Signature timestamp too old');
    return false;
  }

  // Compute expected signature: HMAC-SHA256(signing_key, timestamp + '.' + body)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = `${timestamp}.${body}`;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expectedSignature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expectedSignature !== signature) {
    console.warn('[calendly-webhook] Signature mismatch');
    return false;
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify Calendly webhook signature
    const rawBody = await req.text();
    const isValid = await verifyCalendlySignature(req, rawBody);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = JSON.parse(rawBody);
    console.log('[calendly-webhook] Received event:', body.event);

    // Handle webhook subscription verification
    if (body.event === 'ping') {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // We only care about invitee.created
    if (body.event !== 'invitee.created') {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = body.payload;
    const invitee = payload;
    const event = payload.event || payload.scheduled_event;

    // Only process our recruitment event type
    const ALLOWED_EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';
    const eventName = event?.name || null;
    if (eventName !== ALLOWED_EVENT_NAME) {
      console.log(`[calendly-webhook] Skipping event "${eventName}" (not matching "${ALLOWED_EVENT_NAME}")`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'event_type_mismatch' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract data
    const calendlyEventId = event?.uri?.split('/').pop() || null;
    const calendlyInviteeId = invitee?.uri?.split('/').pop() || null;
    const inviteeEmail = invitee?.email || null;
    const inviteeName = invitee?.name || null;
    const eventStartAt = event?.start_time || null;
    const eventEndAt = event?.end_time || null;

    // Extract location
    let eventLocation: string | null = null;
    if (event?.location) {
      eventLocation = event.location.join_url || event.location.location || event.location.type || null;
    }

    // Extract LinkedIn URL from custom questions (round robin-safe)
    let candidateLinkedinUrl: string | null = null;
    const questionsAndAnswers = invitee?.questions_and_answers || payload?.questions_and_answers || [];
    for (const qa of questionsAndAnswers) {
      const answer = qa.answer?.trim();
      const question = (qa.question || '').toLowerCase();
      if (!answer) continue;

      const looksLinkedin = /linkedin\.com/i.test(answer);
      if (looksLinkedin || question.includes('linkedin')) {
        if (looksLinkedin) {
          candidateLinkedinUrl = answer;
          break;
        }
      }
    }

    // Also check tracking params (from our URL pre-fill ?a1=...)
    const tracking = invitee?.tracking || payload?.tracking || {};
    if (!candidateLinkedinUrl && typeof tracking.utm_content === 'string' && /linkedin\.com/i.test(tracking.utm_content)) {
      candidateLinkedinUrl = tracking.utm_content.trim();
    }

    console.log('[calendly-webhook] Extracted:', {
      calendlyEventId,
      inviteeEmail,
      inviteeName,
      candidateLinkedinUrl,
      eventName,
      eventStartAt,
    });

    // Try to match candidate via LinkedIn URL in job_candidate_status
    let candidateMatch: {
      candidate_id?: string;
      candidate_name?: string;
      candidate_headline?: string;
      job_id?: string;
      job_title?: string;
      project_id?: string;
      linkedin_profile_url?: string;
      scoring_details?: any;
    } | null = null;

    // Validate LinkedIn URL (must be a real profile URL, not just "LinkedIn")
    const isValidLinkedinUrl = candidateLinkedinUrl && /^https?:\/\/(www\.)?linkedin\.com\/in\/.+/i.test(candidateLinkedinUrl);

    if (isValidLinkedinUrl) {
      const normalizedUrl = candidateLinkedinUrl!
        .replace(/\/$/, '')
        .replace(/^https?:\/\/(www\.)?linkedin\.com/, 'https://www.linkedin.com');

      const slug = normalizedUrl.split('linkedin.com')[1];
      if (slug && slug.length > 4) {
        const { data } = await supabase
          .from('job_candidate_status')
          .select('candidate_id, candidate_name, candidate_headline, job_id, linkedin_profile_url, scoring_details, project_id')
          .ilike('linkedin_profile_url', `%${slug}%`)
          .order('updated_at', { ascending: false })
          .limit(1);

        if (data?.length) {
          candidateMatch = data[0];
        }
      }
    }

    // Get job title if we have a match
    let jobTitle: string | null = null;
    let clientName: string | null = null;
    let projectId: string | null = null;

    if (candidateMatch?.project_id) {
      projectId = candidateMatch.project_id;
      const { data: project } = await supabase
        .from('sourcing_projects')
        .select('job_title, client_name')
        .eq('id', candidateMatch.project_id)
        .single();
      if (project) {
        jobTitle = project.job_title;
        clientName = project.client_name;
      }
    }

    // Get the first authenticated user as created_by (since webhook has no auth context)
    // We use the user who last interacted with this candidate if possible
    let createdBy: string | null = null;
    if (candidateMatch?.candidate_id) {
      const { data: statusRow } = await supabase
        .from('job_candidate_status')
        .select('created_by')
        .eq('candidate_id', candidateMatch.candidate_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      createdBy = statusRow?.created_by || null;
    }

    // Fallback: get any user from profiles
    if (!createdBy) {
      const { data: anyProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .limit(1)
        .single();
      createdBy = anyProfile?.user_id || null;
    }

    if (!createdBy) {
      console.error('[calendly-webhook] No user found to assign session');
      return new Response(JSON.stringify({ success: false, error: 'No user found' }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build scoring summary from existing scoring_details
    let scoringSummary: any = {};
    if (candidateMatch?.scoring_details) {
      const sd = candidateMatch.scoring_details as any;
      scoringSummary = {
        overall_score: sd.overall_score || sd.score || null,
        strengths: sd.strengths || [],
        weaknesses: sd.weaknesses || sd.gaps || [],
        recommendation: sd.recommendation || sd.verdict || null,
        key_criteria: sd.criteria_scores || sd.key_criteria || [],
      };
    }

    // Create qualification session
    const { data: session, error: sessionError } = await supabase
      .from('qualification_sessions')
      .insert({
        calendly_event_id: calendlyEventId,
        calendly_invitee_id: calendlyInviteeId,
        event_name: eventName,
        event_start_at: eventStartAt,
        event_end_at: eventEndAt,
        event_location: eventLocation,
        invitee_email: inviteeEmail,
        candidate_linkedin_url: candidateLinkedinUrl,
        candidate_name: candidateMatch?.candidate_name || inviteeName,
        candidate_headline: candidateMatch?.candidate_headline || null,
        candidate_profile_id: candidateMatch?.candidate_id || null,
        job_id: candidateMatch?.job_id || null,
        job_title: jobTitle,
        client_name: clientName,
        project_id: projectId,
        scoring_summary: scoringSummary,
        status: 'scheduled',
        created_by: createdBy,
      })
      .select()
      .single();

    if (sessionError) {
      console.error('[calendly-webhook] Error creating session:', sessionError);
      throw sessionError;
    }

    console.log('[calendly-webhook] Created qualification session:', session.id);

    // Update candidate status to 'qualification' + pipeline_stage if matched
    if (candidateMatch?.candidate_id && candidateMatch?.job_id) {
      await supabase
        .from('job_candidate_status')
        .update({ 
          status: 'qualification', 
          pipeline_stage: 'Pré-qualif',
          updated_at: new Date().toISOString(),
        })
        .eq('candidate_id', candidateMatch.candidate_id)
        .eq('job_id', candidateMatch.job_id);
      
      console.log('[calendly-webhook] Updated candidate status to qualification + Pré-qualif');
    }

    // Stop active sequences for this candidate (booking = sequence goal achieved)
    if (candidateMatch?.candidate_id || (isValidLinkedinUrl && candidateLinkedinUrl)) {
      try {
        // Find active enrollments matching this candidate by profile_id or LinkedIn URL
        let enrollmentsQuery = supabase
          .from('sequence_enrollments')
          .select('id, sequence_id')
          .eq('status', 'active');

        // Match by candidate_id (profile_id in enrollments) or by LinkedIn URL
        if (candidateMatch?.candidate_id) {
          enrollmentsQuery = enrollmentsQuery.eq('profile_id', candidateMatch.candidate_id);
        }

        const { data: activeEnrollments } = await enrollmentsQuery;

        // Also try matching by LinkedIn URL if no match by profile_id
        let urlEnrollments: any[] = [];
        if ((!activeEnrollments?.length) && isValidLinkedinUrl && candidateLinkedinUrl) {
          const slug = candidateLinkedinUrl!.replace(/\/$/, '').split('linkedin.com')[1];
          if (slug && slug.length > 4) {
            const { data } = await supabase
              .from('sequence_enrollments')
              .select('id, sequence_id')
              .eq('status', 'active')
              .ilike('profile_url', `%${slug}%`);
            urlEnrollments = data || [];
          }
        }

        const allEnrollments = [...(activeEnrollments || []), ...urlEnrollments];
        // Deduplicate by id
        const uniqueEnrollments = Array.from(new Map(allEnrollments.map(e => [e.id, e])).values());

        if (uniqueEnrollments.length > 0) {
          const enrollmentIds = uniqueEnrollments.map(e => e.id);
          const now = new Date().toISOString();

          // Mark enrollments as 'booked' (distinct from 'completed' for analytics)
          await supabase
            .from('sequence_enrollments')
            .update({ status: 'booked', completed_at: now })
            .in('id', enrollmentIds);

          // Cancel all scheduled step executions
          for (const enrollmentId of enrollmentIds) {
            await supabase
              .from('sequence_step_executions')
              .update({ status: 'cancelled', skip_reason: 'Calendly booking detected' })
              .eq('enrollment_id', enrollmentId)
              .in('status', ['scheduled', 'waiting_event']);
          }

          // Log analytics for each affected sequence
          const today = new Date().toISOString().split('T')[0];
          const sequenceIds = [...new Set(uniqueEnrollments.map(e => e.sequence_id))];
          for (const seqId of sequenceIds) {
            // Upsert into sequence_analytics — no calendly_booked column exists,
            // so we track via replies_received as a proxy (booking > reply)
            const { data: existing } = await supabase
              .from('sequence_analytics')
              .select('id, replies_received')
              .eq('sequence_id', seqId)
              .eq('date', today)
              .maybeSingle();

            if (existing) {
              await supabase.from('sequence_analytics').update({
                replies_received: (existing.replies_received || 0) + 1,
              }).eq('id', existing.id);
            } else {
              await supabase.from('sequence_analytics').insert({
                sequence_id: seqId, date: today, replies_received: 1,
              });
            }
          }

          console.log(`[calendly-webhook] ✅ Stopped ${uniqueEnrollments.length} active sequence(s) → status: booked`);
        } else {
          console.log('[calendly-webhook] No active sequence enrollments found for this candidate');
        }
      } catch (seqErr) {
        console.warn('[calendly-webhook] Sequence stop failed (non-blocking):', seqErr);
      }
    }

    // Try to update Notion candidate & shortlist status
    // Resolve Notion credentials from the org of the user who created the candidate entry
    let notionKey: string | null = null;
    let CANDIDATS_DATABASE_ID: string | null = null;
    let SHORTLIST_DATABASE_ID: string | null = null;

    if (createdBy) {
      // Find the org of the user who created the candidate entry
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_organization_id')
        .eq('user_id', createdBy)
        .single();

      if (profile?.active_organization_id) {
        const { data: integrationData } = await supabase
          .from('organization_integrations')
          .select('notion_api_key, notion_candidats_db_id, notion_shortlist_db_id, notion_connected')
          .eq('organization_id', profile.active_organization_id)
          .single();

        if (integrationData?.notion_connected && integrationData.notion_api_key) {
          notionKey = integrationData.notion_api_key;
          CANDIDATS_DATABASE_ID = integrationData.notion_candidats_db_id || null;
          SHORTLIST_DATABASE_ID = integrationData.notion_shortlist_db_id || null;
        }
      }
    }

    if (notionKey && CANDIDATS_DATABASE_ID && SHORTLIST_DATABASE_ID) {
      try {
        const notionHeaders = {
          'Authorization': `Bearer ${notionKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        };

        // Find candidate in Notion by name or LinkedIn URL
        let notionCandidateId: string | null = null;
        const candidateName = candidateMatch?.candidate_name || inviteeName;

        // Try LinkedIn URL first
        if (isValidLinkedinUrl && candidateLinkedinUrl) {
          const res = await fetchWithTimeout(`https://api.notion.com/v1/databases/${CANDIDATS_DATABASE_ID}/query`, {
            method: 'POST',
            headers: notionHeaders,
            body: JSON.stringify({
              filter: { property: 'URL Linkedin', url: { equals: candidateLinkedinUrl } },
              page_size: 1,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            notionCandidateId = data.results?.[0]?.id || null;
          }
        }

        // Fallback: try by name
        if (!notionCandidateId && candidateName) {
          const res = await fetchWithTimeout(`https://api.notion.com/v1/databases/${CANDIDATS_DATABASE_ID}/query`, {
            method: 'POST',
            headers: notionHeaders,
            body: JSON.stringify({
              filter: { property: 'Nom', title: { equals: candidateName } },
              page_size: 1,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            notionCandidateId = data.results?.[0]?.id || null;
          }
        }

        if (notionCandidateId) {
          // Update Candidat "Etat" → "Pré-qualif à planifier"
          await fetchWithTimeout(`https://api.notion.com/v1/pages/${notionCandidateId}`, {
            method: 'PATCH',
            headers: notionHeaders,
            body: JSON.stringify({
              properties: { 'Etat': { select: { name: 'Pré-qualif à planifier' } } },
            }),
          });
          console.log(`[calendly-webhook] ✅ Notion Candidat Etat → "Pré-qualif à planifier"`);

          // Update qualification_session with notion_candidate_id
          await supabase
            .from('qualification_sessions')
            .update({ notion_candidate_id: notionCandidateId })
            .eq('id', session.id);

          // Find and update all related shortlists "Etape" → "Pré-qualif"
          const slRes = await fetchWithTimeout(`https://api.notion.com/v1/databases/${SHORTLIST_DATABASE_ID}/query`, {
            method: 'POST',
            headers: notionHeaders,
            body: JSON.stringify({
              filter: { property: 'Candidats', relation: { contains: notionCandidateId } },
              page_size: 10,
            }),
          });
          if (slRes.ok) {
            const slData = await slRes.json();
            const shortlists = slData.results || [];
            for (const sl of shortlists) {
              await fetchWithTimeout(`https://api.notion.com/v1/pages/${sl.id}`, {
                method: 'PATCH',
                headers: notionHeaders,
                body: JSON.stringify({
                  properties: { 'Etape': { select: { name: 'Pré-qualif' } } },
                }),
              });
            }
            if (shortlists.length > 0) {
              // Store first shortlist ID in qualification session
              await supabase
                .from('qualification_sessions')
                .update({ notion_shortlist_id: shortlists[0].id })
                .eq('id', session.id);
              console.log(`[calendly-webhook] ✅ Updated ${shortlists.length} Notion shortlists Etape → "Pré-qualif"`);
            }
          }
        } else {
          console.log(`[calendly-webhook] Candidate not found in Notion: ${candidateName}`);
        }
      } catch (notionErr) {
        console.warn('[calendly-webhook] Notion update failed (non-blocking):', notionErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      session_id: session.id,
      candidate_matched: !!candidateMatch,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[calendly-webhook] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
