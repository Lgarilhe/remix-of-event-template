import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Resolve org-specific Aircall credentials
    let body: any = {};
    try { body = await req.clone().json(); } catch {}
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

    // No global fallback — always resolve from organization_integrations
    const { data: integrationData } = await supabase
      .from('organization_integrations')
      .select('aircall_api_id, aircall_api_token, aircall_connected')
      .eq('organization_id', orgId)
      .single();

    if (!integrationData?.aircall_connected || !integrationData.aircall_api_id || !integrationData.aircall_api_token) {
      throw new Error('Intégration Aircall non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations.');
    }

    const AIRCALL_API_ID = integrationData.aircall_api_id;
    const AIRCALL_API_TOKEN = integrationData.aircall_api_token;
    console.log('[fetch-aircall] Using org-specific Aircall credentials');

    const basicAuth = btoa(`${AIRCALL_API_ID}:${AIRCALL_API_TOKEN}`);
    const headers = { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' };

    // Get last synced call to only fetch new ones
    const { data: lastCall } = await supabase
      .from('aircall_calls')
      .select('started_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    const fromParam = lastCall?.started_at
      ? `&from=${Math.floor(new Date(lastCall.started_at).getTime() / 1000)}`
      : '';

    let allCalls: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 20) { // max 20 pages = 1000 calls per sync
      const url = `https://api.aircall.io/v1/calls?per_page=50&order=asc&page=${page}${fromParam}`;
      const res = await fetchWithTimeout(url, { headers });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Aircall API error [${res.status}]: ${body}`);
      }

      const data = await res.json();
      const calls = data.calls || [];
      allCalls = [...allCalls, ...calls];

      if (!data.meta || page >= data.meta.total_pages) {
        hasMore = false;
      }
      page++;

      // Rate limit: max 60/min → wait 1.1s between requests
      if (hasMore) await new Promise(r => setTimeout(r, 1100));
    }

    if (allCalls.length === 0) {
      return new Response(JSON.stringify({ synced: 0, message: 'No new calls' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load airtable candidates for phone matching
    const { data: airtableCandidates } = await supabase
      .from('airtable_candidates')
      .select('airtable_id, full_name, phone, linkedin_url')
      .not('phone', 'is', null);

    const phoneMap = new Map<string, { airtable_id: string; full_name: string | null; linkedin_url: string | null }>();
    (airtableCandidates || []).forEach(c => {
      if (c.phone) {
        const normalized = normalizePhone(c.phone);
        if (normalized) phoneMap.set(normalized, { airtable_id: c.airtable_id, full_name: c.full_name, linkedin_url: c.linkedin_url });
      }
    });

    // Transform and match calls
    const rows = allCalls.map(call => {
      const contactNumber = call.direction === 'inbound'
        ? call.raw_digits || call.number?.digits
        : call.raw_digits || call.number?.digits;

      const normalizedContact = contactNumber ? normalizePhone(contactNumber) : null;
      const match = normalizedContact ? phoneMap.get(normalizedContact) : null;

      // If no phone match, try name match
      let nameMatch = null;
      if (!match && call.contact) {
        const contactName = [call.contact.first_name, call.contact.last_name].filter(Boolean).join(' ').trim();
        if (contactName) {
          nameMatch = findNameMatch(contactName, airtableCandidates || []);
        }
      }

      const finalMatch = match || nameMatch;

      // Extract notes from comments
      const notes = (call.comments || []).map((c: any) => c.body).filter(Boolean).join('\n');

      return {
        aircall_id: call.id,
        direction: call.direction,
        status: call.status || call.missed_call_reason || 'unknown',
        started_at: call.started_at ? new Date(call.started_at * 1000).toISOString() : null,
        answered_at: call.answered_at ? new Date(call.answered_at * 1000).toISOString() : null,
        ended_at: call.ended_at ? new Date(call.ended_at * 1000).toISOString() : null,
        duration: call.duration || 0,
        raw_number: contactNumber,
        caller_name: call.direction === 'inbound' ? call.contact?.direct_link || call.contact?.first_name : call.user?.name,
        caller_number: call.direction === 'inbound' ? contactNumber : null,
        callee_name: call.direction === 'outbound' ? [call.contact?.first_name, call.contact?.last_name].filter(Boolean).join(' ') : call.user?.name,
        callee_number: call.direction === 'outbound' ? contactNumber : null,
        recording_url: call.recording || null,
        voicemail_url: call.voicemail || null,
        tags: (call.tags || []).map((t: any) => t.name),
        notes: notes || null,
        user_name: call.user?.name || null,
        user_email: call.user?.email || null,
        matched_candidate_phone: normalizedContact || null,
        matched_candidate_name: finalMatch ? (match ? null : call.contact?.first_name + ' ' + call.contact?.last_name) : null,
        matched_airtable_candidate_id: finalMatch?.airtable_id || null,
        matched_linkedin_profile_id: null,
        raw_data: call,
        synced_at: new Date().toISOString(),
      };
    });

    // Upsert calls
    const { error } = await supabase
      .from('aircall_calls')
      .upsert(rows, { onConflict: 'aircall_id' });

    if (error) throw error;

    return new Response(JSON.stringify({ synced: rows.length, matched: rows.filter(r => r.matched_airtable_candidate_id).length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('fetch-aircall error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  // Remove all non-digit chars except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');
  // Normalize French numbers
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '+33' + cleaned.slice(1);
  }
  if (cleaned.startsWith('33') && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned || null;
}

function findNameMatch(
  contactName: string,
  candidates: { airtable_id: string; full_name: string | null; phone: string | null; linkedin_url: string | null }[]
): { airtable_id: string; full_name: string | null; linkedin_url: string | null } | null {
  const normalized = contactName.toLowerCase().trim();
  if (normalized.length < 3) return null;

  for (const c of candidates) {
    if (!c.full_name) continue;
    const candidateName = c.full_name.toLowerCase().trim();
    if (candidateName === normalized) return c;
    // Check if all parts of contact name are in candidate name
    const parts = normalized.split(/\s+/);
    if (parts.length >= 2 && parts.every(p => candidateName.includes(p))) return c;
  }
  return null;
}
