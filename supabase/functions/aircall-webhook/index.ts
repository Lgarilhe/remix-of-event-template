import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Aircall sends webhook events as POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Verify Aircall webhook token (configured in Aircall webhook settings)
    const AIRCALL_WEBHOOK_TOKEN = Deno.env.get('AIRCALL_WEBHOOK_TOKEN');
    if (!AIRCALL_WEBHOOK_TOKEN) {
      console.error('[aircall-webhook] ⚠️ AIRCALL_WEBHOOK_TOKEN not set — rejecting request. Configure this secret!');
      return new Response(JSON.stringify({ error: 'Webhook token not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    {
      const url = new URL(req.url);
      const tokenParam = url.searchParams.get('token');
      const authHeader = req.headers.get('authorization');
      const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const providedToken = tokenParam || headerToken;

      if (providedToken !== AIRCALL_WEBHOOK_TOKEN) {
        console.warn('[aircall-webhook] Invalid or missing webhook token');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const body = await req.json();
    const event = body.event;
    const callData = body.data;

    // Only process call events
    if (!event?.startsWith('call.') || !callData) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const contactNumber = callData.raw_digits || callData.number?.digits;
    const normalizedContact = contactNumber ? normalizePhone(contactNumber) : null;

    // Try phone match
    let matchedAirtableId: string | null = null;
    if (normalizedContact) {
      const { data: candidates } = await supabase
        .from('airtable_candidates')
        .select('airtable_id, phone')
        .not('phone', 'is', null);

      if (candidates) {
        for (const c of candidates) {
          if (c.phone && normalizePhone(c.phone) === normalizedContact) {
            matchedAirtableId = c.airtable_id;
            break;
          }
        }
      }
    }

    // If no phone match, try name match
    if (!matchedAirtableId && callData.contact) {
      const contactName = [callData.contact.first_name, callData.contact.last_name].filter(Boolean).join(' ').trim();
      if (contactName && contactName.length >= 3) {
        const { data: candidates } = await supabase
          .from('airtable_candidates')
          .select('airtable_id, full_name')
          .not('full_name', 'is', null);

        if (candidates) {
          const normalized = contactName.toLowerCase().trim();
          for (const c of candidates) {
            if (!c.full_name) continue;
            const candidateName = c.full_name.toLowerCase().trim();
            if (candidateName === normalized) {
              matchedAirtableId = c.airtable_id;
              break;
            }
            const parts = normalized.split(/\s+/);
            if (parts.length >= 2 && parts.every((p: string) => candidateName.includes(p))) {
              matchedAirtableId = c.airtable_id;
              break;
            }
          }
        }
      }
    }

    const notes = (callData.comments || []).map((c: any) => c.body).filter(Boolean).join('\n');

    const row = {
      aircall_id: callData.id,
      direction: callData.direction,
      status: callData.status || callData.missed_call_reason || 'unknown',
      started_at: callData.started_at ? new Date(callData.started_at * 1000).toISOString() : null,
      answered_at: callData.answered_at ? new Date(callData.answered_at * 1000).toISOString() : null,
      ended_at: callData.ended_at ? new Date(callData.ended_at * 1000).toISOString() : null,
      duration: callData.duration || 0,
      raw_number: contactNumber,
      caller_name: callData.direction === 'inbound'
        ? [callData.contact?.first_name, callData.contact?.last_name].filter(Boolean).join(' ')
        : callData.user?.name,
      caller_number: callData.direction === 'inbound' ? contactNumber : null,
      callee_name: callData.direction === 'outbound'
        ? [callData.contact?.first_name, callData.contact?.last_name].filter(Boolean).join(' ')
        : callData.user?.name,
      callee_number: callData.direction === 'outbound' ? contactNumber : null,
      recording_url: callData.recording || null,
      voicemail_url: callData.voicemail || null,
      tags: (callData.tags || []).map((t: any) => t.name),
      notes: notes || null,
      user_name: callData.user?.name || null,
      user_email: callData.user?.email || null,
      matched_candidate_phone: normalizedContact || null,
      matched_airtable_candidate_id: matchedAirtableId,
      raw_data: callData,
      synced_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('aircall_calls')
      .upsert(row, { onConflict: 'aircall_id' });

    if (error) throw error;

    // ── Fire-and-forget RAG ingestion (call notes) ──
    if (notes && matchedAirtableId) {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && serviceKey) {
        // Find org for this candidate
        const { data: orgData } = await supabase
          .from('airtable_candidates')
          .select('organization_id')
          .eq('airtable_id', matchedAirtableId)
          .maybeSingle();

        if (orgData?.organization_id) {
          await fetchWithTimeout(`${supabaseUrl}/functions/v1/ingest-context`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              organization_id: orgData.organization_id,
              entity_type: 'candidate',
              entity_id: matchedAirtableId,
              chunks: [{
                chunk_type: 'call_transcript',
                content: `Notes d'appel Aircall:\n${notes}`,
                source_table: 'aircall_calls',
                source_id: String(callData.id),
                metadata: {
                  date: row.started_at || new Date().toISOString(),
                  duration: callData.duration || 0,
                  direction: callData.direction || '',
                },
              }],
            }),
          }).catch(err => console.warn('[aircall-webhook] RAG ingest failed (non-blocking):', err));
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, aircall_id: callData.id, matched: !!matchedAirtableId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('aircall-webhook error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '+33' + cleaned.slice(1);
  }
  if (cleaned.startsWith('33') && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned || null;
}
