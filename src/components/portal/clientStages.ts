/**
 * Étapes du portail client : un seul vocabulaire pour le client, quelle que
 * soit la clé écrite dans job_candidate_status.pipeline_stage (pipeline de
 * l'ATS, colonnes du kanban de mission, identifiant d'une étape du processus,
 * vocabulaire historique du portail).
 *
 * Provisoire : la table d'étapes unique partagée (ATS, kanban, portails) attend
 * une décision produit (constat F-53). D'ici là, une clé connue reçoit son
 * libellé client, une clé inconnue le repli « En cours », jamais la clé brute.
 */

export type ClientStageKey = 'sourced' | 'presented' | 'to_evaluate' | 'interview' | 'offer' | 'hired' | 'rejected';

export type ClientStageTone = 'muted' | 'info' | 'warning' | 'success';

export interface ClientStage {
  /** Colonne du portail ; null pour une clé inconnue (repli « En cours »). */
  key: ClientStageKey | null;
  label: string;
  tone: ClientStageTone;
  order: number;
}

export const CLIENT_STAGES: Record<ClientStageKey, ClientStage> = {
  sourced: { key: 'sourced', label: 'Nouveau', tone: 'muted', order: 1 },
  presented: { key: 'presented', label: 'Présenté', tone: 'info', order: 2 },
  to_evaluate: { key: 'to_evaluate', label: 'À évaluer', tone: 'warning', order: 3 },
  interview: { key: 'interview', label: 'Entretien', tone: 'info', order: 4 },
  offer: { key: 'offer', label: 'Offre', tone: 'info', order: 5 },
  hired: { key: 'hired', label: 'Embauché', tone: 'success', order: 6 },
  rejected: { key: 'rejected', label: 'Non retenu', tone: 'muted', order: 7 },
};

/** Étapes du parcours, dans l'ordre (colonnes du pipeline, répartition). Les non-retenus en sont exclus. */
export const CLIENT_FUNNEL: ClientStageKey[] = ['sourced', 'presented', 'to_evaluate', 'interview', 'offer', 'hired'];

/** Clés connues, en minuscules, vers l'étape vue par le client. */
const KEY_MAP: Record<string, ClientStageKey> = {
  // Vocabulaire historique du portail
  sourced: 'sourced',
  presented: 'presented',
  to_evaluate: 'to_evaluate',
  interview: 'interview',
  offer: 'offer',
  hired: 'hired',
  rejected: 'rejected',
  // Colonnes du kanban de mission et anciens statuts
  untreated: 'sourced',
  messaged: 'sourced',
  replied: 'sourced',
  interested: 'sourced',
  shortlisted: 'presented',
  dismissed: 'rejected',
  // Pipeline (ATS) : avant présentation, le candidat reste « nouveau » pour le client
  nouveau: 'sourced',
  'contacté': 'sourced',
  'répondu': 'sourced',
  pressenti: 'sourced',
  'pré-qualif': 'sourced',
  'cv envoyé': 'presented',
  'itw en cours': 'interview',
  offre: 'offer',
  'gagné': 'hired',
  perdu: 'rejected',
};

/** Identifiant d'une étape du processus de la mission (entretiens). */
const STEP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FALLBACK: ClientStage = { key: null, label: 'En cours', tone: 'muted', order: 99 };

export function resolveClientStage(raw: string | null | undefined): ClientStage {
  const value = raw?.trim();
  if (!value) return CLIENT_STAGES.sourced;
  const normalized = value.toLowerCase();
  const key = KEY_MAP[normalized] ?? KEY_MAP[normalized.replace(/\s+/g, '_')];
  if (key) return CLIENT_STAGES[key];
  // Les étapes du processus d'une mission sont ses entretiens.
  if (STEP_ID.test(value)) return CLIENT_STAGES.interview;
  return FALLBACK;
}
