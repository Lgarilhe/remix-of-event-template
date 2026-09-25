/**
 * Vérifie la compatibilité entre une séquence outreach et un profil LinkedIn.
 *
 * Pourquoi : on évite que l'user enrôle un profil qui va échouer
 * silencieusement à la 1ʳᵉ étape. Exemples :
 * - Séquence avec connection_request → profil 1st degree va échouer
 *   (déjà connectés, on ne peut pas re-inviter)
 * - Séquence avec inmail uniquement → profil 1st degree pourrait recevoir
 *   un message direct au lieu d'un InMail (gaspillage crédits InMail)
 */

export type NetworkDistance =
  | 'FIRST_DEGREE'
  | 'SECOND_DEGREE'
  | 'THIRD_DEGREE'
  | 'OUT_OF_NETWORK'
  | string
  | number
  | null
  | undefined;

/**
 * Normalise les différents formats de network_distance reçus de Unipile :
 * 1 / "1" / "DISTANCE_1" → "FIRST_DEGREE"
 * 2 / "2" / "DISTANCE_2" → "SECOND_DEGREE"
 * etc.
 */
export function normalizeNetworkDistance(d: NetworkDistance): string | null {
  if (d == null) return null;
  if (d === 1 || d === '1' || d === 'DISTANCE_1' || d === 'FIRST_DEGREE') return 'FIRST_DEGREE';
  if (d === 2 || d === '2' || d === 'DISTANCE_2' || d === 'SECOND_DEGREE') return 'SECOND_DEGREE';
  if (d === 3 || d === '3' || d === 'DISTANCE_3' || d === 'THIRD_DEGREE') return 'THIRD_DEGREE';
  if (typeof d === 'string') return d;
  return null;
}

export interface SequenceStep {
  action_type?: string;
  actionType?: string;
  step_order?: number;
  stepOrder?: number;
}

export interface ProfileCompat {
  id: string;
  name?: string | null;
  network_distance?: NetworkDistance;
}

export type CompatIssue =
  | 'connection_already_connected'   // 1st degree → connection_request va échouer
  | 'inmail_wasted'                  // 1st degree → InMail gaspille un crédit
  | 'too_far'                        // > 3rd degree → ne peut pas être contacté
  | null;

export interface ProfileCompatResult {
  profile: ProfileCompat;
  distance: string | null;
  issue: CompatIssue;
  message: string | null;
}

/**
 * Récupère le 1er action_type de séquence (= ce qui sera tenté en premier).
 * Si la séquence commence par "visit" ou "wait", on cherche la 1ère action
 * qui touche le candidat (message/connection/inmail).
 */
export function getSequenceFirstReachAction(steps: SequenceStep[]): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const sorted = [...steps].sort((a, b) =>
    (a.step_order ?? a.stepOrder ?? 0) - (b.step_order ?? b.stepOrder ?? 0)
  );
  for (const s of sorted) {
    const t = (s.action_type || s.actionType || '').toLowerCase();
    if (['connection_request', 'message', 'inmail', 'smart_message', 'email', 'whatsapp_message'].includes(t)) {
      return t;
    }
  }
  return null;
}

/**
 * Liste tous les action_types présents dans la séquence (pour détecter
 * les multi-modes, ex: connection_request + message = invite puis suivre).
 */
export function getSequenceActionTypes(steps: SequenceStep[]): Set<string> {
  const set = new Set<string>();
  for (const s of (steps || [])) {
    const t = (s.action_type || s.actionType || '').toLowerCase();
    if (t) set.add(t);
  }
  return set;
}

/**
 * Calcule la compatibilité d'un profil avec une séquence.
 * Retourne un objet avec issue=null si tout est OK.
 */
export function checkProfileCompat(
  profile: ProfileCompat,
  steps: SequenceStep[],
): ProfileCompatResult {
  const distance = normalizeNetworkDistance(profile.network_distance);
  const actions = getSequenceActionTypes(steps);
  const firstReach = getSequenceFirstReachAction(steps);

  // Cas 1 : 1st degree + séquence avec connection_request → échec garanti
  if (distance === 'FIRST_DEGREE' && actions.has('connection_request')) {
    // Si la séquence commence direct par connection_request, c'est bloquant
    if (firstReach === 'connection_request') {
      return {
        profile,
        distance,
        issue: 'connection_already_connected',
        message: 'Vous êtes déjà en relation : l\'invitation LinkedIn échouera.',
      };
    }
    // Si connection_request est plus tard dans la séquence, l'enrollment
    // ira jusque-là puis échouera. Warning soft.
    return {
      profile,
      distance,
      issue: 'connection_already_connected',
      message: 'Vous êtes déjà en relation : l\'invitation prévue plus loin dans la séquence échouera.',
    };
  }

  // Cas 2 : 1st degree + séquence en InMail uniquement → gaspillage de crédit
  if (distance === 'FIRST_DEGREE' && firstReach === 'inmail' && !actions.has('message')) {
    return {
      profile,
      distance,
      issue: 'inmail_wasted',
      message: 'Vous êtes déjà en relation : un message direct serait gratuit, l\'InMail consomme un crédit.',
    };
  }

  // Cas 3 : hors réseau → seul un InMail peut l'atteindre. Une séquence qui
  // comporte un InMail reste donc possible pour ce candidat.
  if (distance === 'OUT_OF_NETWORK' && !actions.has('inmail')) {
    return {
      profile,
      distance,
      issue: 'too_far',
      message: 'Hors de votre réseau LinkedIn : seul un InMail peut l\'atteindre.',
    };
  }

  return { profile, distance, issue: null, message: null };
}

/**
 * Calcule la compatibilité de tous les profils + retourne un résumé.
 */
export function checkProfilesCompat(
  profiles: ProfileCompat[],
  steps: SequenceStep[],
): {
  compatible: ProfileCompatResult[];
  warnings: ProfileCompatResult[];
  blockers: ProfileCompatResult[];
} {
  const compatible: ProfileCompatResult[] = [];
  const warnings: ProfileCompatResult[] = [];
  const blockers: ProfileCompatResult[] = [];

  for (const profile of profiles) {
    const result = checkProfileCompat(profile, steps);
    if (result.issue === null) {
      compatible.push(result);
    } else if (result.issue === 'connection_already_connected' || result.issue === 'too_far') {
      blockers.push(result);
    } else {
      warnings.push(result);
    }
  }

  return { compatible, warnings, blockers };
}

/** Étape de séquence telle que lue dans sequence_steps (champs utiles au choix de la première étape). */
export interface FirstStepCandidate {
  step_order?: number | null;
  stepOrder?: number | null;
  parent_step_id?: string | null;
  branch?: string | null;
  variant_group?: string | null;
  variant_weight?: number | null;
}

/**
 * Première étape à planifier pour UNE inscription, avec le même tirage que le
 * moteur (process-sequences, scheduleNextStep) :
 * - étapes de premier niveau (ni branche, ni parent), plus petit step_order ;
 * - une ligne sans variant_group à cet ordre l'emporte (même ordre de tri que
 *   le repli linéaire du moteur : variant_group nulls first) ;
 * - sinon, si plusieurs variantes partagent l'ordre : tirage pondéré par
 *   variant_weight (100 par défaut), et variantAssigned = variant_group retenu.
 * À appeler une fois par candidat : chaque inscription a son propre tirage.
 */
export function pickFirstStep<T extends FirstStepCandidate>(
  steps: readonly T[],
  random: () => number = Math.random,
): { step: T | null; variantAssigned: string | null } {
  if (!Array.isArray(steps) || steps.length === 0) return { step: null, variantAssigned: null };
  const orderOf = (s: T) => s.step_order ?? s.stepOrder ?? 0;
  const topLevel = steps.filter(s => !s.parent_step_id && !s.branch);
  const pool = topLevel.length > 0 ? topLevel : [...steps];
  const minOrder = Math.min(...pool.map(orderOf));
  const atFirstOrder = pool.filter(s => orderOf(s) === minOrder);

  const plain = atFirstOrder.find(s => !s.variant_group);
  if (plain) return { step: plain, variantAssigned: null };

  const variants = atFirstOrder.filter(s => !!s.variant_group);
  if (variants.length === 1) return { step: variants[0], variantAssigned: variants[0].variant_group ?? null };

  const weightOf = (s: T) => s.variant_weight || 100;
  const total = variants.reduce((sum, v) => sum + weightOf(v), 0);
  let draw = random() * total;
  let chosen = variants[variants.length - 1];
  for (const variant of variants) {
    draw -= weightOf(variant);
    if (draw <= 0) {
      chosen = variant;
      break;
    }
  }
  return { step: chosen, variantAssigned: chosen.variant_group ?? null };
}
