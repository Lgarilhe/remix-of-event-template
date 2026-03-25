import { LinkedInProfile, LinkedInFiltersState } from '@/components/outreach/types';

export interface ExtractedTraits {
  roleTitles: string[];
  skills: string[];
  location: string | null;
  experienceYears: number | null;
  industry: string | null;
  currentCompany: string | null;
  keywords: string;
}

/**
 * Extract key traits from a LinkedIn profile to use as search filters.
 * Pure function — no API calls, no side effects.
 */
export function extractTraitsFromProfile(profile: LinkedInProfile): ExtractedTraits {
  const roleTitles: string[] = [];
  const currentPos = (profile as any).current_positions?.[0] || (profile as any).work_experience?.find((w: any) => w.current);
  if (currentPos?.role) {
    roleTitles.push(currentPos.role);
  }
  if (roleTitles.length === 0 && profile.headline) {
    const headlineRole = profile.headline.split(/[|@\-–—]|chez |at /i)[0].trim();
    if (headlineRole && headlineRole.length < 60) {
      roleTitles.push(headlineRole);
    }
  }

  const skillSet = new Set<string>();
  ((profile as any).skills || []).forEach((s: any) => {
    const name = typeof s === 'string' ? s : s.name;
    if (name) skillSet.add(name);
  });
  const positionSkills = currentPos?.skills;
  if (Array.isArray(positionSkills)) {
    positionSkills.forEach((s: any) => {
      const name = typeof s === 'string' ? s : s?.name;
      if (name) skillSet.add(name);
    });
  }
  const skills = Array.from(skillSet).slice(0, 10);

  const location = profile.location || currentPos?.location || null;

  let experienceYears: number | null = null;
  const allPositions = [
    ...((profile as any).work_experience || []),
    ...((profile as any).current_positions || []),
    ...((profile as any).past_positions || []),
  ];
  if (allPositions.length > 0) {
    let earliestYear = new Date().getFullYear();
    allPositions.forEach((pos: any) => {
      const start = pos.start;
      let year: number | null = null;
      if (typeof start === 'object' && start?.year) {
        year = start.year;
      } else if (typeof start === 'string') {
        const parsed = parseInt(start.substring(0, 4), 10);
        if (!isNaN(parsed) && parsed > 1970) year = parsed;
      }
      if (year && year < earliestYear) earliestYear = year;
    });
    const years = new Date().getFullYear() - earliestYear;
    if (years > 0 && years < 50) experienceYears = years;
  }

  const industry = (typeof currentPos?.industry === 'string' ? currentPos.industry : null)
    || (profile as any).industry || null;

  const currentCompany = currentPos?.company || null;

  const keywordParts: string[] = [];
  if (roleTitles[0]) {
    const cleanRole = roleTitles[0]
      .replace(/\s*(chez|at|@)\s*.+$/i, '')
      .replace(/\s*(senior|junior|lead|staff|principal|head of)\s*/gi, '')
      .trim();
    if (cleanRole) keywordParts.push(`"${cleanRole}"`);
  }
  if (skills.length > 0) {
    const topSkills = skills.slice(0, 3).map(s => `"${s}"`).join(' OR ');
    keywordParts.push(`(${topSkills})`);
  }
  const keywords = keywordParts.join(' AND ');

  return { roleTitles, skills, location, experienceYears, industry, currentCompany, keywords };
}

/**
 * Convert extracted traits to LinkedIn search filters.
 */
export function traitsToFilters(traits: ExtractedTraits): Partial<LinkedInFiltersState> {
  const filters: Partial<LinkedInFiltersState> = {};

  if (traits.keywords) {
    filters.keywords = traits.keywords;
  }

  if (traits.roleTitles.length > 0) {
    filters.role = [{
      keywords: traits.roleTitles.join(' OR '),
      priority: 'MUST_HAVE' as const,
      scope: 'CURRENT' as const,
    }];
  }

  if (traits.experienceYears !== null) {
    filters.calculated_experience_min = Math.max(0, traits.experienceYears - 3);
    filters.calculated_experience_max = traits.experienceYears + 3;
    filters.years_of_experience_min = null;
    filters.years_of_experience_max = null;
  }

  if (traits.skills.length > 0) {
    filters.skills = traits.skills.slice(0, 8).map(s => ({
      id: s,
      name: s,
      priority: 'CAN_HAVE' as const,
    }));
  }

  if (traits.currentCompany) {
    filters.company_keywords = [{
      keywords: traits.currentCompany,
      priority: 'DOESNT_HAVE' as const,
      scope: 'CURRENT' as const,
    }];
  }

  return filters;
}
