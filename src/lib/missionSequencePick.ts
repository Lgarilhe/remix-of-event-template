// Refonte mission, lot 5f-2c : choix de la séquence dans le panneau Contacter.
// Règle (décision 5 de lot5f2b-conception.md) : parmi les séquences actives et
// non vides qui appartiennent à la mission, la plus récente est choisie
// d'avance. Aucune : rien n'est présélectionné et la porte « Rédiger une
// séquence pour cette mission » s'affiche. Les autres séquences utilisables de
// l'organisation (partagées ou d'une autre mission) restent dans le menu.
//
// Module pur, testé sous Node (tests/ux/lot5f2c-libs.test.mjs) : aucune lecture,
// aucune écriture, aucun import.

export interface PickableSequence {
  id: string;
  name: string;
  is_active: boolean;
  /** Identifiant nu de la mission (jamais « project:<id> »), ou null pour une séquence partagée. */
  project_id: string | null;
  created_at: string;
  /** Nombre d'étapes visibles par l'appelant (la lecture est bornée par la RLS). */
  stepCount: number;
}

export interface SequenceMenu<T extends PickableSequence = PickableSequence> {
  /** Séquences utilisables de la mission, de la plus récente à la plus ancienne. */
  mission: T[];
  /** Les autres séquences utilisables, même tri. */
  others: T[];
  /** Le choix d'avance : la plus récente de la mission, sinon rien. */
  pick: T | null;
}

const MISSION_PREFIX = 'project:';

/** Identifiant nu d'une mission : retire le préfixe « project: » d'un identifiant de poste. */
export function bareMissionId(jobId: string | null | undefined): string | null {
  if (typeof jobId !== 'string' || jobId === '') return null;
  const bare = jobId.startsWith(MISSION_PREFIX) ? jobId.slice(MISSION_PREFIX.length) : jobId;
  return bare === '' ? null : bare;
}

function timeOf(iso: string): number {
  const time = Date.parse(iso);
  // Une date illisible passe pour la plus ancienne ; le tri reste déterministe.
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Du plus récent au plus ancien ; à égalité de date, identifiant décroissant. */
function newestFirst(a: PickableSequence, b: PickableSequence): number {
  const timeA = timeOf(a.created_at);
  const timeB = timeOf(b.created_at);
  if (timeA !== timeB) return timeB > timeA ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** Une séquence qui peut recevoir des inscriptions : active et avec au moins une étape. */
function isUsable(sequence: PickableSequence): boolean {
  return sequence.is_active === true && sequence.stepCount > 0;
}

/**
 * Menu du panneau Contacter : séquences de la mission, autres séquences de
 * l'organisation, et le choix d'avance. `missionId` est l'identifiant nu de la
 * mission ; un identifiant « project:<id> » est accepté et ramené à l'identifiant nu.
 */
export function missionSequenceMenu<T extends PickableSequence>(
  list: readonly T[],
  missionId: string | null,
): SequenceMenu<T> {
  const bare = bareMissionId(missionId);
  const usable = list.filter(isUsable).sort(newestFirst);
  const mission: T[] = [];
  const others: T[] = [];
  for (const sequence of usable) {
    // Une mission inconnue (null) ne rattache jamais une séquence partagée (project_id null).
    if (bare !== null && sequence.project_id === bare) mission.push(sequence);
    else others.push(sequence);
  }
  return { mission, others, pick: mission[0] ?? null };
}
