import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const calendlyApiKey = Deno.env.get('CALENDLY_API_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Step 1: Get current user org
    const meRes = await fetch('https://api.calendly.com/users/me', {
      headers: { 'Authorization': `Bearer ${calendlyApiKey}` },
    });
    const meData = await meRes.json();
    const userUri = meData.resource?.uri;

    if (!userUri) throw new Error('Could not get Calendly user URI');

    // Step 2: Fetch last 50 scheduled events
    const now = new Date().toISOString();
    const eventsUrl = new URL('https://api.calendly.com/scheduled_events');
    eventsUrl.searchParams.set('user', userUri);
    eventsUrl.searchParams.set('count', '50');
    eventsUrl.searchParams.set('status', 'active');
    eventsUrl.searchParams.set('sort', 'start_time:desc');

    const eventsRes = await fetch(eventsUrl.toString(), {
      headers: { 'Authorization': `Bearer ${calendlyApiKey}` },
    });
    const eventsData = await eventsRes.json();
    const events = eventsData.collection || [];

    console.log(`[backfill] Found ${events.length} Calendly events`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const event of events) {
      const calendlyEventId = event.uri?.split('/').pop();

      // Check if session already exists
      const { data: existing } = await supabase
        .from('qualification_sessions')
        .select('id')
        .eq('calendly_event_id', calendlyEventId)
        .limit(1);

      if (existing?.length) {
        skipped++;
        continue;
      }

      // Fetch invitees for this event
      const inviteesRes = await fetch(`${event.uri}/invitees`, {
        headers: { 'Authorization': `Bearer ${calendlyApiKey}` },
      });
      const inviteesData = await inviteesRes.json();
      const invitee = inviteesData.collection?.[0];

      if (!invitee) {
        skipped++;
        continue;
      }

      const inviteeEmail = invitee.email || null;
      const inviteeName = invitee.name || null;
      const calendlyInviteeId = invitee.uri?.split('/').pop() || null;

      // Extract LinkedIn URL from questions
      let candidateLinkedinUrl: string | null = null;
      const questionsAndAnswers = invitee.questions_and_answers || [];
      for (const qa of questionsAndAnswers) {
        if (qa.position === 0 || qa.answer?.includes('linkedin.com')) {
          candidateLinkedinUrl = qa.answer?.trim() || null;
          break;
        }
      }

      // Also check tracking
      if (!candidateLinkedinUrl && invitee.tracking?.utm_content) {
        candidateLinkedinUrl = invitee.tracking.utm_content;
      }

      // Location
      let eventLocation: string | null = null;
      if (event.location) {
        eventLocation = event.location.join_url || event.location.location || event.location.type || null;
      }

      // Try to match candidate
      let candidateMatch: any = null;
      if (candidateLinkedinUrl) {
        const normalizedUrl = candidateLinkedinUrl
          .replace(/\/$/, '')
          .replace(/^https?:\/\/(www\.)?linkedin\.com/, 'https://www.linkedin.com');

        const { data } = await supabase
          .from('job_candidate_status')
          .select('candidate_id, candidate_name, candidate_headline, job_id, linkedin_profile_url, scoring_details, project_id, created_by')
          .ilike('linkedin_profile_url', `%${normalizedUrl.split('linkedin.com')[1] || normalizedUrl}%`)
          .order('updated_at', { ascending: false })
          .limit(1);

        if (data?.length) candidateMatch = data[0];
      }

      // Get project info
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

      // Determine created_by
      let createdBy = candidateMatch?.created_by || null;
      if (!createdBy) {
        const { data: anyProfile } = await supabase
          .from('profiles')
          .select('user_id')
          .limit(1)
          .single();
        createdBy = anyProfile?.user_id || null;
      }

      if (!createdBy) {
        errors++;
        continue;
      }

      // Build scoring summary
      let scoringSummary: any = {};
      if (candidateMatch?.scoring_details) {
        const sd = candidateMatch.scoring_details;
        scoringSummary = {
          overall_score: sd.overall_score || sd.score || null,
          strengths: sd.strengths || [],
          weaknesses: sd.weaknesses || sd.gaps || [],
          recommendation: sd.recommendation || sd.verdict || null,
        };
      }

      // Determine status based on event time
      const eventStart = new Date(event.start_time);
      const status = eventStart < new Date() ? 'completed' : 'scheduled';

      // Create session
      const { error: insertError } = await supabase
        .from('qualification_sessions')
        .insert({
          calendly_event_id: calendlyEventId,
          calendly_invitee_id: calendlyInviteeId,
          event_name: event.name || null,
          event_start_at: event.start_time || null,
          event_end_at: event.end_time || null,
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
          status,
          created_by: createdBy,
        });

      if (insertError) {
        console.error(`[backfill] Error for event ${calendlyEventId}:`, insertError);
        errors++;
      } else {
        created++;
        console.log(`[backfill] Created session for ${candidateMatch?.candidate_name || inviteeName} (${calendlyEventId})`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_events: events.length,
      created,
      skipped,
      errors,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[backfill] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
