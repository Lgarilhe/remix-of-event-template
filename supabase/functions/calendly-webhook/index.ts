import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json();
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
        status: 200,
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

    // Update candidate status to 'qualification' if matched
    if (candidateMatch?.candidate_id && candidateMatch?.job_id) {
      await supabase
        .from('job_candidate_status')
        .update({ status: 'qualification' })
        .eq('candidate_id', candidateMatch.candidate_id)
        .eq('job_id', candidateMatch.job_id);
      
      console.log('[calendly-webhook] Updated candidate status to qualification');
    }

    // Try to update Notion shortlist status
    if (candidateMatch?.candidate_id && candidateMatch?.job_id) {
      try {
        const notionKey = Deno.env.get('NOTION_API_KEY');
        if (notionKey) {
          await fetch(`${supabaseUrl}/functions/v1/update-candidate-stage`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              candidateId: candidateMatch.candidate_id,
              jobId: candidateMatch.job_id,
              stage: 'Pré-qualif',
              status: 'RDV planifié',
            }),
          });
          console.log('[calendly-webhook] Notion status update triggered');
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
      status: 200, // Return 200 so Calendly doesn't retry
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
