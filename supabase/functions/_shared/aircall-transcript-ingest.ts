/**
 * Lire la transcription d'un appel chez Aircall et la garder (phone_call_transcripts).
 *
 * Deux appelants : aircall-webhook (événement `transcription.created`) et
 * analyze-phone-call (un membre demande la transcription d'un appel reçu avant
 * l'abonnement à cet événement). Une seule logique, donc un seul comportement.
 *
 * Les identifiants Aircall de l'organisation sont lus ici, côté serveur : ils ne
 * sont jamais renvoyés au navigateur (organization_integrations).
 */
import { mapAircallCall } from './aircall-call.ts';
import { parseAircallTranscription } from './aircall-transcript.ts';
import { AIRCALL_API_BASE } from './telephony.ts';

export type IngestResult =
  /** Transcription gardée ; `callId` est l'identifiant de l'appel dans phone_calls. */
  | { status: 'stored'; callId: string }
  /** Aircall n'a pas (ou pas encore) de transcription pour cet appel, ou refuse de la donner (forfait). */
  | { status: 'none' }
  | { status: 'no_credentials' }
  /** Erreur passagère (Aircall indisponible, limite de débit) : à rejouer. */
  | { status: 'transient' };

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** L'en-tête d'authentification Aircall de l'organisation, ou null si l'identifiant ou le jeton manque. */
export async function loadAircallAuthHeader(admin: any, organizationId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('organization_integrations')
    .select('aircall_api_id, aircall_api_token')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  const apiId = data?.aircall_api_id as string | null | undefined;
  const apiToken = data?.aircall_api_token as string | null | undefined;
  return apiId && apiToken ? `Basic ${btoa(`${apiId}:${apiToken}`)}` : null;
}

/**
 * L'identifiant dans phone_calls de l'appel Aircall `externalId`. Un appel que la
 * réception n'a pas vu (événement perdu) est relu chez Aircall et enregistré :
 * la transcription n'est jamais orpheline.
 */
async function ensureCallRow(admin: any, organizationId: string, externalId: string, authHeader: string): Promise<string | 'none' | 'transient'> {
  const lookup = () => admin
    .from('phone_calls')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('provider', 'aircall')
    .eq('external_id', externalId)
    .maybeSingle();

  const { data: existing, error } = await lookup();
  if (error) throw error;
  if (existing?.id) return existing.id as string;

  let res: Response;
  try {
    res = await fetchWithTimeout(`${AIRCALL_API_BASE}/calls/${encodeURIComponent(externalId)}`, { headers: { Authorization: authHeader } });
  } catch {
    return 'transient';
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) return 'none';
  if (!res.ok) return 'transient';
  const payload = await res.json().catch(() => null);
  const mapped = mapAircallCall(payload?.call ?? payload);
  if (!mapped) return 'none';

  // Date de l'événement : la fin de l'appel, pour qu'un call.ended tardif (plus récent) le complète.
  const { error: recordError } = await admin.rpc('record_phone_call', {
    p_organization_id: organizationId,
    p_provider: 'aircall',
    p_external_id: mapped.externalId,
    p_event_at: mapped.call.ended_at ?? mapped.eventAt,
    p_call: mapped.call,
  });
  if (recordError) throw recordError;

  const { data: created, error: createdError } = await lookup();
  if (createdError) throw createdError;
  return created?.id ? (created.id as string) : 'none';
}

export async function ingestAircallTranscript(admin: any, organizationId: string, externalCallId: string): Promise<IngestResult> {
  const authHeader = await loadAircallAuthHeader(admin, organizationId);
  if (!authHeader) return { status: 'no_credentials' };

  const callId = await ensureCallRow(admin, organizationId, externalCallId, authHeader);
  if (callId === 'none') return { status: 'none' };
  if (callId === 'transient') return { status: 'transient' };

  let res: Response;
  try {
    res = await fetchWithTimeout(`${AIRCALL_API_BASE}/calls/${encodeURIComponent(externalCallId)}/transcription`, {
      headers: { Authorization: authHeader },
    });
  } catch {
    return { status: 'transient' };
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    console.warn('[aircall-transcript] transcription indisponible: HTTP', res.status);
    return { status: 'none' };
  }
  if (!res.ok) {
    console.warn('[aircall-transcript] lecture de la transcription: HTTP', res.status);
    return { status: 'transient' };
  }

  const parsed = parseAircallTranscription(await res.json().catch(() => null));
  if (!parsed) return { status: 'none' };

  const { error } = await admin.rpc('record_phone_call_transcript', {
    p_organization_id: organizationId,
    p_provider: 'aircall',
    p_external_id: externalCallId,
    p_utterances: parsed.utterances,
    p_language: parsed.language,
  });
  if (error) throw error;
  return { status: 'stored', callId };
}
