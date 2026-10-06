/**
 * Ajouter un candidat depuis LinkedIn (depuis un appel inconnu) : les règles,
 * sans appel réseau. Les appels (recherche, profil complet, écriture) sont dans
 * linkedinQuickFind.ts.
 *
 * Fonctions pures, sans importation à l'exécution : lues telles quelles par les
 * tests Node (tests/c1/telephonie-linkedin-ajout.test.mjs).
 *
 * Garde-fous voulus : UNE recherche par clic (jamais d'enchaînement ni de relance
 * automatique), le compte LinkedIn de la personne connectée seulement, et un
 * message clair quand LinkedIn ou le quota refuse (au lieu de réessayer).
 */

export type SearchApi = 'recruiter' | 'sales_navigator' | 'classic';

export interface LinkedInSubscriptions {
  classic?: boolean;
  recruiter?: boolean;
  sales_navigator?: boolean;
}

/** Même ordre que la recherche du Sourcing : la licence la plus riche du compte. */
export function pickSearchApi(subscriptions: LinkedInSubscriptions | null | undefined): SearchApi {
  if (subscriptions?.recruiter) return 'recruiter';
  if (subscriptions?.sales_navigator) return 'sales_navigator';
  return 'classic';
}

export interface LinkedInPerson {
  /** Identifiant du résultat, celui que le Sourcing garde comme candidate_id. */
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  profileUrl: string | null;
  pictureUrl: string | null;
  /** Le résultat tel que reçu, gardé avec le profil du candidat. */
  raw: Record<string, unknown>;
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

/** LinkedIn masque le nom d'un profil hors réseau : rien d'utile à ajouter. */
const HIDDEN_NAME = /^(linkedin member|membre linkedin|utilisateur linkedin)$/i;

/** Un résultat de recherche brut vers une personne ; null s'il n'a ni identifiant ni nom exploitable. */
export function toPerson(item: unknown): LinkedInPerson | null {
  if (!item || typeof item !== 'object') return null;
  const r = item as Record<string, unknown>;
  const id = str(r.id) ?? str(r.provider_id);
  const name = str(r.name) ?? ([str(r.first_name), str(r.last_name)].filter(Boolean).join(' ') || null);
  if (!id || !name || HIDDEN_NAME.test(name)) return null;
  const location = typeof r.location === 'string' ? str(r.location) : str((r.location as { name?: unknown } | null)?.name);
  return {
    id,
    name,
    headline: str(r.headline),
    location,
    profileUrl: str(r.public_profile_url) ?? str(r.profile_url),
    pictureUrl: str(r.profile_picture_url) ?? str(r.picture_url),
    raw: r,
  };
}

/** « https://www.linkedin.com/in/marc-moreau-1a2b/ » → « marc-moreau-1a2b ». */
export function linkedinSlug(url: string | null | undefined): string | null {
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(url ?? '');
  if (!m) return null;
  // Seulement ce qui peut se glisser sans risque dans un filtre de recherche.
  const slug = m[1].toLowerCase();
  return /^[a-z0-9%_-]+$/.test(slug) ? slug : null;
}

export type QuickFindErrorKind = 'quota' | 'rate_limit' | 'not_linked' | 'session' | 'expired' | 'other';

export interface QuickFindError {
  kind: QuickFindErrorKind;
  message: string;
}

/**
 * La réponse de unipile-search quand `success` est faux. Jamais de relance
 * automatique derrière ces messages : ils sont affichés tels quels.
 */
export function classifyQuickFindError(
  data: { error?: unknown; errorType?: unknown } | null | undefined,
  httpStatus?: number,
): QuickFindError {
  const type = typeof data?.errorType === 'string' ? data.errorType : '';
  const error = typeof data?.error === 'string' ? data.error : '';
  if (type === 'QUOTA') {
    return { kind: 'quota', message: "Le quota LinkedIn du jour est atteint pour votre compte. Réessayez demain." };
  }
  if (type === 'RATE_LIMIT' || httpStatus === 429) {
    return { kind: 'rate_limit', message: 'LinkedIn demande de ralentir. Réessayez dans une minute.' };
  }
  if (type === 'ACCOUNT_NOT_LINKED' || httpStatus === 403) {
    return { kind: 'not_linked', message: "Ce compte LinkedIn n'est pas relié à votre organisation. Reliez le vôtre dans Réglages." };
  }
  if (type === 'multiple_sessions' || /multiple_sessions/i.test(error)) {
    return { kind: 'session', message: "LinkedIn voit deux sessions ouvertes sur ce compte. Fermez l'autre session et réessayez plus tard." };
  }
  if (httpStatus === 401) {
    return { kind: 'expired', message: 'Votre session a expiré. Reconnectez-vous.' };
  }
  return { kind: 'other', message: error || "La recherche LinkedIn n'a pas abouti. Réessayez." };
}

/**
 * Fusionne le profil complet sur le résultat de recherche, sans jamais écraser
 * une donnée connue par du vide (null, texte vide, liste vide).
 */
export function mergeProfile(base: Record<string, unknown>, full: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(full ?? {})) {
    const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (!empty) merged[key] = value;
  }
  return merged;
}

/** Nom de la recherche qui reçoit les candidats ajoutés depuis un appel, sans mission choisie. */
export const CALLS_SEARCH_NAME = 'Candidats ajoutés depuis un appel';

export interface MissionOption {
  id: string;
  name: string;
  client: string | null;
}

interface MissionLike {
  id: string;
  name?: string | null;
  status?: string | null;
  jd_client?: string | null;
  client_name?: string | null;
}

/**
 * Les missions proposées pour y ranger le candidat : celles en cours (comme le
 * sélecteur de mission de la création de tâche), dans l'ordre reçu (la plus
 * récemment modifiée d'abord). Une mission sans nom n'est pas proposée.
 */
export function openMissionOptions(projects: ReadonlyArray<MissionLike> | null | undefined): MissionOption[] {
  const options: MissionOption[] = [];
  for (const p of projects ?? []) {
    const name = str(p.name);
    if (p.status !== 'active' || !name) continue;
    options.push({ id: p.id, name, client: str(p.jd_client) ?? str(p.client_name) });
  }
  return options;
}

export function missionLabel(mission: MissionOption): string {
  return mission.client ? `${mission.name} · ${mission.client}` : mission.name;
}

export interface QuotaSnapshot {
  today: { searches: number; profile_views: number };
  caps: { searches: number; profile_views: number };
}

/**
 * Ce qu'il reste du quota LinkedIn du jour pour une recherche suivie d'un
 * ajout : une recherche et une lecture de profil. `canSearch` faux dès que le
 * plafond de recherches est atteint (le serveur refuserait de toute façon).
 */
export function quotaLeft(quota: QuotaSnapshot | null | undefined): { searches: number; profileViews: number; canSearch: boolean } | null {
  if (!quota) return null;
  const searches = Math.max(0, quota.caps.searches - quota.today.searches);
  const profileViews = Math.max(0, quota.caps.profile_views - quota.today.profile_views);
  return { searches, profileViews, canSearch: searches > 0 };
}

export interface CandidateRowInput {
  projectId: string;
  organizationId: string;
  userId: string;
  person: LinkedInPerson;
  /** Réponse de get_profile ; null si le profil complet n'a pas pu être lu. */
  fullProfile: Record<string, unknown> | null;
}

/**
 * La ligne job_candidate_status d'un candidat ajouté depuis LinkedIn : comme
 * un résultat du Sourcing, dans une recherche (jamais « discovered », que la
 * vue Pipeline masque, ni d'étape : le déclencheur pose « À trier »).
 */
export function buildCandidateRow({ projectId, organizationId, userId, person, fullProfile }: CandidateRowInput) {
  const data = mergeProfile(person.raw, fullProfile);
  const picture = str(data.profile_picture_url) ?? str(data.picture_url) ?? person.pictureUrl;
  return {
    job_id: `project:${projectId}`,
    project_id: projectId,
    organization_id: organizationId,
    created_by: userId,
    candidate_id: person.id,
    candidate_name: person.name,
    candidate_headline: person.headline ?? str(data.headline),
    linkedin_profile_url: person.profileUrl,
    linkedin_profile_data: { ...data, ...(picture ? { profile_picture_url: picture } : {}) },
  };
}
