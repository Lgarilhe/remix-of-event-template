import { LinkedInProfile } from './types';

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
 * Uses the most recent relevant diploma (Bachelor, Master, MBA, etc.)
 * as the starting point of professional career.
 * 
 * @param profile LinkedIn profile with education data
 * @returns Estimated years of experience, or null if cannot be calculated
 */
export function calculateExperienceFromEducation(profile: LinkedInProfile): number | null {
  if (!profile.education || profile.education.length === 0) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  let mostRecentRelevantYear: number | null = null;

  for (const edu of profile.education) {
    const endYear = edu.end?.year;
    if (!endYear) continue;

    // Check if this is a relevant degree
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

  // If no relevant degree found, try to use any education end date
  if (mostRecentRelevantYear === null) {
    for (const edu of profile.education) {
      const endYear = edu.end?.year;
      if (endYear) {
        if (mostRecentRelevantYear === null || endYear > mostRecentRelevantYear) {
          mostRecentRelevantYear = endYear;
        }
      }
    }
  }

  if (mostRecentRelevantYear === null) {
    return null;
  }

  // Calculate experience: current year - graduation year
  const experience = currentYear - mostRecentRelevantYear;
  
  // Sanity check: experience should be between 0 and 50 years
  if (experience < 0 || experience > 50) {
    return null;
  }

  return experience;
}

/**
 * Filter profiles based on calculated experience range.
 * 
 * IMPORTANT: Only the MINIMUM is strictly enforced (too junior = blocking).
 * The MAXIMUM is NOT enforced - senior profiles are allowed through and
 * evaluated by the AI scoring system instead of being excluded.
 * 
 * @param profiles Array of LinkedIn profiles
 * @param minYears Minimum years of experience (inclusive), null for no minimum
 * @param maxYears Maximum years of experience - IGNORED (kept for API compatibility)
 * @returns Filtered profiles that match the minimum experience criteria
 */
export function filterByCalculatedExperience(
  profiles: LinkedInProfile[],
  minYears: number | null,
  maxYears: number | null // Intentionally ignored - seniors are evaluated by scoring, not excluded
): LinkedInProfile[] {
  // If no minimum filter set, return all profiles
  if (minYears === null) {
    return profiles;
  }

  return profiles.filter(profile => {
    const experience = calculateExperienceFromEducation(profile);
    
    // If we can't calculate experience, include the profile (don't exclude due to missing data)
    if (experience === null) {
      return true;
    }

    // Only check minimum - too junior is blocking
    // Maximum is NOT checked - senior profiles pass through to scoring
    if (experience < minYears) {
      return false;
    }

    return true;
  });
}
