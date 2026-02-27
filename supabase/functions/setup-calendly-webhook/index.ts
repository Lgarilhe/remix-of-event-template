import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const calendlyApiKey = Deno.env.get('CALENDLY_API_KEY');
    if (!calendlyApiKey) {
      throw new Error('CALENDLY_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const webhookUrl = `${supabaseUrl}/functions/v1/calendly-webhook`;

    // Step 1: Get current user to find organization
    const meRes = await fetch('https://api.calendly.com/users/me', {
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

    // Step 2: Check if webhook already exists
    const listRes = await fetch(
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

      // Cleanup stale subscriptions with the same callback to avoid duplicates
      for (const stale of sameCallback) {
        const staleId = stale.uri?.split('/').pop();
        if (!staleId) continue;

        await fetch(`https://api.calendly.com/webhook_subscriptions/${staleId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${calendlyApiKey}` },
        });
      }
    }

    // Step 3: Create webhook subscription
    const createRes = await fetch('https://api.calendly.com/webhook_subscriptions', {
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
