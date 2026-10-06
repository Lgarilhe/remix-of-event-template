/**
 * Transcription d'un appel Aircall : lecture de la réponse de l'API et mise en
 * texte pour l'analyse.
 *
 * Fonctions pures, sans importation de Deno ni de client : elles sont lues par
 * les tests Node (tests/c1/telephonie-transcription.test.mjs).
 *
 * Ce qu'Aircall envoie (doc developer.aircall.io, juin 2026) :
 *   - l'événement `transcription.created` (enveloppe `resource:
 *     "conversation_intelligence"`) ne porte PAS le texte : il porte l'appel
 *     (`data.call_id`). Le texte se lit ensuite par GET /v1/calls/:id/transcription ;
 *   - la forme de cette réponse vient du workflow n8n de Konekt (91 % de
 *     transcriptions lues) : `transcription.content.utterances[]`, chaque prise
 *     de parole avec `participant_type` (internal : le recruteur, external : le
 *     correspondant), `start_time`, `end_time` et `text`.
 * La documentation ne donne pas d'exemple de cette réponse : l'analyseur accepte
 * donc les emplacements voisins (`content.utterances`, `utterances`) et ne
 * suppose rien de plus. Une forme inconnue rend null, jamais un texte faux.
 */

export type Speaker = 'agent' | 'contact' | 'unknown';

export interface Utterance {
  who: Speaker;
  start: number | null;
  end: number | null;
  text: string;
}

export interface ParsedTranscription {
  utterances: Utterance[];
  language: string | null;
}

const text = (v: unknown): string | null => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const seconds = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Identifiant de l'appel d'un événement `transcription.*` ou `summary.*` ; jamais `data.id`, qui est celui de la transcription. */
export function callIdOfIntelligenceEvent(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  return text(data.call_id) ?? text(data.callId) ?? text(data.call?.id);
}

const speakerOf = (participantType: unknown): Speaker => {
  const t = typeof participantType === 'string' ? participantType.trim().toLowerCase() : '';
  if (t === 'internal') return 'agent';
  if (t === 'external') return 'contact';
  return 'unknown';
};

const findUtterances = (payload: any): unknown[] | null => {
  const candidates = [
    payload?.transcription?.content?.utterances,
    payload?.transcription?.utterances,
    payload?.content?.utterances,
    payload?.utterances,
  ];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return null;
};

/** Plafond de ce qu'on garde : une heure de parole tient largement dessous. */
export const MAX_TRANSCRIPT_CHARS = 200_000;

export function parseAircallTranscription(payload: unknown): ParsedTranscription | null {
  const raw = findUtterances(payload);
  if (!raw) return null;

  const utterances: Utterance[] = [];
  let chars = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const u = item as Record<string, unknown>;
    const body = text(u.text);
    if (!body) continue;
    if (chars + body.length > MAX_TRANSCRIPT_CHARS) break;
    chars += body.length;
    utterances.push({
      who: speakerOf(u.participant_type),
      start: seconds(u.start_time ?? u.start),
      end: seconds(u.end_time ?? u.end),
      text: body,
    });
  }
  if (utterances.length === 0) return null;

  const p = payload as any;
  const language = text(p?.transcription?.language) ?? text(p?.transcription?.content?.language) ?? text(p?.language);
  return { utterances, language };
}

const SPEAKER_LABEL: Record<Speaker, string> = {
  agent: 'Recruteur',
  contact: 'Correspondant',
  unknown: 'Interlocuteur',
};

/**
 * La transcription en lignes « Recruteur : … », les prises de parole successives
 * d'une même personne réunies. Au-delà de `maxChars`, on garde le début et la
 * fin (là où se posent la demande et la conclusion) et on le dit.
 */
export function transcriptToText(utterances: ReadonlyArray<Utterance>, maxChars = 60_000): string {
  const lines: string[] = [];
  let last: Speaker | null = null;
  for (const u of utterances) {
    if (u.who === last && lines.length > 0) {
      lines[lines.length - 1] += ` ${u.text}`;
    } else {
      lines.push(`${SPEAKER_LABEL[u.who]} : ${u.text}`);
      last = u.who;
    }
  }
  const full = lines.join('\n');
  if (full.length <= maxChars) return full;
  const half = Math.floor(maxChars / 2);
  return `${full.slice(0, half)}\n[… partie centrale de l'appel non transmise …]\n${full.slice(full.length - half)}`;
}

/** Nombre de caractères de parole : sert à écarter un appel sans contenu (messagerie, silence) avant tout coût. */
export function transcriptLength(utterances: ReadonlyArray<Utterance>): number {
  return utterances.reduce((total, u) => total + u.text.length, 0);
}
