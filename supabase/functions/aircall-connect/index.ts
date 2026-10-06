/**
 * Relier ou délier le compte Aircall d'une organisation.
 *
 * POST { organization_id, action: 'connect' | 'disconnect' } avec le JWT d'un
 * propriétaire ou d'un administrateur de l'organisation.
 *
 * connect : lit l'identifiant et le jeton API saisis dans les réglages
 * (organization_integrations, jamais renvoyés au navigateur), vérifie chez
 * Aircall qu'ils sont acceptés, crée le webhook de l'organisation et garde
 * l'empreinte du jeton que Aircall renvoie (telephony_connections). C'est ce
 * jeton, joint à chaque événement, qui permet à aircall-webhook de retrouver
 * l'organisation. Un webhook créé par une connexion précédente est supprimé
 * une fois le nouveau en place, pour ne pas laisser deux abonnements.
 *
 * disconnect : supprime le webhook chez Aircall (au mieux), puis la connexion.
 * L'historique des appels reste.
 *
 * Le webhook de Konekt (n8n, tâches Notion) est un autre abonnement du même
 * compte Aircall : cette fonction ne touche que celui qu'elle a créé.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from '../_shared/require-auth.ts';
import { AIRCALL_API_BASE, AIRCALL_WEBHOOK_EVENTS, sha256Hex } from '../_shared/telephony.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let auth;
  try {
    auth = await requireAuth(req, corsHeaders);
  } catch (authResponse) {
    return authResponse as Response;
  }
  if (!auth.userId) return json({ error: 'Connexion utilisateur requise' }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* corps vide : refusé ci-dessous */ }
  const organizationId = typeof body?.organization_id === 'string' ? body.organization_id : '';
  const action = body?.action;
  if (!UUID_RE.test(organizationId)) return json({ error: 'organization_id invalide' }, 400);
  if (action !== 'connect' && action !== 'disconnect') return json({ error: 'action invalide' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // Propriétaire ou administrateur de CETTE organisation, sinon refus.
    const { data: membership, error: membershipError } = await admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return json({ error: 'Réservé aux propriétaires et administrateurs' }, 403);
    }

    const { data: integration, error: integrationError } = await admin
      .from('organization_integrations')
      .select('aircall_api_id, aircall_api_token')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (integrationError) throw integrationError;
    const apiId = integration?.aircall_api_id as string | null | undefined;
    const apiToken = integration?.aircall_api_token as string | null | undefined;
    const authHeader = apiId && apiToken ? `Basic ${btoa(`${apiId}:${apiToken}`)}` : null;

    const { data: existing, error: existingError } = await admin
      .from('telephony_connections')
      .select('external_webhook_id')
      .eq('organization_id', organizationId)
      .eq('provider', 'aircall')
      .maybeSingle();
    if (existingError) throw existingError;

    // Supprime un webhook chez Aircall. Vrai si c'est fait ou déjà absent.
    const deleteRemoteWebhook = async (webhookId: string | null | undefined): Promise<boolean> => {
      if (!webhookId || !authHeader) return !webhookId;
      try {
        const res = await fetchWithTimeout(`${AIRCALL_API_BASE}/webhooks/${encodeURIComponent(webhookId)}`, {
          method: 'DELETE',
          headers: { Authorization: authHeader },
        });
        return res.ok || res.status === 404;
      } catch (err) {
        console.warn('[aircall-connect] suppression du webhook impossible:', (err as { message?: string })?.message);
        return false;
      }
    };

    if (action === 'disconnect') {
      const remoteRemoved = await deleteRemoteWebhook(existing?.external_webhook_id);
      const { error: deleteError } = await admin
        .from('telephony_connections')
        .delete()
        .eq('organization_id', organizationId)
        .eq('provider', 'aircall');
      if (deleteError) throw deleteError;
      await admin.from('organization_integrations').update({ aircall_connected: false }).eq('organization_id', organizationId);
      return json({ ok: true, connected: false, remote_removed: remoteRemoved });
    }

    // ===== connect =====
    if (!authHeader) {
      return json({ ok: false, code: 'CREDENTIALS_MISSING', error: "Saisissez d'abord l'identifiant et le jeton Aircall." }, 400);
    }

    // Test des identifiants : l'appel que la documentation Aircall donne pour cela.
    let check: Response;
    try {
      check = await fetchWithTimeout(`${AIRCALL_API_BASE}/calls/search?per_page=1&order=desc`, {
        headers: { Authorization: authHeader },
      });
    } catch {
      return json({ ok: false, code: 'AIRCALL_UNAVAILABLE', error: "Aircall ne répond pas. Réessayez dans quelques minutes." }, 502);
    }
    if (check.status === 401 || check.status === 403) {
      return json({ ok: false, code: 'CREDENTIALS_REJECTED', error: "Aircall refuse cet identifiant ou ce jeton. Vérifiez-les et que votre forfait donne accès à l'API." }, 400);
    }
    if (!check.ok) {
      console.error('[aircall-connect] test des identifiants: HTTP', check.status);
      return json({ ok: false, code: 'AIRCALL_UNAVAILABLE', error: "Aircall n'a pas pu vérifier ces identifiants. Réessayez dans quelques minutes." }, 502);
    }

    let created: Response;
    try {
      created = await fetchWithTimeout(`${AIRCALL_API_BASE}/webhooks`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_name: 'Konekt',
          url: `${supabaseUrl}/functions/v1/aircall-webhook`,
          events: AIRCALL_WEBHOOK_EVENTS,
        }),
      });
    } catch {
      return json({ ok: false, code: 'AIRCALL_UNAVAILABLE', error: "Aircall ne répond pas. Réessayez dans quelques minutes." }, 502);
    }
    if (!created.ok) {
      console.error('[aircall-connect] création du webhook: HTTP', created.status);
      return json({ ok: false, code: 'WEBHOOK_CREATE_FAILED', error: "Aircall a refusé la création de la liaison. Vérifiez que votre forfait donne accès à l'API." }, 502);
    }
    const payload = await created.json().catch(() => null);
    const webhook = payload?.webhook ?? payload;
    const webhookToken = typeof webhook?.token === 'string' ? webhook.token : '';
    const webhookId = webhook?.webhook_id ?? webhook?.id;
    if (!webhookToken || webhookId === undefined || webhookId === null) {
      await deleteRemoteWebhook(webhookId !== undefined && webhookId !== null ? String(webhookId) : null);
      console.error('[aircall-connect] réponse inattendue à la création du webhook');
      return json({ ok: false, code: 'WEBHOOK_CREATE_FAILED', error: "Aircall a répondu de façon inattendue. Réessayez." }, 502);
    }

    const { error: saveError } = await admin
      .from('telephony_connections')
      .upsert({
        organization_id: organizationId,
        provider: 'aircall',
        webhook_token_hash: await sha256Hex(webhookToken),
        external_webhook_id: String(webhookId),
        connected_by: auth.userId,
        connected_at: new Date().toISOString(),
        last_event_at: null,
      }, { onConflict: 'organization_id,provider' });
    if (saveError) {
      // Pas d'abonnement orphelin chez Aircall : sans empreinte en base, ses événements seraient refusés.
      await deleteRemoteWebhook(String(webhookId));
      throw saveError;
    }
    // L'ancien abonnement part seulement une fois le nouveau en place : un
    // échec plus haut laisse la connexion précédente intacte.
    await deleteRemoteWebhook(existing?.external_webhook_id);
    await admin.from('organization_integrations').update({ aircall_connected: true }).eq('organization_id', organizationId);

    return json({ ok: true, connected: true });
  } catch (err) {
    console.error('[aircall-connect] erreur:', (err as { message?: string })?.message ?? err);
    return json({ ok: false, error: 'Erreur interne. Réessayez.' }, 500);
  }
});
