import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";

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

interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  profile_id: string;
  account_id: string;
  status: string;
  connection_status: string | null;
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
    console.log('[unipile-webhook] RAW PAYLOAD:', JSON.stringify(payload).slice(0, 1000));
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
      
      case 'new_message':
      case 'message_received': {
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

async function handleNewRelation(supabase: SupabaseClient, payload: WebhookPayload) {
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

async function handleNewMessage(supabase: SupabaseClient, payload: WebhookPayload) {
  const { account_id, data } = payload;
  
  // Handle different payload formats: 
  // - new_message: { message: {...}, chat: {...} }
  // - message_received: data IS the message directly, or { message: {...} }
  const rawMessage = (data.message || data) as Record<string, unknown>;
  
  const message = rawMessage as { 
    sender_id?: string; 
    attendee_provider_id?: string;
    sender?: { provider_id?: string; id?: string };
    is_sender?: boolean;
    is_sender_self?: boolean;
    sender_attendee_id?: string;
    chat_id?: string;
  };
  
  const chat = (data.chat || rawMessage.chat) as { id?: string } | undefined;
  const chatId = message?.chat_id || chat?.id || rawMessage.chat_id as string | undefined;
  
  console.log('[unipile-webhook] handleNewMessage payload keys:', Object.keys(data), '| chatId:', chatId);
  
  // Skip if this is a message WE sent (not a reply)
  // Check multiple fields: is_sender, is_sender_self
  if (message?.is_sender === true || message?.is_sender_self === true) {
    console.log('[unipile-webhook] new_message: Skipping - this is our own sent message');
    return;
  }
  
  // For ambiguous cases (InMails where is_sender/is_sender_self are both undefined),
  // resolve our own attendee ID from the chat to verify
  if (message?.is_sender === undefined && message?.is_sender_self === undefined && chatId) {
    try {
      const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN')!;
      const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')!;
      // Use the dedicated attendees endpoint
      const attRes = await fetch(`${UNIPILE_DSN}/api/v1/chats/${chatId}/attendees`, { headers: { 'X-API-KEY': UNIPILE_API_KEY } });
      if (attRes.ok) {
        const attData = await attRes.json();
        const attendees = attData.items || attData || [];
        const attendeeList = Array.isArray(attendees) ? attendees : [];
        // deno-lint-ignore no-explicit-any
        const ownAttendee = attendeeList.find((a: any) => a.is_self === true || a.is_self === 1 || a.role === 'self');
        // deno-lint-ignore no-explicit-any
        const otherAttendees = attendeeList.filter((a: any) => a.is_self === false || a.is_self === 0);
        // Collect other attendee IDs
        // deno-lint-ignore no-explicit-any
        const otherIds = new Set(otherAttendees.flatMap((a: any) => [a.id, a.provider_id, a.attendee_id].filter(Boolean)));
        
        if (ownAttendee && message?.sender_attendee_id && 
            (ownAttendee.id === message.sender_attendee_id || ownAttendee.provider_id === message.sender_attendee_id || ownAttendee.attendee_id === message.sender_attendee_id)) {
          console.log('[unipile-webhook] new_message: Skipping - sender is our own attendee ID:', message.sender_attendee_id);
          return;
        }
        // If no ownAttendee found (Recruiter InMails return only prospects with is_self=0),
        // check if sender is in otherIds (prospect) → genuine reply, let it through
        if (!ownAttendee && otherIds.size > 0 && message?.sender_attendee_id) {
          if (otherIds.has(message.sender_attendee_id)) {
            console.log('[unipile-webhook] new_message: Sender matches prospect attendee — genuine reply');
            // Fall through to process as reply
          } else {
            console.log('[unipile-webhook] new_message: Sender not in prospect IDs, likely self — skipping');
            return;
          }
        }
        if (!ownAttendee && otherIds.size === 0) {
          console.log('[unipile-webhook] new_message: WARNING - could not classify any attendee, skipping');
          return;
        }
      }
    } catch (e) {
      console.warn('[unipile-webhook] Failed to verify sender via chat attendees:', e);
      console.log('[unipile-webhook] new_message: Skipping ambiguous message to prevent false positive');
      return;
    }
  }
  
  // Try multiple ways to extract the sender's profile ID
  const senderId = message?.sender?.provider_id || 
                   message?.sender?.id || 
                   message?.sender_id || 
                   message?.attendee_provider_id;
  
  if (!senderId) {
    console.log('[unipile-webhook] new_message: No sender ID in payload', JSON.stringify(data, null, 2));
    return;
  }

  console.log('[unipile-webhook] new_message: From profile:', senderId, '| Account:', account_id);

  // Find active enrollments - try exact match first, then partial match for ID format variations
  // LinkedIn IDs can come in different formats: "AEMAABl08fo...", "ACo...", "urn:li:member:..."
  let enrollments: SequenceEnrollment[] = [];
  
  // Try exact match first
  const { data: exactMatch, error: exactError } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('account_id', account_id)
    .eq('profile_id', senderId)
    .eq('status', 'active');

  if (exactError) {
    console.error('[unipile-webhook] Error fetching enrollments (exact):', exactError);
    return;
  }

  if (exactMatch && exactMatch.length > 0) {
    enrollments = exactMatch as SequenceEnrollment[];
  } else {
    // Try matching by profile URL containing the sender ID (for cases where format differs)
    // This is more robust as profile_url is normalized
    const { data: urlMatch, error: urlError } = await supabase
      .from('sequence_enrollments')
      .select('*')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .like('profile_url', `%${senderId}%`);

    if (!urlError && urlMatch && urlMatch.length > 0) {
      enrollments = urlMatch as SequenceEnrollment[];
      console.log('[unipile-webhook] Matched via profile_url fallback');
    }
  }

  if (enrollments.length === 0) {
    console.log('[unipile-webhook] No active enrollments found for sender:', senderId);
  } else {
    // Extra validation: log the matched profiles to help debug false positives
    console.log(`[unipile-webhook] Found ${enrollments.length} enrollment(s) - marking as replied:`, 
      enrollments.map(e => ({ id: e.id, profile_id: e.profile_id })));

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

      // Cancel any pending step executions
      await supabase
        .from('sequence_step_executions')
        .update({
          status: 'cancelled',
          skip_reason: 'Reply detected via webhook',
          updated_at: new Date().toISOString(),
        })
        .eq('enrollment_id', enrollment.id)
        .eq('status', 'scheduled');

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

  // Also update inmail_queue entries for this sender (for ATS tracking)
  // Only use exact match to avoid false positives
  const { data: inmailMatches } = await supabase
    .from('inmail_queue')
    .select('id, recipient_profile_id')
    .eq('status', 'sent')
    .eq('recipient_profile_id', senderId);

  if (inmailMatches && inmailMatches.length > 0) {
    console.log(`[unipile-webhook] Marking ${inmailMatches.length} inmail_queue entries as replied`);
    const inmailIds = inmailMatches.map(m => m.id);
    await supabase
      .from('inmail_queue')
      .update({
        status: 'replied',
        updated_at: new Date().toISOString(),
      })
      .in('id', inmailIds);
  }

  // ── Trigger auto-analysis for intent detection & status update ──
  if (chatId) {
    console.log(`[unipile-webhook] Triggering auto-analyze for chat: ${chatId}`);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Fire-and-forget: don't await to keep webhook fast
    fetch(`${supabaseUrl}/functions/v1/auto-analyze-message`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        account_id: account_id,
        sender_id: senderId,
      }),
    }).then(res => {
      console.log(`[unipile-webhook] Auto-analyze triggered: ${res.status}`);
    }).catch(err => {
      console.error('[unipile-webhook] Auto-analyze trigger failed:', err);
    });
  }
}
