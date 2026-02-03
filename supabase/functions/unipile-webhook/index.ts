import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, unipile-auth, x-unipile-signature',
};

const WEBHOOK_SECRET = Deno.env.get('UNIPILE_WEBHOOK_SECRET');

interface WebhookPayload {
  event: string;
  account_id: string;
  data: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify webhook authenticity
    const authHeader = req.headers.get('unipile-auth');
    if (WEBHOOK_SECRET && authHeader !== WEBHOOK_SECRET) {
      console.error('[unipile-webhook] Invalid auth header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload: WebhookPayload = await req.json();
    console.log('[unipile-webhook] Received event:', payload.event, 'for account:', payload.account_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    switch (payload.event) {
      case 'new_relation': {
        // A connection request was accepted
        await handleNewRelation(supabase, payload);
        break;
      }
      
      case 'new_message': {
        // A new message was received
        await handleNewMessage(supabase, payload);
        break;
      }
      
      case 'account_connected':
      case 'account_disconnected':
      case 'account_error': {
        // Account status changes - log for now
        console.log('[unipile-webhook] Account status change:', payload.event, payload.data);
        break;
      }
      
      default:
        console.log('[unipile-webhook] Unknown event type:', payload.event);
    }

    // Must respond with 200 within 30 seconds
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[unipile-webhook] Error:', error);
    // Still return 200 to prevent retries for parsing errors
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleNewRelation(supabase: ReturnType<typeof createClient>, payload: WebhookPayload) {
  const { account_id, data } = payload;
  
  // Extract the profile ID of the new connection
  // Unipile sends: { user: { provider_id: "...", ... } }
  const newConnection = data.user as { provider_id?: string; id?: string } | undefined;
  const profileId = newConnection?.provider_id || newConnection?.id;
  
  if (!profileId) {
    console.log('[unipile-webhook] new_relation: No profile ID in payload', data);
    return;
  }

  console.log('[unipile-webhook] new_relation: Profile connected:', profileId);

  // Find enrollments waiting for this connection
  const { data: enrollments, error: enrollError } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('account_id', account_id)
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .in('connection_status', ['pending_invite', 'unknown']);

  if (enrollError) {
    console.error('[unipile-webhook] Error fetching enrollments:', enrollError);
    return;
  }

  if (!enrollments || enrollments.length === 0) {
    console.log('[unipile-webhook] No active enrollments found for this connection');
    return;
  }

  console.log(`[unipile-webhook] Found ${enrollments.length} enrollments to update`);

  for (const enrollment of enrollments) {
    // Update connection status to connected
    const { error: updateError } = await supabase
      .from('sequence_enrollments')
      .update({
        connection_status: 'connected',
        last_check_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id);

    if (updateError) {
      console.error('[unipile-webhook] Error updating enrollment:', updateError);
      continue;
    }

    // Log analytics
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('sequence_analytics')
      .upsert({
        sequence_id: enrollment.sequence_id,
        date: today,
        invites_accepted: 1,
      }, { onConflict: 'sequence_id,date' });

    console.log('[unipile-webhook] Updated enrollment:', enrollment.id, 'to connected');
  }
}

async function handleNewMessage(supabase: ReturnType<typeof createClient>, payload: WebhookPayload) {
  const { account_id, data } = payload;
  
  // Extract sender info from message
  // Unipile sends: { message: { sender_id: "...", ... }, chat: { ... } }
  const message = data.message as { sender_id?: string; attendee_provider_id?: string } | undefined;
  const senderId = message?.sender_id || message?.attendee_provider_id;
  
  if (!senderId) {
    console.log('[unipile-webhook] new_message: No sender ID in payload', data);
    return;
  }

  console.log('[unipile-webhook] new_message: From profile:', senderId);

  // Find active enrollments from this profile
  const { data: enrollments, error: enrollError } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('account_id', account_id)
    .eq('profile_id', senderId)
    .eq('status', 'active');

  if (enrollError) {
    console.error('[unipile-webhook] Error fetching enrollments:', enrollError);
    return;
  }

  if (!enrollments || enrollments.length === 0) {
    console.log('[unipile-webhook] No active enrollments found for this sender');
    return;
  }

  console.log(`[unipile-webhook] Found ${enrollments.length} enrollments - candidate replied!`);

  for (const enrollment of enrollments) {
    // Mark as replied and pause the sequence
    const { error: updateError } = await supabase
      .from('sequence_enrollments')
      .update({
        status: 'replied',
        replied_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id);

    if (updateError) {
      console.error('[unipile-webhook] Error updating enrollment:', updateError);
      continue;
    }

    // Log analytics
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('sequence_analytics')
      .upsert({
        sequence_id: enrollment.sequence_id,
        date: today,
        replies_received: 1,
      }, { onConflict: 'sequence_id,date' });

    console.log('[unipile-webhook] Enrollment', enrollment.id, 'marked as replied');
  }
}
