import { LinkedInProfile } from './types';
import { getYear } from './dateUtils';

// Relevant degree types that mark the start of professional career
const RELEVANT_DEGREES = [
  'bachelor', 'licence', 'bsc', 'ba', 'bba',
  'master', 'msc', 'ma', 'mba', 'ms',
  'ingénieur', 'engineer', 'engineering',
  'phd', 'doctorat', 'doctorate', 'dr',
  'diplôme', 'diploma',
];

/**
 * Calculate years of experience based on education end date.
 */
export function calculateExperienceFromEducation(profile: LinkedInProfile): number | null {
  const currentYear = new Date().getFullYear();

  if (profile.education && profile.education.length > 0) {
    let mostRecentRelevantYear: number | null = null;

    for (const edu of profile.education) {
      const endYear = getYear(edu.end);
      if (!endYear) continue;

      const degreeText = (edu.degree || '').toLowerCase();
      const fieldText = (edu.field_of_study || '').toLowerCase();
      const combinedText = `${degreeText} ${fieldText}`;

      const isRelevantDegree = RELEVANT_DEGREES.some(d => combinedText.includes(d));

      if (isRelevantDegree) {
        if (mostRecentRelevantYear === null || endYear > mostRecentRelevantYear) {
          mostRecentRelevantYear = endYear;
        }
      }
    }

    if (mostRecentRelevantYear === null) {
      for (const edu of profile.education) {
        const endYear = getYear(edu.end);
        if (endYear) {
          if (mostRecentRelevantYear === null || endYear > mostRecentRelevantYear) {
            mostRecentRelevantYear = endYear;
          }
        }
      }
    }

    if (mostRecentRelevantYear !== null) {
      const experience = currentYear - mostRecentRelevantYear;
      if (experience >= 0 && experience <= 50) {
        return experience;
      }
    }
  }

  // Fallback: use earliest work experience start date
  const workExperience = profile.work_experience || [];
  if (workExperience.length > 0) {
    let earliestYear: number | null = null;
    for (const exp of workExperience) {
      const startYear = getYear(exp.start);
      if (startYear && startYear > 1970) {
        if (!earliestYear || startYear < earliestYear) {
          earliestYear = startYear;
        }
      }
    }
    if (earliestYear) {
      const experience = currentYear - earliestYear;
      if (experience >= 0 && experience <= 50) {
        return experience;
      }
    }
  }

  return null;
}

/**
 * Filter profiles based on calculated experience range.
 */
export function filterByCalculatedExperience(
  profiles: LinkedInProfile[],
  minYears: number | null,
  maxYears: number | null
): LinkedInProfile[] {
  if (minYears === null) {
    return profiles;
  }

  return profiles.filter(profile => {
    const experience = calculateExperienceFromEducation(profile);
    if (experience === null) return true;
    if (experience < minYears) return false;
    return true;
  });
}
