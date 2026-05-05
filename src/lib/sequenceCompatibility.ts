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
        message: 'Déjà 1er niveau — l\'invitation LinkedIn échouera. Préfère une séquence sans demande de connexion.',
      };
    }
    // Si connection_request est plus tard dans la séquence, l'enrollment
    // ira jusque-là puis échouera. Warning soft.
    return {
      profile,
      distance,
      issue: 'connection_already_connected',
      message: 'Déjà 1er niveau — la demande de connexion plus tard dans la séquence échouera.',
    };
  }

  // Cas 2 : 1st degree + séquence en InMail uniquement → gaspillage de crédit
  if (distance === 'FIRST_DEGREE' && firstReach === 'inmail' && !actions.has('message')) {
    return {
      profile,
      distance,
      issue: 'inmail_wasted',
      message: 'Déjà 1er niveau — un message direct serait gratuit, l\'InMail consomme un crédit.',
    };
  }

  // Cas 3 : pas en 1st/2nd/3rd degree → contact LinkedIn impossible
  if (distance === 'OUT_OF_NETWORK') {
    return {
      profile,
      distance,
      issue: 'too_far',
      message: 'Hors du réseau LinkedIn — contact impossible sans InMail Recruiter.',
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
