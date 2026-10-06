/**
 * Affinage des filtres par phrase — client de l'edge function `nl-filter-edit`.
 *
 * Envoie les filtres COURANTS (résumé compact) + l'instruction, reçoit un
 * diff { set, remove, note } et l'applique déterministiquement sur le
 * LinkedInFiltersState. C'est ce qui permet « retire Lyon » ou « ajoute
 * anglais courant » — impossible avec une régénération complète du brief.
 */
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { invokeUnipile } from '@/lib/invokeUnipile';
import {
  LinkedInFiltersState,
  RoleFilter,
  CompanyKeywordFilter,
  LocationFilterItem,
} from '@/components/outreach/types';

interface EditOps {
  set?: {
    keywords?: string | null;
    role?: Array<{ keywords: string; priority: string; scope: string }> | null;
    seniority?: string[] | null;
    years_of_experience_min?: number | null;
    years_of_experience_max?: number | null;
    tenure_at_role_min?: number | null;
    tenure_at_role_max?: number | null;
    skills_keywords?: string[] | null;
    location_keywords?: string[] | null;
    location_within_area?: number | null;
    company_keywords?: Array<{ keywords: string; priority: string; scope: string }> | null;
    industry_keywords?: string[] | null;
    company_headcount?: string[] | null;
    school_keywords?: string[] | null;
    profile_language?: string[] | null;
    open_to_work?: boolean | null;
    contacted_filter?: 'without_message' | 'with_message' | null;
    contacted_days?: number | null;
  };
  remove?: {
    role_keywords?: string[];
    location_names?: string[];
    skills?: string[];
    company_keywords?: string[];
    industry_names?: string[];
    school_names?: string[];
    company_headcount?: string[];
    seniority?: string[];
    profile_language?: string[];
    keywords_clear?: boolean;
    tenure_at_role_clear?: boolean;
    radius_clear?: boolean;
    contacted_clear?: boolean;
  };
  note?: string;
}

const HEADCOUNT_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const RADIUS_VALUES = [10, 25, 35, 50, 75, 100];

const norm = (s: string) => s.trim().toLowerCase();

export interface NlFilterEditResult {
  next: LinkedInFiltersState;
  note: string | null;
  changed: boolean;
}

export async function nlFilterEdit(params: {
  instruction: string;
  filters: LinkedInFiltersState;
  accountId: string | null;
  searchSource: 'linkedin' | 'database';
}): Promise<NlFilterEditResult> {
  const { instruction, filters, accountId, searchSource } = params;

  // Résumé compact des filtres courants — assez pour éditer, léger en tokens.
  const current_filters = {
    keywords: filters.keywords || undefined,
    role: filters.role.map(r => ({ keywords: r.keywords, priority: r.priority, scope: r.scope })),
    location: filters.location.map(l => l.name),
    location_radius_miles: filters.location_within_area,
    experience_min: filters.calculated_experience_min,
    experience_max: filters.calculated_experience_max,
    tenure_at_role_min: filters.tenure_at_role_min,
    tenure_at_role_max: filters.tenure_at_role_max,
    skills: [...filters.skills.map(s => s.name), ...(filters.skills_keywords || [])],
    company_keywords: filters.company_keywords.map(c => ({ keywords: c.keywords, priority: c.priority, scope: c.scope })),
    industry: filters.industry.map(i => i.name),
    company_headcount: filters.company_headcount,
    school: filters.school.map(s => s.name),
    seniority: filters.seniority,
    profile_language: filters.profile_language,
    open_to_work: filters.open_to_work,
    contacted_filter: filters.activity_messages,
    contacted_days: filters.activity_messages_days,
  };

  const { data, error } = await invokeWithCredits<{ success?: boolean; ops?: EditOps; error?: string }>(
    'nl-filter-edit',
    'filter_generation',
    { instruction, current_filters },
  );
  if (error) throw error;
  if (!data?.success || !data.ops) throw new Error(data?.error || "Réponse invalide de l'API");

  const ops = data.ops;
  let next: LinkedInFiltersState = { ...filters };
  let changed = false;

  /* ── remove d'abord (l'instruction « remplace X par Y » = remove X + set Y) ── */
  const rm = ops.remove || {};
  if (rm.role_keywords?.length) {
    const targets = rm.role_keywords.map(norm);
    const role = next.role.filter(r => !targets.includes(norm(r.keywords)));
    const job_title = next.job_title.filter(j => !targets.includes(norm(j.name)));
    if (role.length !== next.role.length || job_title.length !== next.job_title.length) {
      next = { ...next, role, job_title }; changed = true;
    }
  }
  if (rm.location_names?.length) {
    const targets = rm.location_names.map(norm);
    const location = next.location.filter(l => !targets.some(t => norm(l.name).includes(t) || t.includes(norm(l.name))));
    if (location.length !== next.location.length) { next = { ...next, location }; changed = true; }
  }
  if (rm.skills?.length) {
    const targets = rm.skills.map(norm);
    const skills = next.skills.filter(s => !targets.includes(norm(s.name)));
    const skills_keywords = (next.skills_keywords || []).filter(s => !targets.includes(norm(s)));
    if (skills.length !== next.skills.length || skills_keywords.length !== (next.skills_keywords || []).length) {
      next = { ...next, skills, skills_keywords }; changed = true;
    }
  }
  if (rm.company_keywords?.length) {
    const targets = rm.company_keywords.map(norm);
    const company_keywords = next.company_keywords.filter(c => !targets.includes(norm(c.keywords)));
    const company = next.company.filter(c => !targets.includes(norm(c.name)));
    if (company_keywords.length !== next.company_keywords.length || company.length !== next.company.length) {
      next = { ...next, company_keywords, company }; changed = true;
    }
  }
  if (rm.seniority?.length) {
    const seniority = next.seniority.filter(s => !rm.seniority!.includes(s));
    if (seniority.length !== next.seniority.length) { next = { ...next, seniority }; changed = true; }
  }
  if (rm.profile_language?.length) {
    const profile_language = next.profile_language.filter(l => !rm.profile_language!.includes(l));
    if (profile_language.length !== next.profile_language.length) { next = { ...next, profile_language }; changed = true; }
  }
  if (rm.industry_names?.length) {
    const targets = rm.industry_names.map(norm);
    const industry = next.industry.filter(i => !targets.some(t => norm(i.name).includes(t) || t.includes(norm(i.name))));
    if (industry.length !== next.industry.length) { next = { ...next, industry }; changed = true; }
  }
  if (rm.school_names?.length) {
    const targets = rm.school_names.map(norm);
    const school = next.school.filter(s => !targets.some(t => norm(s.name).includes(t) || t.includes(norm(s.name))));
    if (school.length !== next.school.length) { next = { ...next, school }; changed = true; }
  }
  if (rm.company_headcount?.length) {
    const company_headcount = next.company_headcount.filter(h => !rm.company_headcount!.includes(h));
    if (company_headcount.length !== next.company_headcount.length) { next = { ...next, company_headcount }; changed = true; }
  }
  if (rm.tenure_at_role_clear && (next.tenure_at_role_min !== null || next.tenure_at_role_max !== null)) {
    next = { ...next, tenure_at_role_min: null, tenure_at_role_max: null }; changed = true;
  }
  if (rm.radius_clear && next.location_within_area !== null) {
    next = { ...next, location_within_area: null }; changed = true;
  }
  if (rm.contacted_clear && next.activity_messages) {
    next = { ...next, activity_messages: null, activity_messages_days: null }; changed = true;
  }
  if (rm.keywords_clear && next.keywords) {
    next = { ...next, keywords: '' }; changed = true;
  }

  /* ── set : ajouts (dédupliqués) ; keywords remplace ── */
  const st = ops.set || {};
  if (typeof st.keywords === 'string' && st.keywords.trim() && st.keywords !== next.keywords) {
    next = { ...next, keywords: st.keywords }; changed = true;
  }
  if (st.role?.length) {
    const existing = new Set(next.role.map(r => norm(r.keywords)));
    const added = st.role
      .filter(r => r.keywords?.trim() && !existing.has(norm(r.keywords)))
      .map(r => ({
        keywords: r.keywords,
        priority: (['MUST_HAVE', 'CAN_HAVE', 'DOESNT_HAVE'].includes(r.priority) ? r.priority : 'CAN_HAVE') as RoleFilter['priority'],
        scope: (['CURRENT', 'PAST', 'CURRENT_OR_PAST'].includes(r.scope) ? r.scope : 'CURRENT_OR_PAST') as RoleFilter['scope'],
      }));
    if (added.length) { next = { ...next, role: [...next.role, ...added] }; changed = true; }
  }
  if (st.skills_keywords?.length) {
    const existing = new Set([...next.skills.map(s => norm(s.name)), ...(next.skills_keywords || []).map(norm)]);
    const added = st.skills_keywords.filter(s => s?.trim() && !existing.has(norm(s)));
    if (added.length) { next = { ...next, skills_keywords: [...(next.skills_keywords || []), ...added] }; changed = true; }
  }
  if (st.seniority?.length) {
    const added = st.seniority.filter(s => !next.seniority.includes(s));
    if (added.length) { next = { ...next, seniority: [...next.seniority, ...added] }; changed = true; }
  }
  if (st.profile_language?.length) {
    const added = st.profile_language.filter(l => !next.profile_language.includes(l));
    if (added.length) { next = { ...next, profile_language: [...next.profile_language, ...added] }; changed = true; }
  }
  if (typeof st.years_of_experience_min === 'number' || typeof st.years_of_experience_max === 'number') {
    const min = typeof st.years_of_experience_min === 'number' ? st.years_of_experience_min : next.calculated_experience_min;
    const max = typeof st.years_of_experience_max === 'number' ? st.years_of_experience_max : next.calculated_experience_max;
    if (min !== next.calculated_experience_min || max !== next.calculated_experience_max) {
      next = { ...next, calculated_experience_min: min, calculated_experience_max: max, years_of_experience_min: min, years_of_experience_max: max };
      changed = true;
    }
  }
  if (typeof st.tenure_at_role_min === 'number' || typeof st.tenure_at_role_max === 'number') {
    const min = typeof st.tenure_at_role_min === 'number' ? st.tenure_at_role_min : next.tenure_at_role_min;
    const max = typeof st.tenure_at_role_max === 'number' ? st.tenure_at_role_max : next.tenure_at_role_max;
    if (min !== next.tenure_at_role_min || max !== next.tenure_at_role_max) {
      next = { ...next, tenure_at_role_min: min, tenure_at_role_max: max }; changed = true;
    }
  }
  if (typeof st.location_within_area === 'number') {
    // Valeurs fixes LinkedIn : arrondi à la plus proche
    const nearest = RADIUS_VALUES.reduce((a, b) => Math.abs(b - st.location_within_area!) < Math.abs(a - st.location_within_area!) ? b : a);
    if (nearest !== next.location_within_area) { next = { ...next, location_within_area: nearest }; changed = true; }
  }
  if (st.company_headcount?.length) {
    const added = st.company_headcount.filter(h => HEADCOUNT_CODES.includes(h) && !next.company_headcount.includes(h));
    if (added.length) { next = { ...next, company_headcount: [...next.company_headcount, ...added] }; changed = true; }
  }
  if (st.contacted_filter === 'without_message' || st.contacted_filter === 'with_message') {
    const days = typeof st.contacted_days === 'number' ? st.contacted_days : next.activity_messages_days;
    if (st.contacted_filter !== next.activity_messages || days !== next.activity_messages_days) {
      next = { ...next, activity_messages: st.contacted_filter, activity_messages_days: days }; changed = true;
    }
  } else if (typeof st.contacted_days === 'number' && next.activity_messages && st.contacted_days !== next.activity_messages_days) {
    next = { ...next, activity_messages_days: st.contacted_days }; changed = true;
  }
  if (st.company_keywords?.length) {
    const existing = new Set(next.company_keywords.map(c => norm(c.keywords)));
    const added = st.company_keywords
      .filter(c => c.keywords?.trim() && !existing.has(norm(c.keywords)))
      .map(c => ({
        keywords: c.keywords,
        priority: (['MUST_HAVE', 'CAN_HAVE', 'DOESNT_HAVE'].includes(c.priority) ? c.priority : 'CAN_HAVE') as CompanyKeywordFilter['priority'],
        scope: (['CURRENT', 'PAST', 'CURRENT_OR_PAST', 'PAST_NOT_CURRENT'].includes(c.scope) ? c.scope : 'CURRENT') as CompanyKeywordFilter['scope'],
      }));
    if (added.length) { next = { ...next, company_keywords: [...next.company_keywords, ...added] }; changed = true; }
  }
  if (typeof st.open_to_work === 'boolean' && st.open_to_work !== next.open_to_work) {
    next = { ...next, open_to_work: st.open_to_work }; changed = true;
  }

  // Facettes à IDs LinkedIn (lieu, secteur, école) : résolution autocomplete
  // si compte connecté, sinon nom brut (Base Konekt).
  const resolveParam = async (type: 'LOCATION' | 'INDUSTRY' | 'SCHOOL', kw: string): Promise<{ id: string; name: string } | null> => {
    if (searchSource === 'linkedin' && accountId) {
      try {
        const { data: paramData } = await invokeUnipile({
          body: { action: 'get_parameters', account_id: accountId, type, keywords: kw, service: 'RECRUITER' },
        });
        const items = Array.isArray(paramData?.items) ? (paramData.items as any[]) : [];
        const n = norm(kw);
        const best = items.find((it: any) => norm(String(it.title || '')) === n)
          || items.find((it: any) => norm(String(it.title || '')).includes(n)) || items[0];
        return best?.id && best?.title ? { id: String(best.id), name: String(best.title) } : null;
      } catch (e) {
        console.warn('[nlFilterEdit] resolve failed:', type, kw, e);
        return null;
      }
    }
    return { id: kw, name: kw };
  };

  if (st.location_keywords?.length) {
    const existingNames = new Set(next.location.map(l => norm(l.name)));
    for (const kw of st.location_keywords.slice(0, 3)) {
      if (!kw?.trim() || existingNames.has(norm(kw))) continue;
      const it = await resolveParam('LOCATION', kw);
      if (it && !next.location.some(l => l.id === it.id)) {
        const item: LocationFilterItem = { ...it, priority: 'MUST_HAVE', scope: 'CURRENT_OR_OPEN_TO_RELOCATE' };
        next = { ...next, location: [...next.location, item] };
        changed = true;
      }
    }
  }

  if (st.industry_keywords?.length) {
    const existingNames = new Set(next.industry.map(i => norm(i.name)));
    for (const kw of st.industry_keywords.slice(0, 3)) {
      if (!kw?.trim() || existingNames.has(norm(kw))) continue;
      const it = await resolveParam('INDUSTRY', kw);
      if (it && !next.industry.some(i => i.id === it.id)) {
        next = { ...next, industry: [...next.industry, it] };
        changed = true;
      }
    }
  }

  if (st.school_keywords?.length) {
    const existingNames = new Set(next.school.map(s => norm(s.name)));
    for (const kw of st.school_keywords.slice(0, 5)) {
      if (!kw?.trim() || existingNames.has(norm(kw))) continue;
      const it = await resolveParam('SCHOOL', kw);
      if (it && !next.school.some(s => s.id === it.id)) {
        next = { ...next, school: [...next.school, { ...it, priority: 'MUST_HAVE' }] };
        changed = true;
      }
    }
  }

  return { next, note: ops.note || null, changed };
}
