import { LinkedInProfile } from '@/components/outreach/types';

export interface CandidateState {
  removed: boolean;
  skipped: boolean;
}

export type CandidateStatesMap = Map<string, CandidateState>;

export interface CandidateScore {
  score: number | null;
  recommendation: string | null;
  scoringDetails: any;
  jobTitle: string | null;
}

export function computeYearsOfExperience(profile: LinkedInProfile): number | undefined {
  const exps = profile.work_experience || [];
  if (exps.length === 0) return undefined;
  let earliest = 9999;
  for (const exp of exps) {
    const start = (exp as any).start_date || (exp as any).starts_at || exp.start;
    if (start) {
      let year: number;
      if (typeof start === 'object' && start?.year) year = start.year;
      else if (typeof start === 'string') year = parseInt(start.split('-')[0]);
      else year = 9999;
      if (year < earliest) earliest = year;
    }
  }
  return earliest < 9999 ? new Date().getFullYear() - earliest : undefined;
}

export function getChannelAvailability(profile: LinkedInProfile) {
  return {
    email: !!(profile.contact_info?.emails?.length),
    linkedin: true, // always have LinkedIn if they're in the list
    whatsapp: !!(profile.contact_info?.phones?.length),
  };
}
