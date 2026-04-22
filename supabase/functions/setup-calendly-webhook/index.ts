// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// No global integration credentials — always resolved from organization_integrations
let calendlyApiKey: string | undefined;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function resolveOrgCredentials(orgId: string) {
  const { data } = await supabase
    .from('organization_integrations')
    .select('calendly_api_key, calendly_connected')
    .eq('organization_id', orgId)
    .single();

  if (!data?.calendly_connected || !data.calendly_api_key) {
    throw new Error('Intégration Calendly non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations.');
  }

  calendlyApiKey = data.calendly_api_key;
  console.log('[setup-calendly-webhook] Using org-specific Calendly credentials');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }

    let body: any = {};
    try { body = await req.json(); } catch {}

    if (!body?.organization_id) {
      throw new Error('organization_id est requis');
    }
    await resolveOrgCredentials(body.organization_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const webhookUrl = `${supabaseUrl}/functions/v1/calendly-webhook`;

    const meRes = await fetchWithTimeout('https://api.calendly.com/users/me', {
      headers: { 'Authorization': `Bearer ${calendlyApiKey}` },
    });

    if (!meRes.ok) {
      const errText = await meRes.text();
      throw new Error(`Calendly /users/me failed: ${meRes.status} - ${errText}`);
    }

    const meData = await meRes.json();
    const organizationUri = meData.resource?.current_organization;

    if (!organizationUri) {
      throw new Error('Could not find organization URI from Calendly');
    }

    const listRes = await fetchWithTimeout(
      `https://api.calendly.com/webhook_subscriptions?organization=${encodeURIComponent(organizationUri)}&scope=organization`,
      { headers: { 'Authorization': `Bearer ${calendlyApiKey}` } }
    );

    if (listRes.ok) {
      const listData = await listRes.json();
      const collection = listData.collection || [];
      const sameCallback = collection.filter(
        (wh: any) => wh.callback_url === webhookUrl && wh.state === 'active'
      );

      const orgWide = sameCallback.find(
        (wh: any) => wh.scope === 'organization' && !wh.user
      );

      if (orgWide) {
        return new Response(JSON.stringify({
          success: true,
          message: 'Webhook already configured (organization-wide)',
          webhook: {
            id: orgWide.uri,
            url: orgWide.callback_url,
            events: orgWide.events,
            state: orgWide.state,
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      for (const stale of sameCallback) {
        const staleId = stale.uri?.split('/').pop();
        if (!staleId) continue;
        await fetchWithTimeout(`https://api.calendly.com/webhook_subscriptions/${staleId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${calendlyApiKey}` },
        });
      }
    }

    const createRes = await fetchWithTimeout('https://api.calendly.com/webhook_subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${calendlyApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: webhookUrl,
        events: ['invitee.created', 'invitee.canceled'],
        organization: organizationUri,
        scope: 'organization',
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Calendly webhook creation failed: ${createRes.status} - ${errText}`);
    }

    const createData = await createRes.json();

    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook configured successfully!',
      webhook: {
        id: createData.resource?.uri,
        url: createData.resource?.callback_url,
        events: createData.resource?.events,
        state: createData.resource?.state,
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Setup Calendly webhook error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
