import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN');

interface PendingInvitation {
  provider_id: string;
  created_at?: string;
}

interface ProfileInfo {
  network_distance?: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all active enrollments with pending_invite status
    const { data: enrollments, error: enrollError } = await supabase
      .from('sequence_enrollments')
      .select('*')
      .eq('status', 'active')
      .eq('connection_status', 'pending_invite');

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
        const response = await fetch(
          `${UNIPILE_DSN}/api/v1/users/invite/sent?account_id=${accountId}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
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
          // Check if invitation is still pending
          if (pendingProfileIds.has(enrollment.profile_id)) {
            results.still_pending++;
            
            // Update last_check_at
            await supabase
              .from('sequence_enrollments')
              .update({ last_check_at: new Date().toISOString() })
              .eq('id', enrollment.id);
            continue;
          }

          // Invitation not in pending list - check if connected
          const profileResponse = await fetch(
            `${UNIPILE_DSN}/api/v1/users/${enrollment.profile_id}?account_id=${accountId}`,
            { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
          );

          if (profileResponse.ok) {
            const profile: ProfileInfo = await profileResponse.json();
            
            if (profile.network_distance === 'FIRST_DEGREE') {
              // Connection accepted!
              results.connected++;
              
              await supabase
                .from('sequence_enrollments')
                .update({
                  connection_status: 'connected',
                  last_check_at: new Date().toISOString(),
                })
                .eq('id', enrollment.id);

              // Log analytics - upsert directly
              const today = new Date().toISOString().split('T')[0];
              await supabase
                .from('sequence_analytics')
                .upsert({
                  sequence_id: enrollment.sequence_id,
                  date: today,
                  invites_accepted: 1,
                }, { onConflict: 'sequence_id,date' });
            } else {
              // Invitation was rejected or expired
              await supabase
                .from('sequence_enrollments')
                .update({
                  connection_status: 'not_connected',
                  last_check_at: new Date().toISOString(),
                })
                .eq('id', enrollment.id);
            }
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
