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
    skills_keywords?: string[] | null;
    location_keywords?: string[] | null;
    company_keywords?: Array<{ keywords: string; priority: string; scope: string }> | null;
    profile_language?: string[] | null;
    open_to_work?: boolean | null;
  };
  remove?: {
    role_keywords?: string[];
    location_names?: string[];
    skills?: string[];
    company_keywords?: string[];
    seniority?: string[];
    profile_language?: string[];
    keywords_clear?: boolean;
  };
  note?: string;
}

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
    role: filters.role.map(r => ({ keywords: r.keywords, priority: r.priority })),
    location: filters.location.map(l => l.name),
    experience_min: filters.calculated_experience_min,
    experience_max: filters.calculated_experience_max,
    skills: [...filters.skills.map(s => s.name), ...(filters.skills_keywords || [])],
    company_keywords: filters.company_keywords.map(c => ({ keywords: c.keywords, priority: c.priority })),
    seniority: filters.seniority,
    profile_language: filters.profile_language,
    open_to_work: filters.open_to_work,
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
        priority: (r.priority === 'MUST_HAVE' ? 'MUST_HAVE' : 'CAN_HAVE') as RoleFilter['priority'],
        scope: (r.scope === 'CURRENT' ? 'CURRENT' : 'CURRENT_OR_PAST') as RoleFilter['scope'],
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

  // Localisation : résolution geo ID LinkedIn si possible, sinon nom brut (Base Konekt)
  if (st.location_keywords?.length) {
    const existingNames = new Set(next.location.map(l => norm(l.name)));
    for (const kw of st.location_keywords.slice(0, 3)) {
      if (!kw?.trim() || existingNames.has(norm(kw))) continue;
      let item: LocationFilterItem | null = null;
      if (searchSource === 'linkedin' && accountId) {
        try {
          const { data: paramData } = await invokeUnipile({
            body: { action: 'get_parameters', account_id: accountId, type: 'LOCATION', keywords: kw, service: 'RECRUITER' },
          });
          const items = Array.isArray(paramData?.items) ? (paramData.items as any[]) : [];
          const n = norm(kw);
          const best = items.find((it: any) => norm(String(it.title || '')) === n)
            || items.find((it: any) => norm(String(it.title || '')).includes(n)) || items[0];
          if (best?.id && best?.title) {
            item = { id: String(best.id), name: String(best.title), priority: 'MUST_HAVE', scope: 'CURRENT_OR_OPEN_TO_RELOCATE' };
          }
        } catch (e) {
          console.warn('[nlFilterEdit] location resolve failed:', kw, e);
        }
      } else {
        item = { id: kw, name: kw, priority: 'MUST_HAVE', scope: 'CURRENT_OR_OPEN_TO_RELOCATE' };
      }
      if (item && !next.location.some(l => l.id === item!.id)) {
        next = { ...next, location: [...next.location, item] };
        changed = true;
      }
    }
  }

  return { next, note: ops.note || null, changed };
}
