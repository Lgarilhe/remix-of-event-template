// Deno.serve used directly
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, unipile-auth, x-unipile-signature',
};

const WEBHOOK_SECRET = Deno.env.get('UNIPILE_WEBHOOK_SECRET');
if (!WEBHOOK_SECRET) console.warn('[unipile-webhook] ⚠️ UNIPILE_WEBHOOK_SECRET not set — webhook auth is DISABLED, all requests will be accepted');

// Timeout wrapper for all external fetch calls (Unipile, Anthropic, Notion)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Sanitize IDs before interpolating into PostgREST filter strings (.or(), .like())
// Prevents filter injection via special characters (commas, dots, parens)
function sanitizeFilterId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-:]/g, '');
}


interface WebhookPayload {
  event: string;
  account_id: string;
  data?: Record<string, unknown>;
  // new_relation format (flat)
  user_provider_id?: string;
  user_full_name?: string;
  user_public_identifier?: string;
  user_profile_url?: string;
  // message_received format (flat structure)
  chat_id?: string;
  sender?: { attendee_id?: string; attendee_provider_id?: string; attendee_name?: string; attendee_profile_url?: string };
  attendees?: Array<{ attendee_provider_id?: string; attendee_name?: string; attendee_profile_url?: string }>;
}

interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  profile_id: string;
  account_id: string;
  status: string;
  connection_status: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify webhook authenticity
    const authHeader = req.headers.get('unipile-auth');
    if (!WEBHOOK_SECRET) {
      console.error('[unipile-webhook] ⚠️ UNIPILE_WEBHOOK_SECRET not set — rejecting request. Configure this secret!');
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!authHeader || authHeader !== WEBHOOK_SECRET) {
      console.error('[unipile-webhook] Invalid or missing auth header');
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
      
      case 'account_connected': {
        console.log('[unipile-webhook] Account connected:', payload.account_id);
        // Update status in member_linkedin_accounts if the column exists
        try {
          await supabase
            .from('member_linkedin_accounts')
            .update({ account_status: 'OK', last_checked_at: new Date().toISOString(), failure_reason: null })
            .eq('linkedin_account_id', payload.account_id);
        } catch (e) {
          // Column may not exist yet — silently ignore
          console.warn('[unipile-webhook] Could not update account status (column may not exist):', e);
        }
        break;
      }

      case 'account_disconnected':
      case 'account_error': {
        const reason = payload.event === 'account_disconnected' ? 'disconnected' : 'error';
        const details = JSON.stringify(payload.data || {}).slice(0, 500);
        console.warn(`[unipile-webhook] Account ${reason}:`, payload.account_id, details);

        // Update status in member_linkedin_accounts
        try {
          await supabase
            .from('member_linkedin_accounts')
            .update({
              account_status: reason === 'disconnected' ? 'CREDENTIALS' : 'ERROR',
              last_checked_at: new Date().toISOString(),
              failure_reason: details,
            })
            .eq('linkedin_account_id', payload.account_id);
        } catch (e) {
          console.warn('[unipile-webhook] Could not update account status:', e);
        }

        // Find users linked to this account and create notifications
        try {
          const { data: linkedUsers } = await supabase
            .from('member_linkedin_accounts')
            .select('user_id, organization_id, linkedin_account_name')
            .eq('linkedin_account_id', payload.account_id);

          if (linkedUsers && linkedUsers.length > 0) {
            const notifications = linkedUsers.map((u: any) => ({
              user_id: u.user_id,
              organization_id: u.organization_id,
              type: 'linkedin_disconnected',
              title: 'Compte LinkedIn déconnecté',
              message: `Votre compte LinkedIn "${u.linkedin_account_name || 'LinkedIn'}" a été déconnecté. Reconnectez-le dans Paramètres > Mon compte.`,
              read: false,
              metadata: { account_id: payload.account_id, reason, details },
            }));

            await supabase.from('notifications').insert(notifications).catch((e: unknown) =>
              console.warn('[unipile-webhook] Could not create notifications (table may not exist):', e)
            );
          }
        } catch (e) {
          console.warn('[unipile-webhook] Error creating disconnect notifications:', e);
        }
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
  const { account_id } = payload;
  
  // Unipile sends flat payload: user_provider_id, user_full_name, user_public_identifier
  // Also support legacy nested format: data.user.provider_id
  const profileId = payload.user_provider_id 
    || (payload.data?.user as { provider_id?: string; id?: string } | undefined)?.provider_id 
    || (payload.data?.user as { provider_id?: string; id?: string } | undefined)?.id;
  
  const userName = payload.user_full_name || '';
  const publicIdentifier = payload.user_public_identifier || '';
  
  if (!profileId) {
    console.log('[unipile-webhook] new_relation: No profile ID in payload', JSON.stringify(payload).slice(0, 500));
    return;
  }

  console.log(`[unipile-webhook] new_relation: Profile connected: ${profileId} (${userName}, slug: ${publicIdentifier})`);

  // Find enrollments waiting for this connection
  // Match on profile_id OR resolved_profile_id to handle Recruiter IDs (AEM -> ACo)
  const { data: enrollments, error: enrollError } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('account_id', account_id)
    .eq('status', 'active')
    .in('connection_status', ['pending_invite', 'unknown', 'not_connected'])
    .or(`profile_id.eq.${sanitizeFilterId(profileId)},resolved_profile_id.eq.${sanitizeFilterId(profileId)},provider_id.eq.${sanitizeFilterId(profileId)}`);

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
    // Update connection status + network_distance to connected
    const { error: updateError } = await supabase
      .from('sequence_enrollments')
      .update({
        connection_status: 'connected',
        network_distance: 'FIRST_DEGREE',
        last_check_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id);

    if (updateError) {
      console.error('[unipile-webhook] Error updating enrollment:', updateError);
      continue;
    }

    // CRITICAL: Resolve the pending wait_connection step execution
    // Find the wait_connection step for this enrollment that is waiting
    const { data: waitSteps } = await supabase
      .from('sequence_step_executions')
      .select('id, step_id, step_order')
      .eq('enrollment_id', enrollment.id)
      .in('status', ['waiting_event', 'scheduled'])
      .order('step_order', { ascending: true })
      .limit(1);

    if (waitSteps && waitSteps.length > 0) {
      const waitStep = waitSteps[0];
      // Verify this is indeed a wait_connection step
      const { data: stepDef } = await supabase
        .from('sequence_steps')
        .select('action_type, if_true_goto_step')
        .eq('id', waitStep.step_id)
        .single();

      if (stepDef?.action_type === 'wait_connection') {
        // Mark as sent (connection accepted)
        await supabase
          .from('sequence_step_executions')
          .update({
            status: 'sent',
            executed_at: new Date().toISOString(),
          })
          .eq('id', waitStep.id);

        // Determine next step (if_true_goto_step = connection accepted path)
        const nextStepId = stepDef.if_true_goto_step;
        if (nextStepId) {
          // Get the next step details to schedule it
          const { data: nextStep } = await supabase
            .from('sequence_steps')
            .select('*')
            .eq('id', nextStepId)
            .single();

          if (nextStep) {
            // Schedule next step with appropriate delay
            const delayMs = ((nextStep.delay_days || 0) * 86400 + (nextStep.delay_hours || 0) * 3600 + (nextStep.delay_minutes || 0) * 60) * 1000;
            const scheduledAt = new Date(Date.now() + delayMs);
            
            // Check for duplicates first
            const { data: existing } = await supabase
              .from('sequence_step_executions')
              .select('id')
              .eq('enrollment_id', enrollment.id)
              .eq('step_id', nextStepId)
              .in('status', ['scheduled', 'sent', 'waiting_event'])
              .limit(1);

            if (!existing || existing.length === 0) {
              await supabase
                .from('sequence_step_executions')
                .insert({
                  enrollment_id: enrollment.id,
                  step_id: nextStepId,
                  step_order: nextStep.step_order,
                  status: 'scheduled',
                  scheduled_at: scheduledAt.toISOString(),
                });

              // Update enrollment current step
              await supabase
                .from('sequence_enrollments')
                .update({ current_step_order: nextStep.step_order })
                .eq('id', enrollment.id);

              console.log(`[unipile-webhook] Scheduled next step ${nextStep.action_type} (order ${nextStep.step_order}) for enrollment ${enrollment.id}`);
            }
          }
        }

        console.log(`[unipile-webhook] Resolved wait_connection step for enrollment ${enrollment.id}`);
      }
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
  
  // Handle two payload formats:
  // 1. new_message: { data: { message: {...}, chat: {...} } }
  // 2. message_received: { chat_id, sender: {...}, attendees: [...] } (flat, no data)
  
  let chatId: string | undefined;
  let senderId: string | undefined;
  let isSenderSelf: boolean | undefined;
  let senderAttendeeId: string | undefined;
  
  if (payload.sender && payload.chat_id) {
    // message_received format (flat)
    console.log('[unipile-webhook] Processing message_received format');
    chatId = payload.chat_id;
    senderId = payload.sender.attendee_provider_id;
    senderAttendeeId = payload.sender.attendee_id;
    // In message_received, the sender is always the other person (not us)
    isSenderSelf = false;
  } else if (data) {
    // new_message format (nested)
    console.log('[unipile-webhook] Processing new_message format');
    const message = data.message as { 
      sender_id?: string; 
      attendee_provider_id?: string;
      sender?: { provider_id?: string; id?: string };
      is_sender?: boolean;
      is_sender_self?: boolean;
      sender_attendee_id?: string;
      chat_id?: string;
    } | undefined;
    
    const chat = data.chat as { id?: string } | undefined;
    chatId = message?.chat_id || chat?.id;
    senderId = message?.sender?.provider_id || message?.sender?.id || message?.sender_id || message?.attendee_provider_id;
    isSenderSelf = message?.is_sender === true || message?.is_sender_self === true ? true : 
                   message?.is_sender === false || message?.is_sender_self === false ? false : undefined;
    senderAttendeeId = message?.sender_attendee_id;
  } else {
    console.log('[unipile-webhook] handleNewMessage: Unrecognized payload format, keys:', Object.keys(payload));
    return;
  }
  
  // Skip if this is a message WE sent
  if (isSenderSelf === true) {
    console.log('[unipile-webhook] Skipping - this is our own sent message');
    return;
  }
  
  // For ambiguous cases (is_sender undefined), resolve via chat attendees API
  if (isSenderSelf === undefined && chatId && senderAttendeeId) {
    try {
      const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN')!;
      const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')!;
      const attRes = await fetchWithTimeout(`https://${UNIPILE_DSN}/api/v1/chats/${chatId}/attendees`, { headers: { 'X-API-KEY': UNIPILE_API_KEY } });
      if (attRes.ok) {
        const attData = await attRes.json();
        const attendees = attData.items || attData || [];
        const attendeeList = Array.isArray(attendees) ? attendees : [];
        // deno-lint-ignore no-explicit-any
        const ownAttendee = attendeeList.find((a: any) => a.is_self === true || a.is_self === 1 || a.role === 'self');
        if (ownAttendee && (ownAttendee.id === senderAttendeeId || ownAttendee.provider_id === senderAttendeeId || ownAttendee.attendee_id === senderAttendeeId)) {
          console.log('[unipile-webhook] Skipping - sender is our own attendee');
          return;
        }
      } else {
        await attRes.text(); // consume body
      }
    } catch (e) {
      console.warn('[unipile-webhook] Failed to verify sender via attendees:', e);
    }
  }
  
  if (!senderId) {
    console.log('[unipile-webhook] No sender ID found in payload');
    return;
  }

  console.log('[unipile-webhook] Message from:', senderId, '| Chat:', chatId, '| Account:', account_id);

  // Find active enrollments - try exact match first, then partial match for ID format variations
  // LinkedIn IDs can come in different formats: "AEMAABl08fo...", "ACo...", "urn:li:member:..."
  let enrollments: SequenceEnrollment[] = [];
  
  // Try exact match first (profile_id or resolved_profile_id)
  const { data: exactMatch, error: exactError } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('account_id', account_id)
    .eq('status', 'active')
    .or(`profile_id.eq.${sanitizeFilterId(senderId)},resolved_profile_id.eq.${sanitizeFilterId(senderId)}`);

  if (exactError) {
    console.error('[unipile-webhook] Error fetching enrollments (exact):', exactError);
    return;
  }

  if (exactMatch && exactMatch.length > 0) {
    enrollments = exactMatch as SequenceEnrollment[];
  } else {
    // Try matching by profile URL containing the sender ID (for cases where format differs)
    const { data: urlMatch, error: urlError } = await supabase
      .from('sequence_enrollments')
      .select('*')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .like('profile_url', `%${sanitizeFilterId(senderId)}%`);

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

      // Update job_candidate_status to 'replied' and sync pipeline_stage
      const { data: jcsRows } = await supabase
        .from('job_candidate_status')
        .select('id, pipeline_stage')
        .eq('candidate_id', enrollment.profile_id)
        .in('status', ['contacted', 'shortlisted', 'scored', 'new', 'messaged', 'discovered', 'untreated']);
      if (jcsRows && jcsRows.length > 0) {
        for (const row of jcsRows) {
          const shouldUpdatePipeline = !row.pipeline_stage || 
            row.pipeline_stage === 'Nouveau' || 
            row.pipeline_stage === 'Contacté';
          await supabase
            .from('job_candidate_status')
            .update({ 
              status: 'replied', 
              ...(shouldUpdatePipeline ? { pipeline_stage: 'Répondu' } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
        }
        console.log(`[unipile-webhook] Updated ${jcsRows.length} job_candidate_status → replied`);
      }
    }
  }

  // Also update inmail_queue entries for this sender (for ATS tracking)
  // Try exact match first, then resolve AEM↔ACo ID mismatch
  let inmailMatches: { id: string; recipient_profile_id: string }[] | null = null;
  
  const { data: exactInmailMatch } = await supabase
    .from('inmail_queue')
    .select('id, recipient_profile_id')
    .eq('status', 'sent')
    .eq('recipient_profile_id', senderId);

  inmailMatches = exactInmailMatch;

  // If no exact match, try resolving the sender's alternative ID via Unipile
  // InMails are sent to AEM... IDs but replies come from ACo... IDs (or vice versa)
  if ((!inmailMatches || inmailMatches.length === 0) && senderId) {
    try {
      const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN')!;
      const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')!;
      
      // Resolve the sender's profile to get alternative IDs
      const userRes = await fetchWithTimeout(`https://${UNIPILE_DSN}/api/v1/users/${senderId}`, {
        headers: { 'X-API-KEY': UNIPILE_API_KEY },
      });
      
      if (userRes.ok) {
        const userData = await userRes.json();
        // Collect all possible IDs: provider_id, id, public_identifier
        const altIds = new Set<string>();
        if (userData.provider_id && userData.provider_id !== senderId) altIds.add(userData.provider_id);
        if (userData.id && userData.id !== senderId) altIds.add(userData.id);
        // Also check nested profile if present
        if (userData.profile?.provider_id && userData.profile.provider_id !== senderId) altIds.add(userData.profile.provider_id);
        
        if (altIds.size > 0) {
          const altIdArray = [...altIds];
          console.log(`[unipile-webhook] Resolved sender ${senderId} → alt IDs:`, altIdArray);
          
          const { data: altMatch } = await supabase
            .from('inmail_queue')
            .select('id, recipient_profile_id')
            .eq('status', 'sent')
            .in('recipient_profile_id', altIdArray);
          
          if (altMatch && altMatch.length > 0) {
            inmailMatches = altMatch;
            console.log(`[unipile-webhook] InMail matched via resolved ID for ${altMatch.length} entries`);
          }
        }
      } else {
        await userRes.text(); // consume body
      }
    } catch (e) {
      console.warn('[unipile-webhook] Failed to resolve sender for inmail matching:', e);
    }
  }

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

  // ── Create notification for new message ──
  // Find the user(s) linked to this LinkedIn account
  const senderName = payload.sender?.attendee_name 
    || (data?.message as any)?.sender?.name 
    || senderId || 'Quelqu\'un';

  const { data: linkedMembers } = await supabase
    .from('member_linkedin_accounts')
    .select('user_id, organization_id')
    .eq('linkedin_account_id', account_id);

  if (linkedMembers && linkedMembers.length > 0) {
    for (const member of linkedMembers) {
      await supabase
        .from('notifications')
        .insert({
          user_id: member.user_id,
          organization_id: member.organization_id,
          type: 'new_message',
          title: `Nouveau message de ${senderName}`,
          body: chatId ? `Vous avez reçu un nouveau message LinkedIn` : null,
          link: `/outreach?tab=messages${chatId ? `&chatId=${chatId}` : ''}`,
        });
    }
    console.log(`[unipile-webhook] Created notifications for ${linkedMembers.length} user(s)`);
  } else {
    // Fallback: notify all org members who have access
    // Find org via any member_linkedin_accounts with this account
    const { data: anyMapping } = await supabase
      .from('member_linkedin_accounts')
      .select('organization_id')
      .eq('linkedin_account_id', account_id)
      .limit(1);
    
    if (!anyMapping || anyMapping.length === 0) {
      // Last resort: find org members from organization_members and notify admins/owners
      console.log('[unipile-webhook] No member mapping found for account:', account_id);
    }
  }

  // ── Trigger auto-analysis for intent detection & status update ──
  if (chatId) {
    console.log(`[unipile-webhook] Triggering auto-analyze for chat: ${chatId}`);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Fire-and-forget: don't await to keep webhook fast
    fetchWithTimeout(`${supabaseUrl}/functions/v1/auto-analyze-message`, {
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

  // ── Fire-and-forget RAG ingestion (conversation message) ──
  if (senderId && chatId) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const orgId = linkedMembers?.[0]?.organization_id;
    if (supabaseUrl && serviceKey && orgId) {
      const senderName = payload.sender?.attendee_name
        || (data?.message as any)?.sender?.name
        || senderId;
      fetch(`${supabaseUrl}/functions/v1/ingest-context`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: orgId,
          entity_type: 'candidate',
          entity_id: senderId,
          chunks: [{
            chunk_type: 'conversation',
            content: `Message reçu de ${senderName} (chat ${chatId})`,
            source_table: 'unipile_conversations',
            metadata: { chat_id: chatId, account_id: account_id, date: new Date().toISOString() },
          }],
        }),
      }).catch(err => console.warn('[unipile-webhook] RAG ingest failed (non-blocking):', err));
    }
  }
}
