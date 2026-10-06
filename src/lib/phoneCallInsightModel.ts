/**
 * L'analyse d'un appel (table phone_call_insights), mise en forme pour l'écran.
 *
 * Fonctions pures, sans importation à l'exécution : lues telles quelles par les
 * tests Node (tests/c1/telephonie-transcription.test.mjs). L'écriture et le
 * vocabulaire des étiquettes vivent côté serveur (supabase/functions/_shared/
 * phone-call-insight.ts) : l'écran affiche ce qu'il reçoit, sans le redéfinir.
 */

export type InsightStatus = 'pending' | 'analyzing' | 'done' | 'failed' | 'skipped';

export interface InsightStep {
  action: string;
  owner: 'recruiter' | 'contact' | null;
  when: string | null;
}

export interface InsightFact {
  key: string;
  label: string;
  value: string;
}

export interface CallInsight {
  callId: string;
  status: InsightStatus;
  reason: string | null;
  summary: string | null;
  tags: string[];
  facts: InsightFact[];
  nextSteps: InsightStep[];
  missionId: string | null;
  missionFit: string | null;
  analyzedAt: string | null;
}

/** Ce que l'écran garde d'une analyse dans une liste d'appels. */
export interface InsightLight {
  status: InsightStatus;
  tags: string[];
}

/** Dans l'ordre d'affichage. */
export const FACT_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'availability', label: 'Disponibilité' },
  { key: 'salary', label: 'Rémunération' },
  { key: 'location', label: 'Lieu' },
  { key: 'remote', label: 'Télétravail' },
  { key: 'motivation', label: 'Ce qui motive' },
  { key: 'other_processes', label: 'Autres process' },
];

const STATUSES: ReadonlyArray<string> = ['pending', 'analyzing', 'done', 'failed', 'skipped'];

export const toStatus = (value: unknown): InsightStatus =>
  (typeof value === 'string' && STATUSES.includes(value) ? value : 'pending') as InsightStatus;

export function parseFacts(json: unknown): InsightFact[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  const source = json as Record<string, unknown>;
  const out: InsightFact[] = [];
  for (const { key, label } of FACT_LABELS) {
    const value = typeof source[key] === 'string' ? (source[key] as string).trim() : '';
    if (value) out.push({ key, label, value });
  }
  return out;
}

export function parseSteps(json: unknown): InsightStep[] {
  if (!Array.isArray(json)) return [];
  const out: InsightStep[] = [];
  for (const item of json) {
    const s = item as Record<string, unknown> | null;
    const action = typeof s?.action === 'string' ? s.action.trim() : '';
    if (!action) continue;
    out.push({
      action,
      owner: s?.owner === 'recruiter' || s?.owner === 'contact' ? s.owner : null,
      when: typeof s?.when === 'string' && s.when.trim() ? s.when.trim() : null,
    });
  }
  return out;
}

export interface InsightRow {
  call_id: string;
  status: string;
  reason: string | null;
  summary: string | null;
  tags: string[] | null;
  facts: unknown;
  next_steps: unknown;
  mission_id: string | null;
  mission_fit: string | null;
  analyzed_at: string | null;
}

export function insightFromRow(row: InsightRow): CallInsight {
  return {
    callId: row.call_id,
    status: toStatus(row.status),
    reason: row.reason,
    summary: row.summary,
    tags: row.tags ?? [],
    facts: parseFacts(row.facts),
    nextSteps: parseSteps(row.next_steps),
    missionId: row.mission_id,
    missionFit: row.mission_fit,
    analyzedAt: row.analyzed_at,
  };
}

/** Phrase de l'état d'une analyse qui n'est pas (ou pas encore) un résultat. Null quand il y a un résultat à montrer. */
export function insightStateText(status: InsightStatus, reason: string | null): string | null {
  switch (status) {
    case 'done':
      return null;
    case 'pending':
      return 'Analyse en attente.';
    case 'analyzing':
      return 'Analyse en cours…';
    case 'skipped':
      return reason === 'too_short' ? 'Appel trop court pour être analysé.' : "Cet appel n'a pas été analysé.";
    case 'failed':
      if (reason === 'insufficient_credits') return 'Crédits IA insuffisants pour analyser cet appel.';
      return "L'analyse n'a pas pu se faire.";
  }
}

/** Une analyse qui peut encore bouger : l'écran la relit régulièrement. */
export const isInsightInProgress = (status: InsightStatus | undefined): boolean => status === 'pending' || status === 'analyzing';

/** Une analyse qu'on peut relancer d'un geste. */
export const canRetryInsight = (status: InsightStatus | undefined): boolean => status === 'failed' || status === 'pending' || status === 'skipped';

export const OWNER_LABEL: Record<'recruiter' | 'contact', string> = {
  recruiter: 'Recruteur',
  contact: 'Correspondant',
};

/** Les étiquettes présentes dans les appels chargés, de la plus fréquente à la moins fréquente. */
export function tagsInUse(lights: Iterable<InsightLight>): string[] {
  const counts = new Map<string, number>();
  for (const light of lights) for (const tag of light.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).map(([tag]) => tag);
}

export interface TranscriptLine {
  who: 'agent' | 'contact' | 'unknown';
  text: string;
  start: number | null;
}

/** La transcription gardée en base, relue sans rien supposer de sa forme. */
export function parseTranscript(json: unknown): TranscriptLine[] {
  if (!Array.isArray(json)) return [];
  const lines: TranscriptLine[] = [];
  for (const item of json) {
    const u = item as Record<string, unknown> | null;
    const text = typeof u?.text === 'string' ? u.text.trim() : '';
    if (!text) continue;
    const who = u?.who === 'agent' || u?.who === 'contact' ? u.who : 'unknown';
    const start = typeof u?.start === 'number' && Number.isFinite(u.start) ? u.start : null;
    const last = lines[lines.length - 1];
    // Les prises de parole successives d'une même personne se lisent d'un bloc.
    if (last && last.who === who) last.text += ` ${text}`;
    else lines.push({ who, text, start });
  }
  return lines;
}

/** 75 → « 1:15 » : où se trouve une prise de parole dans l'appel. */
export function formatOffset(seconds: number | null): string {
  if (seconds === null) return '';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
