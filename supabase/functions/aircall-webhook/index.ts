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
 * `transcription.created` (lot A5) : le texte n'est pas dans l'événement, il est
 * lu chez Aircall puis gardé, et l'analyse part en arrière-plan
 * (analyze-phone-call).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mapAircallCall } from '../_shared/aircall-call.ts';
import { ingestAircallTranscript } from '../_shared/aircall-transcript-ingest.ts';
import { callIdOfIntelligenceEvent } from '../_shared/aircall-transcript.ts';
import { sha256Hex } from '../_shared/telephony.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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

    // Transcription prête : Aircall n'envoie pas le texte, on le lit puis on lance l'analyse.
    if (event === 'transcription.created') {
      const externalCallId = callIdOfIntelligenceEvent(body.data);
      if (!externalCallId) return json({ ok: true, skipped: true });
      const ingested = await ingestAircallTranscript(supabase, organizationId, externalCallId);
      // Erreur passagère : 500, Aircall rejoue l'événement (l'écriture est rejouable).
      if (ingested.status === 'transient') return json({ error: 'Transcription momentanément illisible' }, 500);
      if (ingested.status !== 'stored') return json({ ok: true, skipped: true, reason: ingested.status });

      // L'analyse (IA) est longue : elle part en arrière-plan, le webhook répond tout de suite.
      const analysis = fetch(`${supabaseUrl}/functions/v1/analyze-phone-call`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: organizationId, call_id: ingested.callId }),
      }).then((res) => {
        if (!res.ok) console.warn('[aircall-webhook] analyse non lancée: HTTP', res.status);
      }).catch((err) => {
        console.warn('[aircall-webhook] analyse non lancée:', (err as { message?: string })?.message ?? err);
      });
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(analysis); } catch { /* sans waitUntil : l'analyse part quand même */ }
      return json({ ok: true, transcribed: true });
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
