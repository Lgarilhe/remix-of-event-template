/**
 * Pre-Score Mécanique — Scoring instantané côté client, zéro LLM.
 * Déterministe, gratuit, transparent.
 */
import { LinkedInProfile } from '@/components/outreach/types';
import { Job } from '@/types/jobs';
import { SKILL_SYNONYMS, skillsMatch } from './skillSynonyms';

export interface PreScoreResult {
  preScore: number;            // 0-100
  tier: 'high' | 'medium' | 'low';
  breakdown: {
    skills: number;            // 0-40
    experience: number;        // 0-20
    seniority: number;         // 0-15
    location: number;          // 0-10
    receptivity: number;       // 0-10
    tenure: number;            // 0-5
  };
  flags: string[];
}

// ─── Skills (40 pts) ────────────────────────────────────────────────

function extractSkillsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    if (lower.includes(canonical) || synonyms.some(s => lower.includes(s))) {
      found.push(canonical);
    }
  }
  return found;
}

function extractAllSkills(profile: LinkedInProfile): string[] {
  const skills = new Set<string>();

  // Declared skills
  (profile.skills || []).forEach(s => {
    const name = typeof s === 'string' ? s : s.name;
    if (name) skills.add(name.toLowerCase());
  });

  // From headline
  if (profile.headline) {
    extractSkillsFromText(profile.headline).forEach(s => skills.add(s));
  }

  // From work experience titles + skills
  (profile.work_experience || []).forEach(w => {
    if (w.role) extractSkillsFromText(w.role).forEach(s => skills.add(s));
    if (w.skills) w.skills.forEach(s => {
      const name = typeof s === 'string' ? s : s.name;
      if (name) skills.add(name.toLowerCase());
    });
  });

  return Array.from(skills);
}

function parseCriteriaToSkills(criteria: string | undefined): string[] {
  if (!criteria) return [];
  const found: string[] = [];
  const lower = criteria.toLowerCase();
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    if (lower.includes(canonical) || synonyms.some(s => lower.includes(s))) {
      found.push(canonical);
    }
  }
  return found;
}

function countMatches(profileSkills: string[], targetSkills: string[]): number {
  if (targetSkills.length === 0) return 0;
  let matched = 0;
  for (const target of targetSkills) {
    if (profileSkills.some(ps => skillsMatch(ps, target))) matched++;
  }
  return matched;
}

function scoreSkills(
  profileSkills: string[],
  job: Job,
  jobSkills: string[],
  flags: string[],
): number {
  const mustHaveSkills = parseCriteriaToSkills(job.mustHave);
  const shouldHaveSkills = parseCriteriaToSkills(job.shouldHave);
  const niceToHaveSkills = parseCriteriaToSkills(job.niceToHave);

  const mustHaveMatched = countMatches(profileSkills, mustHaveSkills);
  const shouldHaveMatched = countMatches(profileSkills, shouldHaveSkills);
  const niceToHaveMatched = countMatches(profileSkills, niceToHaveSkills);
  const baseMatched = countMatches(profileSkills, jobSkills);

  let score = 0;

  // Must-have
  if (mustHaveSkills.length > 0) {
    const mustHaveScore = mustHaveMatched * 8 - (mustHaveSkills.length - mustHaveMatched) * 5;
    score += Math.max(0, mustHaveScore);
    if (mustHaveMatched === 0) {
      flags.push('Aucun must-have matché');
      return 0; // Critical rule
    }
    // Base skills at reduced weight when must-have exists
    if (jobSkills.length > 0) {
      score += Math.round((baseMatched / jobSkills.length) * 10);
    }
  } else {
    // No must-have defined → base skills get full weight
    if (jobSkills.length > 0) {
      score += Math.round((baseMatched / jobSkills.length) * 20);
    }
  }

  // Should-have (max 12)
  score += Math.min(12, shouldHaveMatched * 4);

  // Nice-to-have (max 4)
  score += Math.min(4, niceToHaveMatched * 2);

  return Math.min(40, score);
}

// ─── Experience (20 pts) ────────────────────────────────────────────

function calculateExperienceFromProfile(profile: LinkedInProfile): number | null {
  // Try education end date
  const edu = profile.education || [];
  let earliestGradYear: number | null = null;
  for (const e of edu) {
    const endYear = e.end?.year;
    if (endYear && endYear > 1970 && endYear < new Date().getFullYear() + 2) {
      if (!earliestGradYear || endYear < earliestGradYear) {
        earliestGradYear = endYear;
      }
    }
  }
  if (earliestGradYear) {
    return new Date().getFullYear() - earliestGradYear;
  }

  // Try from work experience
  const work = profile.work_experience || [];
  if (work.length > 0) {
    let earliestYear: number | null = null;
    for (const w of work) {
      const startYear = w.start?.year;
      if (startYear && startYear > 1970) {
        if (!earliestYear || startYear < earliestYear) {
          earliestYear = startYear;
        }
      }
    }
    if (earliestYear) {
      return new Date().getFullYear() - earliestYear;
    }
  }

  return null;
}

function scoreExperience(profile: LinkedInProfile, job: Job, flags: string[]): number {
  const candidateXP = calculateExperienceFromProfile(profile);

  if (candidateXP === null) {
    flags.push('XP non déterminée');
    return 10; // neutral
  }

  const min = job.xpMin ?? 0;
  const max = job.xpMax ?? 99;

  if (candidateXP >= min && candidateXP <= max) {
    return 20;
  } else if (candidateXP >= min && candidateXP <= max + 5) {
    flags.push(`XP ${candidateXP}a (max ${max}a)`);
    return 15;
  } else if (candidateXP >= min - 1 && candidateXP < min) {
    flags.push(`XP limite : ${candidateXP}a (min ${min}a)`);
    return 12;
  } else if (candidateXP > max + 5) {
    flags.push(`Surqualifié : ${candidateXP}a`);
    return 8;
  } else {
    flags.push(`XP insuffisante : ${candidateXP}a < ${min}a`);
    return 0;
  }
}

// ─── Seniority (15 pts) ─────────────────────────────────────────────

const SENIORITY_PATTERNS: Array<[RegExp, number]> = [
  [/\b(intern|internship|stagiaire|apprenti|trainee|graduate|alternant)\b/i, 1],
  [/\b(associate|analyst|consultant|junior)\b/i, 2],
  [/\b(senior|sr\.|confirmé|expérimenté|principal|staff)\b/i, 3],
  [/\b(lead|tech lead|team lead)\b/i, 4],
  [/\b(director|directeur|head of|responsable|manager)\b/i, 5],
  [/\b(vp|vice[\s-]?president|svp|evp)\b/i, 6],
  [/\b(ceo|cto|cfo|coo|cio|chro|chief|c-level|founder|co-founder|fondateur|président|president|managing director)\b/i, 7],
];

function inferSeniorityLevel(headline?: string, role?: string): number | null {
  const text = [headline, role].filter(Boolean).join(' ');
  if (!text) return null;

  // Check from highest to lowest for the most senior match
  for (let i = SENIORITY_PATTERNS.length - 1; i >= 0; i--) {
    if (SENIORITY_PATTERNS[i][0].test(text)) {
      return SENIORITY_PATTERNS[i][1];
    }
  }
  return null;
}

function parseSeniorityLevel(seniority?: string): number | null {
  if (!seniority) return null;
  const lower = seniority.toLowerCase();
  if (lower.includes('junior') || lower.includes('débutant') || lower.includes('entry')) return 1;
  if (lower.includes('associé') || lower.includes('associate')) return 2;
  if (lower.includes('senior') || lower.includes('confirmé') || lower.includes('intermédiaire') || lower.includes('mid')) return 3;
  if (lower.includes('lead') || lower.includes('staff') || lower.includes('principal')) return 4;
  if (lower.includes('manager') || lower.includes('directeur') || lower.includes('director')) return 5;
  if (lower.includes('vp')) return 6;
  if (lower.includes('c-level') || lower.includes('cxo')) return 7;
  return null;
}

function scoreSeniority(profile: LinkedInProfile, job: Job, flags: string[]): number {
  const currentRole = profile.work_experience?.find(w => !w.end)?.role;
  const candidateLevel = inferSeniorityLevel(profile.headline, currentRole);
  const jobLevel = parseSeniorityLevel(job.seniority);

  if (candidateLevel === null || jobLevel === null) return 8; // neutral

  const delta = candidateLevel - jobLevel;
  if (delta === 0) return 15;
  if (delta === 1) { flags.push('Légèrement senior'); return 12; }
  if (delta === -1) { flags.push('Légèrement junior'); return 10; }
  flags.push('Mismatch séniorité');
  return 3;
}

// ─── Location (10 pts) ──────────────────────────────────────────────

const CITY_REGION_MAP: Record<string, string[]> = {
  'paris': ['île-de-france', 'idf', 'region parisienne', 'ile-de-france'],
  'lyon': ['rhône-alpes', 'auvergne-rhône-alpes', 'rhone-alpes'],
  'marseille': ['provence', 'paca', 'bouches-du-rhône'],
  'toulouse': ['occitanie', 'haute-garonne'],
  'nantes': ['pays de la loire', 'loire-atlantique'],
  'bordeaux': ['nouvelle-aquitaine', 'gironde'],
  'lille': ['hauts-de-france', 'nord'],
  'strasbourg': ['grand est', 'alsace', 'bas-rhin'],
  'rennes': ['bretagne', 'ille-et-vilaine'],
  'montpellier': ['occitanie', 'hérault'],
};

function compareLocations(profileLoc: string, jobLoc: string): { score: number } {
  const normalize = (s: string) => s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*(area|région|métropole|cedex|greater)\s*/g, '')
    .trim();

  const p = normalize(profileLoc);
  const j = normalize(jobLoc);

  if (p.includes(j) || j.includes(p)) return { score: 10 };

  // Same city/region
  for (const [city, regions] of Object.entries(CITY_REGION_MAP)) {
    const pInCity = p.includes(city) || regions.some(r => p.includes(r));
    const jInCity = j.includes(city) || regions.some(r => j.includes(r));
    if (pInCity && jInCity) return { score: 10 };
  }

  // Same country
  const isFrance = (s: string) =>
    s.includes('france') || Object.keys(CITY_REGION_MAP).some(c => s.includes(c));
  if (isFrance(p) && isFrance(j)) return { score: 5 };

  return { score: 2 };
}

function scoreLocation(profile: LinkedInProfile, job: Job, flags: string[]): number {
  if (job.remote === 'full_remote' || job.remote === 'remote' || job.remote === 'Full Remote') {
    return 10;
  }
  if (!profile.location || !job.location) {
    flags.push('Localisation non vérifiable');
    return 5;
  }
  const result = compareLocations(profile.location, job.location);
  if (result.score < 5) {
    flags.push(`Localisation : ${profile.location}`);
  }
  return result.score;
}

// ─── Receptivity (10 pts) ───────────────────────────────────────────

function scoreReceptivity(profile: LinkedInProfile, flags: string[]): number {
  let score = 0;
  if (profile.open_to_work) { score += 5; flags.push('Open to Work'); }
  if ((profile as any).open_profile) score += 3;

  const nd = typeof profile.network_distance === 'number'
    ? profile.network_distance
    : typeof profile.network_distance === 'string'
      ? parseInt(profile.network_distance, 10)
      : null;

  if (nd === 1) score += 2;
  else if (nd === 2) score += 1;

  return Math.min(10, score);
}

// ─── Tenure (5 pts) ─────────────────────────────────────────────────

function scoreTenure(profile: LinkedInProfile, flags: string[]): number {
  const work = profile.work_experience || [];
  if (work.length < 2) return 3; // not enough data

  const now = new Date();
  let totalMonths = 0;
  let count = 0;

  for (const w of work) {
    if (!w.start?.year) continue;
    const startDate = new Date(w.start.year, (w.start.month || 1) - 1);
    const endDate = w.end?.year
      ? new Date(w.end.year, (w.end.month || 1) - 1)
      : now;
    const months = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
    totalMonths += months;
    count++;
  }

  if (count === 0) return 3;

  const avgMonths = totalMonths / count;

  if (avgMonths >= 24) return 5;
  if (avgMonths >= 18) return 4;
  if (avgMonths >= 12) {
    flags.push(`Tenure courte (~${Math.round(avgMonths)} mois)`);
    return 2;
  }
  flags.push('Tenure très courte (<12 mois)');
  return 0;
}

// ─── Main ───────────────────────────────────────────────────────────

export function calculatePreScore(
  profile: LinkedInProfile,
  job: Job,
  jobSkills: string[],
): PreScoreResult {
  const flags: string[] = [];
  const profileSkills = extractAllSkills(profile);

  const skills = scoreSkills(profileSkills, job, jobSkills, flags);
  const experience = scoreExperience(profile, job, flags);
  const seniority = scoreSeniority(profile, job, flags);
  const location = scoreLocation(profile, job, flags);
  const receptivity = scoreReceptivity(profile, flags);
  const tenure = scoreTenure(profile, flags);

  const total = skills + experience + seniority + location + receptivity + tenure;
  const preScore = Math.max(0, Math.min(100, total));

  const tier: 'high' | 'medium' | 'low' =
    preScore >= 60 ? 'high' :
    preScore >= 30 ? 'medium' : 'low';

  return {
    preScore,
    tier,
    breakdown: { skills, experience, seniority, location, receptivity, tenure },
    flags,
  };
}
