/**
 * Filtres qu'une recherche LinkedIn n'a pas appliqués tels quels → phrases françaises sous les résultats.
 *
 * La recherche (`unipile-search`, action `search`) rend `filters_dropped` (filtres que la licence du
 * compte ne sait pas exprimer, avec la raison) et `filters_adjusted` (filtres appliqués avec une
 * approximation). Ce module pur relit ces deux listes sans leur faire confiance et écrit les phrases.
 *
 * Seule la clé du filtre est gardée : le libellé du serveur retombe sur la clé brute quand il ne la
 * connaît pas, alors qu'ici une clé inconnue devient « autre critère ». Les clés viennent de
 * `FILTER_LABELS_FR` (supabase/functions/_shared/unipile/normalize/search.ts) et d'`EXTRA_LABELS`
 * (supabase/functions/unipile-search/search-request.ts) ; tests/ux/avis-filtres-recherche.test.mjs
 * vérifie qu'aucune n'a été oubliée.
 *
 * Texte écrit selon docs/design/01-direction.md : vouvoiement, pas de tiret cadratin, jamais le nom
 * d'un prestataire technique.
 */

export interface SearchFiltersNotice {
  /** Filtres non appliqués, avec la raison du serveur (`unsupported`, `exclusion`, `scope`, `value`). */
  dropped: ReadonlyArray<{ filter: string; reason: string }>;
  /** Filtres appliqués avec une approximation. */
  adjusted: ReadonlyArray<{ filter: string }>;
}

/** Libellé d'un critère inconnu : jamais sa clé. */
export const UNKNOWN_FILTER_LABEL = 'autre critère';
const UNKNOWN_FILTERS_LABEL = 'autres critères';

/** Critère de l'état de filtres → mot lu à l'écran, au singulier, en minuscules. */
export const SEARCH_FILTER_LABELS: Readonly<Record<string, string>> = {
  keywords: 'mots-clés',
  skills_keywords: 'compétences suggérées',
  location: 'lieu',
  location_within_area: 'rayon autour du lieu',
  company: 'entreprise',
  past_company: 'entreprise passée',
  company_keywords: 'mots-clés d’entreprise',
  industry: 'secteur',
  exclude_consulting: 'conseil et ESN',
  school: 'école',
  job_title: 'intitulé de poste',
  role: 'poste',
  past_job_title: 'poste passé',
  title_keywords: 'intitulé de poste (mots-clés)',
  skills: 'compétences',
  function: 'fonction',
  degree: 'diplôme',
  seniority: 'séniorité',
  network_distance: 'degré de relation',
  profile_language: 'langue du profil',
  years_of_experience: 'années d’expérience',
  tenure_at_company: 'ancienneté dans l’entreprise',
  tenure_at_role: 'ancienneté dans le poste',
  open_to_work: 'ouvert aux opportunités',
  open_to: 'ouvert à',
  spotlight: 'signaux de disponibilité',
  hiring_project: 'projet de recrutement',
  activity_messages: 'messages envoyés',
  activity_notes: 'notes d’activité',
  tags: 'étiquettes',
  company_headcount: 'taille d’entreprise',
  company_category: 'catégorie d’entreprise',
  company_type: 'type d’entreprise',
  company_location: 'siège de l’entreprise',
  groups: 'groupes',
  employment_type: 'type d’emploi',
  spoken_languages: 'langues parlées',
  recently_joined: 'inscrit récemment',
  graduation_year: 'année de diplôme',
  hide_previously_viewed: 'profils déjà consultés',
  first_name: 'prénom',
  last_name: 'nom',
  changed_jobs: 'changement de poste récent',
  posted_on_linkedin: 'a publié récemment',
  following_your_company: 'suit votre entreprise',
  viewed_your_profile: 'a consulté votre profil',
  past_colleague: 'ancien collègue',
  advanced_keywords: 'mots-clés avancés',
  saved_search_id: 'recherche enregistrée',
  recent_search_id: 'recherche récente',
  recruiting_activity: 'activité de recrutement',
};

/** Précision ajoutée au mot quand le filtre n'est écarté qu'en partie. */
const REASON_SUFFIX: Readonly<Record<string, string>> = {
  exclusion: ' (exclusions)',
  scope: ' (en partie)',
  value: ' (certaines valeurs)',
};

const hasOwn = (table: object, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

/** Mot lu à l'écran pour un critère ; `null` si la clé est inconnue. */
export function knownFilterLabel(key: string): string | null {
  return hasOwn(SEARCH_FILTER_LABELS, key) ? SEARCH_FILTER_LABELS[key] : null;
}

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);

function readNotes(raw: unknown): Array<{ filter: string; reason: string }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ filter: string; reason: string }> = [];
  for (const entry of raw) {
    if (!isDict(entry) || typeof entry.filter !== 'string') continue;
    const filter = entry.filter.trim();
    if (filter === '' || filter.length > 64) continue;
    const reason = typeof entry.reason === 'string' ? entry.reason : 'unsupported';
    const id = `${filter}:${reason}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ filter, reason });
  }
  return out;
}

/** Réponse de `search` → ce qui est à dire sous les résultats, ou `null` quand rien n'a été écarté ni approché. */
export function readSearchFiltersNotice(data: unknown): SearchFiltersNotice | null {
  if (!isDict(data)) return null;
  const dropped = readNotes(data.filters_dropped);
  const adjusted = readNotes(data.filters_adjusted).map(({ filter }) => ({ filter }));
  if (dropped.length === 0 && adjusted.length === 0) return null;
  return { dropped, adjusted };
}

/** Mots des critères : connus dans l'ordre du serveur, les inconnus réunis en un seul à la fin. */
function words(entries: ReadonlyArray<{ filter: string; suffix: string }>): string[] {
  const out: string[] = [];
  let unknown = 0;
  for (const { filter, suffix } of entries) {
    const label = knownFilterLabel(filter);
    if (label === null) unknown += 1;
    else if (!out.includes(`${label}${suffix}`)) out.push(`${label}${suffix}`);
  }
  if (unknown > 0) out.push(unknown > 1 ? UNKNOWN_FILTERS_LABEL : UNKNOWN_FILTER_LABEL);
  return out;
}

/** « Votre compte LinkedIn ne sait pas appliquer ces filtres : compétences, poste. La recherche a été faite sans eux. » */
export function droppedFiltersText(notice: SearchFiltersNotice): string | null {
  const list = words(notice.dropped.map(({ filter, reason }) => ({ filter, suffix: hasOwn(REASON_SUFFIX, reason) ? REASON_SUFFIX[reason] : '' })));
  if (list.length === 0) return null;
  return list.length === 1
    ? `Votre compte LinkedIn ne sait pas appliquer ce filtre : ${list[0]}. La recherche a été faite sans lui.`
    : `Votre compte LinkedIn ne sait pas appliquer ces filtres : ${list.join(', ')}. La recherche a été faite sans eux.`;
}

/** « Filtres appliqués de façon approchée : années d’expérience. » */
export function adjustedFiltersText(notice: SearchFiltersNotice): string | null {
  const list = words(notice.adjusted.map(({ filter }) => ({ filter, suffix: '' })));
  if (list.length === 0) return null;
  return `Filtres appliqués de façon approchée : ${list.join(', ')}.`;
}

/** Les phrases à afficher, une par ligne ; vide quand il n'y a rien à dire. */
export function searchFiltersNoticeLines(notice: SearchFiltersNotice | null | undefined): string[] {
  if (!notice) return [];
  return [droppedFiltersText(notice), adjustedFiltersText(notice)].filter((line): line is string => line !== null);
}
