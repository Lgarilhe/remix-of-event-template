// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Env fallbacks — NEVER reassigned. Per-org credentials resolved per-request.
const ENV_UNIPILE_API_KEY: string | null = Deno.env.get('UNIPILE_API_KEY') || null;
const rawDsn = Deno.env.get('UNIPILE_DSN') || '';
const ENV_UNIPILE_DSN: string = rawDsn.startsWith('http') ? rawDsn : `https://${rawDsn}`;
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

interface PendingInvitation {
  provider_id: string;
  created_at?: string;
}

interface ProfileInfo {
  network_distance?: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK';
  public_identifier?: string;
  provider_id?: string;
}

/**
 * Resolve the actual network_distance for a profile.
 * Recruiter IDs (AEM...) often report incorrect network_distance,
 * so we re-check via the public_identifier (slug) when detected.
 */
async function resolveNetworkDistance(
  profileId: string,
  accountId: string,
  unipileApiKey: string | null,
  unipileDsn: string,
  profileUrl?: string | null,
): Promise<{ networkDistance: string | null; resolvedProviderId: string | null }> {
  const headers = { 'X-API-KEY': unipileApiKey! };

  // Step 1: Fetch profile info with the given ID
  const res = await fetchWithTimeout(
    `${unipileDsn}/api/v1/users/${profileId}?account_id=${accountId}`,
    { headers }
  );

  if (!res.ok) {
    console.log(`[check-invitation] Profile fetch failed for ${profileId}: ${res.status}`);
    return { networkDistance: null, resolvedProviderId: null };
  }

  const profile: ProfileInfo = await res.json();
  const isRecruiterID = profileId.startsWith('AEM');

  console.log(`[check-invitation] Profile ${profileId} | network_distance=${profile.network_distance} | isRecruiter=${isRecruiterID}`);

  // If it's already FIRST_DEGREE, no need for slug resolution
  if (profile.network_distance === 'FIRST_DEGREE') {
    return { networkDistance: 'FIRST_DEGREE', resolvedProviderId: profile.provider_id || null };
  }

  // Step 2: For Recruiter IDs, try to resolve via slug for accurate distance
  if (isRecruiterID) {
    // Try to extract slug from profile response or from profile_url
    let slug = profile.public_identifier;

    if (!slug && profileUrl) {
      // Try to extract slug from classic LinkedIn URL
      const classicMatch = profileUrl.match(/linkedin\.com\/in\/([^/?]+)/);
      if (classicMatch) {
        slug = classicMatch[1];
      }
    }

    if (slug) {
      console.log(`[check-invitation] Recruiter ID detected, re-checking via slug: ${slug}`);
      try {
        const slugRes = await fetchWithTimeout(
          `${unipileDsn}/api/v1/users/${slug}?account_id=${accountId}`,
          { headers }
        );

        if (slugRes.ok) {
          const slugProfile: ProfileInfo = await slugRes.json();
          console.log(`[check-invitation] Slug resolution: network_distance=${slugProfile.network_distance}`);
          return {
            networkDistance: slugProfile.network_distance || null,
            resolvedProviderId: slugProfile.provider_id || profile.provider_id || null,
          };
        }
      } catch (err) {
        console.error(`[check-invitation] Slug resolution error:`, err);
      }
    } else {
      console.log(`[check-invitation] No slug available for Recruiter ID ${profileId}`);
    }
  }

  return { networkDistance: profile.network_distance || null, resolvedProviderId: profile.provider_id || null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: validate JWT ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Resolve org-specific Unipile credentials into request-scoped locals
    let unipileApiKey = ENV_UNIPILE_API_KEY;
    let unipileDsn = ENV_UNIPILE_DSN;
    let orgId: string | null = null;
    try {
      const { resolveUnipileCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
      orgId = await resolveOrgIdFromUser(user.id, supabase);
      const creds = await resolveUnipileCredentials(orgId, supabase);
      if (creds) {
        unipileApiKey = creds.apiKey;
        unipileDsn = creds.dsn;
      }
    } catch (e) {
      console.warn('[check-invitation] Org credential resolution failed, using env:', e);
    }

    // An authenticated user may only sweep their OWN organization's enrollments.
    // Without this scope the service-role query below would touch every tenant.
    if (!orgId) {
      return new Response(JSON.stringify({ error: 'No organization for this user' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get all active enrollments with pending_invite OR pending check (scoped to the user's org)
    const { data: enrollments, error: enrollError } = await supabase
      .from('sequence_enrollments')
      .select('*')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .in('connection_status', ['pending_invite', 'not_connected']);

    if (enrollError) throw enrollError;

    const results = {
      checked: 0,
      connected: 0,
      still_pending: 0,
      errors: 0,
    };

    // Group by account_id for efficiency
    const byAccount = new Map<string, typeof enrollments>();
    for (const enrollment of enrollments || []) {
      const existing = byAccount.get(enrollment.account_id) || [];
      existing.push(enrollment);
      byAccount.set(enrollment.account_id, existing);
    }

    for (const [accountId, accountEnrollments] of byAccount) {
      // Get pending invitations for this account
      let pendingInvites: PendingInvitation[] = [];
      try {
        const response = await fetchWithTimeout(
          `${unipileDsn}/api/v1/users/invite/sent?account_id=${accountId}`,
          { headers: { 'X-API-KEY': unipileApiKey! } }
        );
        if (response.ok) {
          const data = await response.json();
          pendingInvites = data.items || [];
        }
      } catch (err) {
        console.error('Error fetching pending invites:', err);
      }

      const pendingProfileIds = new Set(pendingInvites.map(i => i.provider_id));

      for (const enrollment of accountEnrollments) {
        results.checked++;

        try {
          // Check if invitation is still pending (only for pending_invite status)
          if (enrollment.connection_status === 'pending_invite' && pendingProfileIds.has(enrollment.profile_id)) {
            results.still_pending++;
            
            await supabase
              .from('sequence_enrollments')
              .update({ last_check_at: new Date().toISOString() })
              .eq('id', enrollment.id);
            continue;
          }

          // Invitation not in pending list (or was previously not_connected) - check actual connection
          const { networkDistance } = await resolveNetworkDistance(
            enrollment.profile_id,
            accountId,
            unipileApiKey,
            unipileDsn,
            enrollment.profile_url,
          );

          if (networkDistance === 'FIRST_DEGREE') {
            // Connection accepted!
            results.connected++;
            console.log(`[check-invitation] ✅ ${enrollment.profile_name} is now FIRST_DEGREE!`);
            
            await supabase
              .from('sequence_enrollments')
              .update({
                connection_status: 'connected',
                network_distance: 'FIRST_DEGREE',
                last_check_at: new Date().toISOString(),
              })
              .eq('id', enrollment.id);

            // Resolve any waiting_event step execution so the sequence progresses immediately
            const { data: waitingExecs } = await supabase
              .from('sequence_step_executions')
              .select('id')
              .eq('enrollment_id', enrollment.id)
              .eq('status', 'waiting_event')
              .limit(1);

            if (waitingExecs && waitingExecs.length > 0) {
              await supabase
                .from('sequence_step_executions')
                .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
                .eq('id', waitingExecs[0].id);
              console.log(`[check-invitation] 🔄 Resolved waiting_event for ${enrollment.profile_name}`);
            }

            // Log analytics — incrément atomique (cf. increment_sequence_analytics)
            await supabase.rpc('increment_sequence_analytics', {
              p_sequence_id: enrollment.sequence_id,
              p_field: 'invites_accepted',
            });
          } else if (enrollment.connection_status === 'pending_invite') {
            // Only mark as not_connected if it was pending_invite and confirmed not connected
            await supabase
              .from('sequence_enrollments')
              .update({
                connection_status: 'not_connected',
                last_check_at: new Date().toISOString(),
              })
              .eq('id', enrollment.id);
          } else {
            // Just update the check timestamp for not_connected re-checks
            await supabase
              .from('sequence_enrollments')
              .update({ last_check_at: new Date().toISOString() })
              .eq('id', enrollment.id);
          }
        } catch (err) {
          console.error(`Error checking enrollment ${enrollment.id}:`, err);
          results.errors++;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Check invitation status error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
