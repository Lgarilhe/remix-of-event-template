// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// calendlyApiKey resolved per-request inside handler
const supabase = createClient(supabaseUrl, serviceRoleKey);

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function resolveOrgCredentials(orgId: string): Promise<string> {
  const { data } = await supabase
    .from('organization_integrations')
    .select('calendly_api_key, calendly_connected')
    .eq('organization_id', orgId)
    .single();

  if (!data?.calendly_connected || !data.calendly_api_key) {
    throw new Error('Intégration Calendly non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations.');
  }

  console.log('[backfill-calendly] Using org-specific Calendly credentials');
  return data.calendly_api_key as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: validate JWT and org membership ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const user = { id: claimsData.claims.sub as string };

    // Resolve org credentials
    let body: any = {};
    try { body = await req.json(); } catch {}
    const orgId = body?.organization_id || null;

    if (orgId) {
      const { data: membership } = await supabase.from('organization_members').select('id').eq('user_id', user.id).eq('organization_id', orgId).maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    if (!orgId) {
      throw new Error('organization_id est requis');
    }
    const calendlyApiKey = await resolveOrgCredentials(orgId);

    // Step 1: Get current user org
    const meRes = await fetchWithTimeout('https://api.calendly.com/users/me', {
      headers: { 'Authorization': `Bearer ${calendlyApiKey}` },
    });
    const meData = await meRes.json();
    const organizationUri = meData.resource?.current_organization;

    if (!organizationUri) throw new Error('Could not get Calendly organization URI');

    // Step 2: Fetch recent scheduled events across the whole organization (round robin included)
    const events: any[] = [];
    let nextPageToken: string | null = null;

    do {
      const eventsUrl = new URL('https://api.calendly.com/scheduled_events');
      eventsUrl.searchParams.set('organization', organizationUri);
      eventsUrl.searchParams.set('count', '100');
      eventsUrl.searchParams.set('status', 'active');
      eventsUrl.searchParams.set('sort', 'start_time:desc');
      if (nextPageToken) eventsUrl.searchParams.set('page_token', nextPageToken);

      const eventsRes = await fetchWithTimeout(eventsUrl.toString(), {
        headers: { 'Authorization': `Bearer ${calendlyApiKey}` },
      });

      if (!eventsRes.ok) {
        const errText = await eventsRes.text();
        throw new Error(`Calendly scheduled_events failed: ${eventsRes.status} - ${errText}`);
      }

      const eventsData = await eventsRes.json();
      events.push(...(eventsData.collection || []));
      nextPageToken = eventsData.pagination?.next_page_token || null;
    } while (nextPageToken && events.length < 300);

    console.log(`[backfill] Found ${events.length} Calendly events`);

    // Only keep events matching our recruitment event type
    const ALLOWED_EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';
    const filteredEvents = events.filter(e => e.name === ALLOWED_EVENT_NAME);
    console.log(`[backfill] Filtered to ${filteredEvents.length}/${events.length} matching "${ALLOWED_EVENT_NAME}"`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const event of filteredEvents) {
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
      const inviteesRes = await fetchWithTimeout(`${event.uri}/invitees`, {
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

      // Also check tracking
      if (!candidateLinkedinUrl && typeof invitee.tracking?.utm_content === 'string' && /linkedin\.com/i.test(invitee.tracking.utm_content)) {
        candidateLinkedinUrl = invitee.tracking.utm_content.trim();
      }

      // Location
      let eventLocation: string | null = null;
      if (event.location) {
        eventLocation = event.location.join_url || event.location.location || event.location.type || null;
      }

      // Validate LinkedIn URL before matching (must be a real URL, not just "LinkedIn")
      const isValidLinkedinUrl = candidateLinkedinUrl && /^https?:\/\/(www\.)?linkedin\.com\/in\/.+/i.test(candidateLinkedinUrl);

      // Try to match candidate
      let candidateMatch: any = null;
      if (isValidLinkedinUrl) {
        const normalizedUrl = candidateLinkedinUrl!
          .replace(/\/$/, '')
          .replace(/^https?:\/\/(www\.)?linkedin\.com/, 'https://www.linkedin.com');

        const slug = normalizedUrl.split('linkedin.com')[1];
        if (slug && slug.length > 4) {
          const { data } = await supabase
            .from('job_candidate_status')
            .select('candidate_id, candidate_name, candidate_headline, job_id, linkedin_profile_url, scoring_details, project_id, created_by')
            .ilike('linkedin_profile_url', `%${slug}%`)
            .order('updated_at', { ascending: false })
            .limit(1);

          if (data?.length) candidateMatch = data[0];
        }
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
