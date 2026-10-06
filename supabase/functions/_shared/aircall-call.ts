/**
 * Un événement d'appel Aircall (enveloppe { event, timestamp, token, data })
 * mis au format de la fonction SQL record_phone_call.
 *
 * Fonction pure, sans importation de Deno ni de client : elle est lue par les
 * tests Node (tests/c1/telephonie-aircall.test.mjs).
 *
 * Pièges Aircall vérifiés (mémoire « konekt-aircall-monitoring ») :
 *   - `duration` compte la sonnerie : la durée de conversation se calcule
 *     entre `answered_at` et `ended_at` ;
 *   - le numéro du correspondant est `raw_digits`. `number.digits` est la
 *     ligne Aircall de l'agent, jamais le correspondant ;
 *   - un commentaire porte son texte dans `content` (`body` accepté par
 *     prudence, c'était le nom lu par l'ancienne réception).
 */
import { toE164 } from './phone.ts';

export interface PhoneCallInput {
  direction: 'inbound' | 'outbound' | null;
  status: string | null;
  missed_reason: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  talk_seconds: number;
  contact_number: string | null;
  contact_number_e164: string | null;
  contact_name: string | null;
  agent_external_id: string | null;
  agent_name: string | null;
  agent_email: string | null;
  recording_url: string | null;
  voicemail_url: string | null;
  tags: string[];
  notes: string | null;
}

export interface MappedAircallCall {
  externalId: string;
  eventAt: string;
  call: PhoneCallInput;
}

const text = (v: unknown): string | null => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

/** Aircall donne des secondes Unix ; une chaîne ISO ou des millisecondes sont tolérées. */
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  let ms: number;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    ms = n > 1e12 ? n : n * 1000;
  } else if (typeof v === 'string') {
    ms = Date.parse(v);
  } else {
    return null;
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function mapAircallCall(data: any, envelopeTimestamp?: unknown, now: () => Date = () => new Date()): MappedAircallCall | null {
  if (!data || typeof data !== 'object') return null;
  const externalId = text(data.id);
  if (!externalId) return null;

  const startedAt = toIso(data.started_at);
  const answeredAt = toIso(data.answered_at);
  const endedAt = toIso(data.ended_at);
  const talkSeconds = answeredAt && endedAt
    ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(answeredAt)) / 1000))
    : 0;

  const contactNumber = text(data.raw_digits);
  const contactName = [text(data.contact?.first_name), text(data.contact?.last_name)].filter(Boolean).join(' ') || null;

  const tags = (Array.isArray(data.tags) ? data.tags : [])
    .map((t: unknown) => (typeof t === 'string' ? text(t) : text((t as { name?: unknown })?.name)))
    .filter((t: string | null): t is string => !!t);

  const notes = (Array.isArray(data.comments) ? data.comments : [])
    .map((c: { content?: unknown; body?: unknown }) => text(c?.content) ?? text(c?.body))
    .filter((t: string | null): t is string => !!t)
    .join('\n') || null;

  const direction = data.direction === 'inbound' || data.direction === 'outbound' ? data.direction : null;

  return {
    externalId,
    eventAt: toIso(envelopeTimestamp) ?? now().toISOString(),
    call: {
      direction,
      status: text(data.status),
      missed_reason: text(data.missed_call_reason),
      started_at: startedAt,
      answered_at: answeredAt,
      ended_at: endedAt,
      talk_seconds: talkSeconds,
      contact_number: contactNumber,
      contact_number_e164: toE164(contactNumber),
      contact_name: contactName,
      agent_external_id: text(data.user?.id),
      agent_name: text(data.user?.name),
      agent_email: text(data.user?.email),
      recording_url: text(data.recording),
      voicemail_url: text(data.voicemail),
      tags,
      notes,
    },
  };
}
