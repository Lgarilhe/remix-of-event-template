/** Build a people search from the mission's saved filters. No generated query,
 * account fallback, or silently discarded mandatory filter is allowed here. */
import { searchBooleanIssue } from './search-boolean.ts';
export type ContinuousSearchApi = 'classic' | 'recruiter' | 'sales_navigator';
type Obj = Record<string, unknown>;
type Priority = 'MUST_HAVE' | 'CAN_HAVE' | 'DOESNT_HAVE';

export class ContinuousSearchFilterError extends Error {
  constructor(public code: 'filters_unresolved' | 'filters_unsupported' | 'filters_invalid', message: string) {
    super(message);
  }
}

function obj(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function list(value: unknown): unknown[] {
  if (!present(value)) return [];
  if (!Array.isArray(value)) fail('filters_invalid', 'Revoyez le format des listes dans les filtres.');
  return value;
}
function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && value !== ''
    && (Array.isArray(value) ? value.length > 0 : typeof value === 'object' ? Object.keys(value).length > 0 : true);
}
function fail(code: ContinuousSearchFilterError['code'], message: string): never {
  throw new ContinuousSearchFilterError(code, message);
}
function priority(value: unknown): Priority {
  const p = value ?? 'MUST_HAVE';
  if (p !== 'MUST_HAVE' && p !== 'CAN_HAVE' && p !== 'DOESNT_HAVE') {
    fail('filters_invalid', 'Revoyez les priorités dans les filtres de la recherche.');
  }
  return p;
}
function identifier(value: unknown): string {
  const id = typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);
  if (!id || !/^[\w:-]{1,128}$/.test(id)) {
    fail('filters_unresolved', 'Validez les lieux, entreprises et écoles dans les filtres de la recherche.');
  }
  return id;
}
function entries(value: unknown): Obj[] {
  if (!present(value)) return [];
  if (!Array.isArray(value)) fail('filters_invalid', 'Revoyez le format des filtres de la recherche.');
  return value.map(v => typeof v === 'string' || typeof v === 'number' ? { id: v } : obj(v));
}
function facetId(value: unknown): string {
  const id = identifier(value);
  if (!/^\d+$/.test(id) || Number(id) <= 0) {
    fail('filters_unresolved', 'Sélectionnez les lieux, entreprises, écoles et intitulés dans les suggestions des filtres.');
  }
  return id;
}
function range(min: unknown, max: unknown, upper = 100): Obj | null {
  const out: Obj = {};
  for (const [key, value] of [['min', min], ['max', max]]) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > upper) {
      fail('filters_invalid', 'Revoyez les durées dans les filtres de la recherche.');
    }
    out[key as string] = value;
  }
  if (typeof out.min === 'number' && typeof out.max === 'number' && out.min > out.max) {
    fail('filters_invalid', 'La durée minimale doit précéder la durée maximale.');
  }
  return Object.keys(out).length ? out : null;
}
const COUNTRY_IDS = new Set(['105015875', '101165590', '101174742', '102713980', '103644278', '106155005', '103350119', '100565514', '103883259', '102890719', '100364837', '104738515', '101620260', '102478259', '104305776', '105646813']);


function booleanQuery(value: unknown, label: string, api: ContinuousSearchApi): string {
  const query = text(value);
  if (!query) fail('filters_invalid', 'Renseignez la requête « ' + label + ' » dans les filtres.');
  // Classic/Sales reject queries above the app's supported limit; Recruiter
  // preserves its full query. Eligibility and transport use the same syntax.
  if (api !== 'recruiter' && query.length > 200) {
    fail('filters_invalid', 'La requête « ' + label + ' » contient ' + query.length
      + ' caractères. L’agent accepte actuellement jusqu’à 200 caractères pour cette licence. Revoyez les filtres.');
  }
  if (searchBooleanIssue(query)) {
    fail('filters_invalid', 'Validez les guillemets et les opérateurs de la requête « ' + label + ' ».');
  }
  return query;
}
function enumValues(value: unknown, allowed: readonly unknown[], label: string): unknown[] {
  if (!Array.isArray(value)) fail('filters_invalid', 'Revoyez le filtre « ' + label + ' ».');
  if (value.some(v => !allowed.includes(v))) fail('filters_invalid', 'Revoyez le filtre « ' + label + ' ».');
  return [...new Set(value)];
}
function scope(value: unknown, fallback: string, allowed: readonly string[], label: string): string {
  const s = value == null ? fallback : text(value);
  if (!allowed.includes(s)) fail('filters_invalid', 'Revoyez la période du filtre « ' + label + ' ».');
  return s;
}
function facets(value: unknown, fallback: Priority = 'MUST_HAVE', includePriority: Priority = 'MUST_HAVE'): Array<{ id: string; priority: Priority; scope?: unknown }> {
  if (!present(value)) return [];
  if (Array.isArray(value)) return entries(value).map(v => ({ id: facetId(v.id), priority: priority(v.priority ?? fallback), scope: v.scope }));
  const groups = obj(value);
  if (!Object.keys(groups).length || Object.keys(groups).some(k => !['include', 'exclude'].includes(k))) fail('filters_invalid', 'Revoyez les filtres à inclure et à exclure.');
  return [
    ...list(groups.include).map(id => ({ id: facetId(id), priority: includePriority })),
    ...list(groups.exclude).map(id => ({ id: facetId(id), priority: 'DOESNT_HAVE' as const })),
  ];
}
function recruiterOnly(api: ContinuousSearchApi, label: string): void {
  if (api !== 'recruiter') fail('filters_unsupported', 'Le filtre « ' + label + ' » nécessite Recruiter. Retirez-le ou changez de licence.');
}
const ROLE_SCOPES = ['CURRENT', 'PAST', 'CURRENT_OR_PAST'];
const COMPANY_SCOPES = [...ROLE_SCOPES, 'PAST_NOT_CURRENT'];
const LOCATION_SCOPES = ['CURRENT', 'OPEN_TO_RELOCATE_ONLY', 'CURRENT_OR_OPEN_TO_RELOCATE'];
const SPOTLIGHTS = ['OPEN_TO_WORK', 'ACTIVE_TALENT', 'REDISCOVERED_CANDIDATES', 'INTERNAL_CANDIDATES', 'INTERESTED_IN_YOUR_COMPANY', 'HAVE_COMPANY_CONNECTIONS'];
const SENIORITY_LABELS: Record<string, string> = { '1': 'entry', '2': 'associate', '3': 'mid', '4': 'senior', '5': 'manager', '6': 'director', '7': 'vp', '8': 'cxo', '9': 'partner', '10': 'owner' };
const RECRUITER_SENIORITY: Record<string, string> = { entry: 'entry', associate: 'entry', mid: 'senior', senior: 'senior', manager: 'manager', director: 'director', vp: 'vp', cxo: 'cxo', partner: 'partner', owner: 'owner', training: 'training', unpaid: 'unpaid' };
const SALES_SENIORITY: Record<string, string> = { entry: 'entry_level', associate: 'entry_level', mid: 'senior', senior: 'senior', manager: 'experienced_manager', director: 'director', vp: 'vice_president', cxo: 'cxo', partner: 'owner/partner', owner: 'owner/partner', entry_level: 'entry_level', in_training: 'in_training', experienced_manager: 'experienced_manager', entry_level_manager: 'entry_level_manager', strategic: 'strategic', vice_president: 'vice_president', 'owner/partner': 'owner/partner' };

function isAiSnapshot(saved: Obj): boolean {
  return !saved.last_manual_edit && (Array.isArray(saved.skills_keywords) || Array.isArray(saved.location_keywords) || Boolean(entries(saved.role)[0]?.keywords));
}

/** Match the UI loader: generated XP is a local calculated range, never native tenure. */
export function continuousCalculatedExperienceRange(snapshot: unknown, api: ContinuousSearchApi = 'recruiter'): { min: number | null; max: number | null } {
  const saved = obj(snapshot);
  // A newly reviewed native range takes precedence, as in the interactive UI.
  // Older manual snapshots can contain stale generated aliases; keep ignoring them.
  if (!isAiSnapshot(saved) && (!saved.last_manual_edit || saved.native_experience_reviewed === true)
    && api !== 'classic' && range(saved.years_of_experience_min, saved.years_of_experience_max)) {
    return { min: null, max: null };
  }
  const calculated = isAiSnapshot(saved)
    ? range(saved.years_of_experience_min, saved.years_of_experience_max)
    : range(saved.calculated_experience_min, saved.calculated_experience_max);
  return { min: typeof calculated?.min === 'number' ? calculated.min : null,
    max: typeof calculated?.max === 'number' ? calculated.max : null };
}

export function buildContinuousSearchRequest(snapshot: unknown, api: ContinuousSearchApi): Obj {
  if (!['classic', 'recruiter', 'sales_navigator'].includes(api)) fail('filters_unsupported', 'Choisissez une licence disponible sur votre compte LinkedIn.');
  const saved = obj(snapshot);
  if (present(saved.category) && saved.category !== 'people') fail('filters_unsupported', 'L’agent recherche des personnes. Revoyez le type de recherche.');
  for (const key of ['open_to_work', 'exclude_consulting', 'changed_jobs', 'posted_on_linkedin', 'following_your_company', 'viewed_your_profile', 'viewed_your_profile_recently', 'past_colleague']) {
    if (saved[key] != null && typeof saved[key] !== 'boolean') fail('filters_invalid', 'Revoyez les interrupteurs dans les filtres de recherche.');
  }
  // Mirror the loader: AI XP is calculated XP; manual snapshots discard
  // legacy generated XP and keyword suggestions, not native request fields.
  const manual = Boolean(saved.last_manual_edit);
  const aiFormat = isAiSnapshot(saved);
  const out: Obj = { action: 'search', api, category: 'people' };
  const keywords = present(saved.keywords) ? booleanQuery(saved.keywords, 'Mots-clés', api) : '';
  if (keywords) out.keywords = keywords;

  const locations = facets(saved.location).map(v => ({ ...v, scope: scope(v.scope, api === 'recruiter' ? 'CURRENT_OR_OPEN_TO_RELOCATE' : 'CURRENT', LOCATION_SCOPES, 'Localisation') }));
  if (!locations.length && !manual && present(saved.location_keywords)) fail('filters_unresolved', 'Sélectionnez les lieux suggérés dans les filtres avant de démarrer l’agent.');
  if (locations.length) {
    if (api !== 'recruiter' && locations.some(v => v.priority === 'DOESNT_HAVE' || v.scope !== 'CURRENT')) fail('filters_unsupported', 'Cette licence ne conserve pas les exclusions ou la mobilité géographique. Revoyez les lieux et leur périmètre.');
    out.location = api === 'recruiter' ? locations : locations.map(v => v.id);
  }
  // After a manual edit, a radius without a selected location is inactive in
  // the sourcing UI and omitted by buildSearchParams. Keep the saved metadata.
  if (present(saved.location_within_area) && !(manual && !locations.length) && !locations.some(v => COUNTRY_IDS.has(v.id))) {
    if (!locations.length) fail('filters_unresolved', 'Sélectionnez un lieu avant de définir un rayon de recherche.');
    recruiterOnly(api, 'Rayon géographique');
    if (![10, 25, 35, 50, 75, 100].includes(saved.location_within_area as number)) fail('filters_invalid', 'Choisissez un rayon proposé dans les filtres de recherche.');
    out.location_within_area = saved.location_within_area;
  }

  for (const key of ['company', 'industry', 'school', 'function', 'past_company', 'company_location']) {
    const companyFacet = key === 'company' || key === 'past_company';
    const values = facets(saved[key], companyFacet || (key === 'school' && aiFormat) ? 'CAN_HAVE' : 'MUST_HAVE', companyFacet ? 'CAN_HAVE' : 'MUST_HAVE');
    if (!values.length) continue;
    if (key === 'company' && api === 'recruiter') {
      out.company = values.map(v => ({ ...v, scope: scope(v.scope, 'CURRENT_OR_PAST', COMPANY_SCOPES, 'Entreprise') }));
      continue;
    }
    if (values.some(v => present(v.scope) && !(key === 'past_company' && v.scope === 'PAST')
      && !(key === 'company' && v.scope === 'CURRENT'))) fail('filters_unsupported', 'La période du filtre « ' + key + ' » n’est pas prise en charge. Revoyez ce filtre.');
    if (key === 'school' && api === 'recruiter') {
      // CAN_HAVE school is scoring context in the sourcing UI. Required
      // schools use the provider's inclusive school selection.
      const selected = values.filter(v => v.priority !== 'CAN_HAVE');
      if (selected.length) out.school = selected.map(v => ({ id: v.id, priority: v.priority === 'DOESNT_HAVE' ? 'DOESNT_HAVE' : 'CAN_HAVE' }));
      continue;
    }
    if (key === 'company_location' && api !== 'sales_navigator') fail('filters_unsupported', 'Le lieu de l’entreprise nécessite Sales Navigator. Retirez ce filtre.');
    if (key === 'function' && api === 'classic') fail('filters_unsupported', 'Le département nécessite Recruiter ou Sales Navigator. Retirez ce filtre.');
    if (key === 'past_company' && api === 'recruiter') {
      out.past_company = values.map(v => ({ id: v.id, priority: v.priority }));
      continue;
    }
    if (companyFacet && values.filter(v => v.priority !== 'DOESNT_HAVE').length > 1 && values.some(v => v.priority === 'MUST_HAVE')) {
      fail('filters_unsupported', 'Cette licence recherche au moins une des entreprises sélectionnées. Choisissez « Au moins un » ou utilisez Recruiter pour les exiger toutes.');
    }
    if (key !== 'school' && !companyFacet && values.some(v => v.priority === 'CAN_HAVE')) fail('filters_unsupported', 'Cette licence ne conserve pas la priorité du filtre « ' + key + ' ». Revoyez sa priorité.');
    const include = values.filter(v => v.priority !== 'DOESNT_HAVE').map(v => v.id);
    const exclude = values.filter(v => v.priority === 'DOESNT_HAVE').map(v => v.id);
    if ((api === 'classic' || key === 'school' || (key === 'function' && api === 'recruiter')) && exclude.length) fail('filters_unsupported', 'Cette licence ne conserve pas l’exclusion « ' + key + ' ». Revoyez les filtres.');
    out[key] = key === 'school' || api === 'classic' || (key === 'function' && api === 'recruiter') ? include : { ...(include.length ? { include } : {}), ...(exclude.length ? { exclude } : {}) };
  }
  // Manual snapshots retain old AI industry suggestions, but the interactive
  // provider request only applies selected industry IDs, never these labels.
  if (!manual && !present(out.industry) && present(saved.industry_keywords)) fail('filters_unresolved', 'Sélectionnez les secteurs suggérés dans les filtres avant de démarrer l’agent.');

  const roles = entries(saved.role).map(v => ({ keywords: booleanQuery(v.keywords, 'Rôle', api), priority: priority(v.priority), scope: scope(v.scope, aiFormat ? 'CURRENT' : 'CURRENT_OR_PAST', ROLE_SCOPES, 'Rôle') }));
  if (roles.length) { recruiterOnly(api, 'Rôle et sa période'); out.role = roles; }
  const companies = entries(saved.company_keywords).map(v => ({ keywords: booleanQuery(v.keywords, 'Entreprise', api), priority: priority(v.priority ?? (aiFormat ? 'DOESNT_HAVE' : 'MUST_HAVE')), scope: scope(v.scope, 'CURRENT_OR_PAST', COMPANY_SCOPES, 'Entreprise') }));
  if (companies.length) {
    recruiterOnly(api, 'Entreprises par mots-clés');
    // One normalized array preserves selected IDs, keyword clauses and scopes.
    out.company = [...(Array.isArray(out.company) ? out.company : []), ...companies];
  }
  const skills = entries(saved.skills).map(v => {
    const id = typeof v.id === 'number' ? String(v.id) : text(v.id);
    const keyword = text(v.keywords) || text(v.name) || id;
    if (!keyword) fail('filters_invalid', 'Revoyez les compétences dans les filtres.');
    return /^\d+$/.test(id) && Number(id) > 0 ? { id, priority: priority(v.priority) } : { keywords: booleanQuery(keyword, 'Compétences', api), priority: priority(v.priority) };
  });
  if (skills.length) { recruiterOnly(api, 'Compétences'); out.skills = skills; }
  if (!manual && list(saved.skills_keywords).map(text).some(v => v && !keywords.toLowerCase().includes(v.toLowerCase()))) {
    fail('filters_unresolved', 'Intégrez les compétences suggérées dans une requête validée, puis enregistrez les filtres.');
  }

  for (const key of ['job_title', 'past_job_title']) {
    const values = entries(saved[key]);
    if (!values.length) continue;
    if (api === 'classic') fail('filters_unsupported', 'Le filtre d’intitulé « ' + key + ' » nécessite une autre licence. Revoyez les filtres.');
    out[key] = values.map(v => {
      const p = priority(v.priority);
      const period = scope(v.scope, key === 'past_job_title' ? 'PAST' : 'CURRENT_OR_PAST', ROLE_SCOPES, 'Intitulé');
      if (key === 'past_job_title' && period !== 'PAST') fail('filters_invalid', 'Les intitulés passés doivent porter sur la période passée.');
      if (api === 'sales_navigator' && (p === 'CAN_HAVE' || (present(v.scope) && period !== (key === 'past_job_title' ? 'PAST' : 'CURRENT')))) fail('filters_unsupported', 'Cette licence ne conserve pas la priorité ou la période de l’intitulé. Revoyez ce filtre.');
      return { id: facetId(v.id), priority: p, ...(api === 'recruiter' && key === 'job_title' ? { scope: period } : {}) };
    });
  }
  if (present(saved.network_distance)) out.network_distance = enumValues(saved.network_distance, [1, 2, 3], 'Relation');
  if (present(saved.profile_language)) {
    const languages = list(saved.profile_language);
    if (languages.some(v => typeof v !== 'string' || !/^[a-z]{2}$/.test(v))) fail('filters_invalid', 'Revoyez les langues du profil.');
    out.profile_language = [...new Set(languages)];
  }
  if (present(saved.seniority)) {
    if (api === 'classic') fail('filters_unsupported', 'La séniorité nécessite Recruiter ou Sales Navigator. Retirez ce filtre.');
    const mapping = api === 'recruiter' ? RECRUITER_SENIORITY : SALES_SENIORITY;
    const normalized = list(saved.seniority).map(v => mapping[SENIORITY_LABELS[String(v)] || text(v).toLowerCase()]);
    if (normalized.some(v => !v)) fail('filters_invalid', 'Choisissez les niveaux de séniorité proposés dans les filtres.');
    out.seniority = [...new Set(normalized)];
  }
  continuousCalculatedExperienceRange(saved, api);
  const experience = !aiFormat && (!manual || saved.native_experience_reviewed === true) ? range(saved.years_of_experience_min, saved.years_of_experience_max) : null;
  if (experience) {
    if (api === 'classic') fail('filters_unsupported', 'Cette licence ne filtre pas l’expérience totale. Revoyez ce filtre.');
    if (api === 'recruiter') out.years_of_experience = experience;
    else out.tenure = [experience];
  }
  for (const key of ['tenure_at_company', 'tenure_at_role']) {
    const duration = range(saved[key + '_min'], saved[key + '_max']);
    if (!duration) continue;
    if (api === 'classic') fail('filters_unsupported', 'L’ancienneté dans le poste ou l’entreprise nécessite une autre licence. Revoyez ce filtre.');
    if (api === 'sales_navigator' && key === 'tenure_at_role' && ((duration.min !== undefined && ![0, 1, 3, 6, 10].includes(duration.min as number)) || (duration.max !== undefined && ![1, 2, 5, 10].includes(duration.max as number)))) {
      fail('filters_unsupported', 'Choisissez une ancienneté au poste compatible avec Sales Navigator (minimum 0, 1, 3, 6 ou 10 ; maximum 1, 2, 5 ou 10 ans).');
    }
    out[key] = [duration];
  }

  if (present(saved.degree)) {
    recruiterOnly(api, 'Diplôme');
    const degrees = facets(saved.degree);
    if (degrees.some(v => Number(v.id) <= 10)) fail('filters_unresolved', 'Sélectionnez les diplômes dans les suggestions avant de démarrer l’agent.');
    out.degree = { include: degrees.filter(v => v.priority !== 'DOESNT_HAVE').map(v => v.id), exclude: degrees.filter(v => v.priority === 'DOESNT_HAVE').map(v => v.id) };
  }
  for (const key of ['spoken_languages', 'employment_type']) {
    if (!present(saved[key])) continue;
    recruiterOnly(api, key === 'spoken_languages' ? 'Langues parlées' : 'Type de contrat');
    if (!Array.isArray(saved[key])) fail('filters_invalid', 'Revoyez les langues parlées et le type de contrat.');
    out[key] = saved[key];
  }
  for (const [key, upper] of [['graduation_year', 3000], ['recently_joined', 36500]] as const) {
    const flat = range(saved[key + '_min'], saved[key + '_max'], upper);
    const direct = saved[key];
    if (!flat && !present(direct)) continue;
    recruiterOnly(api, key === 'graduation_year' ? 'Année de diplôme' : 'Inscription récente');
    const directRange = key === 'recently_joined' ? obj(list(direct)[0]) : obj(direct);
    if (flat && present(direct)) fail('filters_invalid', 'Harmonisez les plages d’année ou d’inscription récente, puis enregistrez les filtres.');
    const normalized = flat || range(directRange.min, directRange.max, upper);
    if (!normalized) fail('filters_invalid', 'Revoyez le filtre d’année ou d’inscription récente.');
    if (key === 'recently_joined' && present(direct) && list(direct).length > 1) fail('filters_unsupported', 'Validez une seule plage d’inscription récente pour l’agent.');
    out[key] = key === 'recently_joined' ? [normalized] : normalized;
  }
  if (present(saved.hide_previously_viewed)) {
    recruiterOnly(api, 'Profils déjà consultés');
    const days = typeof saved.hide_previously_viewed === 'number' ? saved.hide_previously_viewed : obj(saved.hide_previously_viewed).timespan;
    if (typeof days !== 'number' || !Number.isInteger(days) || days <= 0 || days > 36500) fail('filters_invalid', 'Choisissez une durée valide pour les profils déjà consultés.');
    out.hide_previously_viewed = { timespan: days };
  }
  const spotlights = [...list(saved.spotlights), ...(present(saved.spotlight) ? [saved.spotlight] : []), ...(saved.open_to_work === true ? ['OPEN_TO_WORK'] : [])];
  if (spotlights.length) { recruiterOnly(api, 'À l’écoute et signaux de recrutement'); out.spotlights = enumValues(spotlights, SPOTLIGHTS, 'Signaux de recrutement'); }
  if (present(saved.hiring_project)) { recruiterOnly(api, 'Projet de recrutement'); out.hiring_project = identifier(saved.hiring_project); }
  if (present(saved.groups)) {
    if (api === 'classic') fail('filters_unsupported', 'Les groupes nécessitent Recruiter ou Sales Navigator. Retirez ce filtre.');
    out.groups = entries(saved.groups).map(v => facetId(v.id));
  }
  if (present(saved.company_headcount)) {
    if (api === 'classic') fail('filters_unsupported', 'La taille d’entreprise nécessite une autre licence. Retirez ce filtre.');
    out.company_headcount = enumValues(saved.company_headcount, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], 'Taille d’entreprise');
  }
  if (present(saved.company_type)) {
    if (api !== 'sales_navigator') fail('filters_unsupported', 'Le type d’entreprise nécessite Sales Navigator. Retirez ce filtre.');
    out.company_type = enumValues(saved.company_type, ['C', 'O', 'E', 'S', 'P', 'G', 'D', 'public_company', 'privately_held', 'non_profit', 'educational_institution', 'partnership', 'self_employed', 'government_agency'], 'Type d’entreprise');
  }
  if (present(saved.open_to)) {
    if (api !== 'classic') fail('filters_unsupported', 'Le filtre « Open to » nécessite LinkedIn Classic. Retirez ce filtre.');
    out.open_to = enumValues(saved.open_to, ['proBono', 'boardMember'], 'Open to');
  }
  const advanced = { ...obj(saved.advanced_keywords) };
  for (const [ui, field] of [['first_name', 'first_name'], ['last_name', 'last_name'], ['title_keywords', 'title']]) {
    if (!present(saved[ui])) continue;
    if (present(advanced[field]) && advanced[field] !== saved[ui]) fail('filters_invalid', 'Harmonisez les mots-clés avancés dans les filtres.');
    advanced[field] = saved[ui];
  }
  if (Object.keys(advanced).length) {
    if (api !== 'classic') fail('filters_unsupported', 'Les mots-clés avancés nécessitent LinkedIn Classic. Revoyez ce filtre.');
    if (Object.keys(advanced).some(k => !['first_name', 'last_name', 'title', 'company', 'school'].includes(k))) fail('filters_invalid', 'Revoyez les mots-clés avancés.');
    out.advanced_keywords = Object.fromEntries(Object.entries(advanced).map(([key, value]) => [key, booleanQuery(value, 'Mots-clés avancés', api)]));
  }

  // These fields are stripped by the current handler, override the request,
  // or need browser post-filtering. Do not silently widen an unattended hunt.
  const unsupported: Record<string, string> = {
    talent_pool: 'Vivier', company_revenue: 'Chiffre d’affaires', tags: 'Tags sélectionnés',
    company_category: 'Catégorie d’entreprise', saved_search_id: 'Recherche enregistrée', recent_search_id: 'Recherche récente',
    years_of_experience: 'Expérience native', tenure: 'Expérience native', tenure_at_role: 'Ancienneté au poste', tenure_at_company: 'Ancienneté dans l’entreprise',
    tenure_in_position: 'Ancienneté au poste', tenure_in_company: 'Ancienneté dans l’entreprise',
    changed_jobs: 'Changement de poste', posted_on_linkedin: 'Publication récente', following_your_company: 'Abonnés à l’entreprise',
    viewed_your_profile: 'Visite du profil', viewed_your_profile_recently: 'Visite du profil', past_colleague: 'Ancien collègue',
  };
  for (const [key, label] of Object.entries(unsupported)) {
    if (present(saved[key]) && !(key === 'company_category' && saved[key] === 'all')) fail('filters_unsupported', 'Le filtre « ' + label + ' » ne peut pas être appliqué par l’agent. Retirez-le et enregistrez les filtres.');
  }
  for (const key of Object.keys(saved).filter(k => k.startsWith('db_'))) {
    if (present(saved[key])) fail('filters_unsupported', 'Les filtres Base Konekt ne sont pas compatibles avec cet agent LinkedIn. Retirez-les et enregistrez les filtres.');
  }
  if (saved.exclude_consulting === true) {
    if (api === 'classic') fail('filters_unsupported', 'L’exclusion du conseil nécessite une autre licence. Retirez ce filtre.');
    const industry = obj(out.industry);
    out.industry = { ...industry, exclude: [...new Set([...list(industry.exclude), '96', '4', '104'])] };
  }
  const activities = entries(saved.recruiting_activity).map(v => {
    if (!['messages', 'tags', 'notes', 'projects', 'resumes', 'reviews'].includes(text(v.id))) fail('filters_invalid', 'Revoyez les activités de recrutement.');
    const days = v.timespan;
    if (days != null && (typeof days !== 'number' || !Number.isInteger(days) || days <= 0 || days > 36500)) fail('filters_invalid', 'Revoyez la période des activités de recrutement.');
    return { id: text(v.id), priority: priority(v.priority), ...(days != null ? { timespan: days } : {}) };
  });
  for (const [key, id, positive, negative] of [['activity_messages', 'messages', 'with_message', 'without_message'], ['activity_notes', 'notes', 'with_note', 'without_note']]) {
    if (!present(saved[key])) continue;
    if (![positive, negative].includes(String(saved[key]))) fail('filters_invalid', 'Revoyez les activités de recrutement.');
    const days = saved[key + '_days'] ?? 3650;
    if (typeof days !== 'number' || !Number.isInteger(days) || days <= 0 || days > 36500) fail('filters_invalid', 'Revoyez la période des activités de recrutement.');
    activities.push({ id, priority: saved[key] === positive ? 'MUST_HAVE' : 'DOESNT_HAVE', timespan: days });
  }
  if (activities.length) { recruiterOnly(api, 'Activités de recrutement'); out.recruiting_activity = activities; }
  if (Object.keys(out).length === 3) fail('filters_invalid', 'Validez au moins un filtre de recherche avant de démarrer l’agent.');
  // The UI restores the INITIAL_FILTERS contact exclusion unless cleared.
  if (api === 'recruiter' && !Object.hasOwn(saved, 'activity_messages') && !activities.some(v => v.id === 'messages')) {
    out.recruiting_activity = [...activities, { id: 'messages', priority: 'DOESNT_HAVE', timespan: 90 }];
  }
  return out;
}
