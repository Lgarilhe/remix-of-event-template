import { INITIAL_FILTERS, type LinkedInProfile } from '@/components/outreach/types';
import { mapGeneratedFilters, type GeneratedFilters } from '@/components/outreach/search/generateFiltersFromJob';
import { buildSearchParams } from '@/hooks/useLinkedInSearchActions';
import { buildProfileData } from '@/hooks/useLinkedInScoring';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { splitRoleKeywords } from './brief';

/**
 * Première recherche de l'onboarding : les filtres enregistrés sur la mission,
 * une seule page de résultats sur le compte LinkedIn de l'utilisateur, puis un
 * scoring facultatif avec le même moteur que dans la mission.
 */

export type LinkedInLicense = 'recruiter' | 'sales_navigator' | 'classic';

export interface LinkedInSubscriptions {
  classic?: boolean;
  recruiter?: boolean;
  sales_navigator?: boolean;
}

/** Licence la plus riche du compte : Recruiter, puis Sales Navigator, puis Classic. */
export function licenseOf(subscriptions: LinkedInSubscriptions | null | undefined): LinkedInLicense {
  if (subscriptions?.recruiter) return 'recruiter';
  if (subscriptions?.sales_navigator) return 'sales_navigator';
  return 'classic';
}

export const LICENSE_LABEL: Record<LinkedInLicense, string> = {
  recruiter: 'LinkedIn Recruiter',
  sales_navigator: 'Sales Navigator',
  classic: 'LinkedIn Classic',
};

export interface PreviewCandidate {
  id: string;
  name: string;
  firstName: string;
  headline: string;
  role: string | null;
  company: string | null;
  location: string | null;
  photo: string | null;
  initials: string;
  profileUrl: string | null;
  /** Profil normalisé tel que l'attendent le scoring et la rédaction de message. */
  profileData: ReturnType<typeof buildProfileData>;
}

export function toPreviewCandidate(profile: LinkedInProfile): PreviewCandidate {
  const data = buildProfileData(profile);
  const name = (data.name || profile.name || '').trim() || 'Profil LinkedIn';
  const parts = name.split(/\s+/).filter(Boolean);
  const first = profile.first_name?.trim() || parts[0] || name;
  const initials = `${first.charAt(0)}${(profile.last_name?.trim() || parts[parts.length - 1] || '').charAt(0)}`.toUpperCase();
  return {
    id: String(data.id),
    name,
    firstName: first,
    headline: (profile.headline ?? '').trim(),
    role: data.currentRole?.trim() || null,
    company: data.currentCompany?.trim() || null,
    location: profile.location?.trim() || null,
    photo: profile.profile_picture_url || profile.profile_picture_url_large || null,
    initials: initials || '?',
    profileUrl: data.profileUrl ?? null,
    profileData: data,
  };
}

export class FirstSearchError extends Error {
  constructor(message: string, readonly kind: 'quota' | 'rate' | 'account' | 'network' | 'other') {
    super(message);
  }
}

/** Message français pour une erreur de la recherche, jamais le texte technique du prestataire. */
function searchErrorFrom(data: { error?: string; errorType?: string }): FirstSearchError {
  const type = (data.errorType ?? '').toUpperCase();
  if (type === 'QUOTA') return new FirstSearchError("Votre quota de recherches du jour est atteint. Il se renouvelle demain.", 'quota');
  if (type === 'RATE_LIMIT') return new FirstSearchError('LinkedIn demande de patienter quelques secondes avant de relancer.', 'rate');
  if (type === 'ACCOUNT_NOT_LINKED') return new FirstSearchError("Ce compte LinkedIn n'est pas encore rattaché à votre espace.", 'account');
  return new FirstSearchError(data.error || "La recherche n'a pas abouti. Réessayez dans un instant.", 'other');
}

/** Titres visés, en « OU » entre guillemets : le seul moyen de garder le poste sur Classic et Sales Navigator, où le filtre de poste est ignoré. */
function titleClause(filters: GeneratedFilters): string {
  const titles = splitRoleKeywords(filters.role?.[0]?.keywords).slice(0, 4);
  if (titles.length === 0) return '';
  return `(${titles.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')})`;
}

export async function runFirstSearch(input: {
  filters: GeneratedFilters;
  accountId: string;
  subscriptions?: LinkedInSubscriptions | null;
  limit?: number;
}): Promise<{ candidates: PreviewCandidate[]; total: number | null; license: LinkedInLicense }> {
  const license = licenseOf(input.subscriptions);
  const { update } = await mapGeneratedFilters(input.filters, { accountId: input.accountId });
  const state = { ...INITIAL_FILTERS, ...update, api: license };

  if (license !== 'recruiter') {
    const clause = titleClause(input.filters);
    if (clause) state.keywords = state.keywords ? `${clause} AND (${state.keywords})` : clause;
  }

  const params = buildSearchParams(state, input.accountId);
  const { data } = await invokeUnipile({ body: { ...params, limit: input.limit ?? 10 } });
  if (!data?.success) throw searchErrorFrom(data ?? {});

  const results = Array.isArray(data.results) ? (data.results as LinkedInProfile[]) : [];
  const total = typeof data.total === 'number' && Number.isFinite(data.total) ? data.total : null;
  return { candidates: results.map(toPreviewCandidate), total, license };
}

export interface PreviewScore {
  id: string;
  score: number;
  recommendation: string | null;
  summary: string | null;
  strengths: string[];
}

type Raw = Record<string, unknown>;
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []);

/** Lit les résultats de `score-profile-job` : un score par profil, ou rien quand le profil n'a pas pu être noté. */
export function parseScores(data: unknown): PreviewScore[] {
  const d = (data && typeof data === 'object' ? data : {}) as Raw;
  const results = Array.isArray(d.results) ? (d.results as Raw[]) : d.result ? [d.result as Raw] : [];
  const out: PreviewScore[] = [];
  for (const r of results) {
    const id = typeof r.profile_id === 'string' ? r.profile_id : typeof r.profileId === 'string' ? r.profileId : typeof r.id === 'string' ? r.id : null;
    const score = typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : null;
    if (!id || score === null || r.skipReason) continue;
    out.push({
      id,
      score,
      recommendation: typeof r.recommendation === 'string' ? r.recommendation : null,
      summary: typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim() : null,
      strengths: strList(r.strengths).slice(0, 2),
    });
  }
  return out;
}

export interface ScoringJob {
  /** `project:<id de la mission>` : le scoring refuse un identifiant de mission d'une autre organisation. */
  id: string;
  title: string;
  client: { name: string; sector: string } | null;
  skills: string[];
  description: string;
  location: string | null;
  xpMin: number | null;
  xpMax: number | null;
  mustHave: string;
}

/** Note les profils avec le moteur de la mission. Rend une liste vide quand le scoring n'est pas disponible (crédits, panne) : l'aperçu se passe très bien de scores. */
export async function scorePreview(candidates: PreviewCandidate[], job: ScoringJob): Promise<PreviewScore[]> {
  if (candidates.length === 0) return [];
  const { data, error } = await invokeWithCredits(
    'score-profile-job',
    'scoring',
    { profiles: candidates.map((c) => c.profileData), job },
    { description: 'Aperçu des premiers candidats' },
  );
  if (error) {
    if (!isInsufficientCreditsError(error)) console.warn('[onboarding] scoring indisponible :', error.message);
    return [];
  }
  return parseScores(data);
}
