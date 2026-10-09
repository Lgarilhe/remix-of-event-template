import type { LinkedInProfile } from './types';
import { assessProfileExperience, matchesCalculatedExperience } from '../../../supabase/functions/_shared/profile-experience.ts';

/** Kept for existing callers; only dated work provides a verifiable career duration. */
export function calculateExperienceFromEducation(profile: LinkedInProfile): number | null {
  const experience = assessProfileExperience(profile);
  return experience.source === 'work' && experience.complete ? experience.years : null;
}

export function filterByCalculatedExperience(
  profiles: LinkedInProfile[], minYears: number | null, maxYears: number | null,
): LinkedInProfile[] {
  if (minYears === null && maxYears === null) return profiles;
  return profiles.filter(profile => matchesCalculatedExperience(profile, minYears, maxYears));
}
