/**
 * Réception des événements d'appel Aircall, par organisation.
 *
 * Aircall joint à chaque événement le jeton propre au webhook créé par
 * aircall-connect pour cette organisation (champ `token` du corps). Seule son
 * empreinte SHA-256 est gardée (telephony_connections) : elle retrouve
 * l'organisation, sans jeton partagé ni identifiant dans l'URL. Un jeton
 * inconnu est refusé (401), un événement qui n'est pas un appel est ignoré.
 *
 * Aucun appel n'est rattaché à un candidat ici : le rapprochement se fait à
 * la lecture, par le numéro (phone_calls.contact_number_e164).
 *
 * « transcription.created » (module AI Assist d'Aircall) : l'appel est retrouvé
 * par son identifiant Aircall, puis phone-call-insights lit la transcription,
 * la résume et propose des tâches. Lancé sans attendre : Aircall veut une
 * réponse rapide, le résumé prend plusieurs secondes.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mapAircallCall } from '../_shared/aircall-call.ts';
import { transcriptionCallIdCandidates } from '../_shared/aircall-transcript.ts';
import { sha256Hex } from '../_shared/telephony.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const tokenHash = await sha256Hex(token);
    const { data: connection, error: connectionError } = await supabase
      .from('telephony_connections')
      .select('organization_id')
      .eq('provider', 'aircall')
      .eq('webhook_token_hash', tokenHash)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) {
      console.warn('[aircall-webhook] jeton inconnu');
      return json({ error: 'Unauthorized' }, 401);
    }
    const organizationId = connection.organization_id as string;

    const event = typeof body.event === 'string' ? body.event : '';

    if (event === 'transcription.created' && body.data) {
      // L'identifiant reçu peut être celui de l'appel ou celui de la transcription :
      // chaque candidat est cherché parmi les appels de CETTE organisation.
      let phoneCallId: string | null = null;
      for (const externalId of transcriptionCallIdCandidates(body.data)) {
        const { data: found, error: findError } = await supabase
          .from('phone_calls')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('provider', 'aircall')
          .eq('external_id', externalId)
          .maybeSingle();
        if (findError) throw findError;
        if (found) { phoneCallId = found.id as string; break; }
      }
      if (!phoneCallId) {
        console.warn('[aircall-webhook] transcription reçue pour un appel inconnu');
        return json({ ok: true, skipped: true });
      }
      const trigger = fetchWithTimeout(`${supabaseUrl}/functions/v1/phone-call-insights`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_call_id: phoneCallId, organization_id: organizationId }),
      }, 58000)
        .then((res) => console.log('[aircall-webhook] phone-call-insights :', res.status))
        .catch((err) => console.warn('[aircall-webhook] phone-call-insights injoignable :', (err as { message?: string })?.message));
      try {
        (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(trigger);
      } catch { /* sans waitUntil, le traitement continue tant que l'isolat vit ; la fiche propose « Récupérer » */ }
      return json({ ok: true, queued: true });
    }

    if (!event.startsWith('call.') || !body.data) return json({ ok: true, skipped: true });

    const mapped = mapAircallCall(body.data, body.timestamp);
    if (!mapped) return json({ ok: true, skipped: true });

    const { data: result, error } = await supabase.rpc('record_phone_call', {
      p_organization_id: organizationId,
      p_provider: 'aircall',
      p_external_id: mapped.externalId,
      p_event_at: mapped.eventAt,
      p_call: mapped.call,
    });
    if (error) throw error;

    // Au mieux : l'écran des réglages montre le dernier événement reçu.
    const { error: touchError } = await supabase
      .from('telephony_connections')
      .update({ last_event_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('provider', 'aircall');
    if (touchError) console.warn('[aircall-webhook] last_event_at non mis à jour:', touchError.message);

    return json({ ok: true, result });
  } catch (err) {
    // 500 : Aircall rejoue l'événement, record_phone_call est rejouable.
    console.error('[aircall-webhook] erreur:', (err as { message?: string })?.message ?? err);
    return json({ error: 'Internal error' }, 500);
  }
});
