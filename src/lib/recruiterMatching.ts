/**
 * §4.4 — Matching algorithm: recruiter ↔ mission
 * Calculates a match score between a recruiter profile and a hunt mission.
 * Used in the marketplace to rank recruiters for a mission.
 */

import type { JobDetails } from '@/types/jobDetails';

export interface RecruiterProfile {
  user_id: string;
  display_name: string | null;
  specializations: string[] | null;
  linkedin_skills: string[] | null;
  years_experience: number | null;
  rating: number | null;
  placements_count: number | null;
  avg_time_to_fill_days: number | null;
  first_round_rate: number | null;
  mid_round_rate: number | null;
  active_missions_count?: number;
  location?: string | null;
}

export interface MissionForMatching {
  job_details: JobDetails;
  client_name: string | null;
}

export interface RecruiterMatchScore {
  overall: number;
  specialization_match: number;
  sector_match: number;
  seniority_match: number;
  location_match: number;
  performance: number;
  availability: number;
  badges: string[];
}

/** Compute match score between a recruiter and a mission */
export function computeRecruiterMatchScore(
  recruiter: RecruiterProfile,
  mission: MissionForMatching
): RecruiterMatchScore {
  const jd = mission.job_details || {};
  const recruiterSkills = [
    ...(recruiter.specializations || []),
    ...(recruiter.linkedin_skills || []),
  ].map(s => (typeof s === 'string' ? s : '').toLowerCase());

  // 1. Specialization match (0-100)
  const jobSkills = [
    ...(jd.skills_must_have || []),
    ...(jd.skills_should_have || []),
    ...(jd.skills_nice_to_have || []),
  ].map(s => s.toLowerCase());

  let specializationMatch = 0;
  if (jobSkills.length > 0 && recruiterSkills.length > 0) {
    const matching = jobSkills.filter(js =>
      recruiterSkills.some(rs => rs.includes(js) || js.includes(rs))
    );
    specializationMatch = Math.min(100, Math.round((matching.length / Math.min(jobSkills.length, 5)) * 100));
  }

  // 2. Sector match (0-100)
  let sectorMatch = 50; // Default: neutral
  const clientSector = jd.client?.sector?.toLowerCase();
  if (clientSector && recruiterSkills.length > 0) {
    const sectorKeywords = clientSector.split(/[\s,/]+/);
    const hasSectorMatch = sectorKeywords.some(kw =>
      recruiterSkills.some(rs => rs.includes(kw) || kw.includes(rs))
    );
    sectorMatch = hasSectorMatch ? 90 : 30;
  }

  // 3. Seniority match (0-100)
  let seniorityMatch = 50;
  const jobSeniority = jd.seniority?.toLowerCase() || '';
  const recruiterXP = recruiter.years_experience || 0;
  if (jobSeniority.includes('junior') || jobSeniority.includes('stage')) {
    seniorityMatch = recruiterXP >= 2 ? 80 : 60;
  } else if (jobSeniority.includes('senior') || jobSeniority.includes('lead')) {
    seniorityMatch = recruiterXP >= 5 ? 90 : recruiterXP >= 3 ? 70 : 40;
  } else if (jobSeniority.includes('director') || jobSeniority.includes('vp') || jobSeniority.includes('c-level')) {
    seniorityMatch = recruiterXP >= 8 ? 95 : recruiterXP >= 5 ? 70 : 30;
  }

  // 4. Location match (0-100)
  let locationMatch = 50;
  const jobLocation = jd.location?.toLowerCase() || '';
  const recruiterLocation = (recruiter.location || '').toLowerCase();
  if (jobLocation && recruiterLocation) {
    const jobCity = jobLocation.split(',')[0].trim();
    const recruiterCity = recruiterLocation.split(',')[0].trim();
    if (recruiterCity.includes(jobCity) || jobCity.includes(recruiterCity)) {
      locationMatch = 100;
    } else if (jd.remote_policy === 'full_remote') {
      locationMatch = 80; // Remote job = location less important
    }
  } else if (jd.remote_policy === 'full_remote') {
    locationMatch = 80;
  }

  // 5. Performance (0-100)
  let performance = 50;
  const rating = recruiter.rating || 0;
  const firstRoundRate = recruiter.first_round_rate || 0;
  const placements = recruiter.placements_count || 0;
  if (rating > 0) performance = Math.min(100, Math.round(rating * 20));
  if (firstRoundRate > 0) performance = Math.round((performance + firstRoundRate * 100) / 2);
  if (placements >= 20) performance = Math.min(100, performance + 10);

  // 6. Availability (0-100)
  const activeMissions = recruiter.active_missions_count || 0;
  const availability = activeMissions === 0 ? 100 :
    activeMissions <= 2 ? 80 :
    activeMissions <= 5 ? 50 :
    20;

  // Overall weighted score
  const overall = Math.round(
    specializationMatch * 0.30 +
    sectorMatch * 0.15 +
    seniorityMatch * 0.10 +
    locationMatch * 0.10 +
    performance * 0.25 +
    availability * 0.10
  );

  // Generate badges
  const badges: string[] = [];
  if (overall >= 85) badges.push('🏆 Top match');
  if (specializationMatch >= 80) badges.push(`⭐ Spécialiste ${jd.skills_must_have?.[0] || 'du domaine'}`);
  if (clientSector && sectorMatch >= 80) badges.push(`🏢 Expert ${jd.client?.sector || 'secteur'}`);
  if (recruiter.avg_time_to_fill_days && recruiter.avg_time_to_fill_days <= 21) {
    badges.push(`🚀 Rapide (${recruiter.avg_time_to_fill_days}j avg)`);
  }
  if (rating && rating >= 4.5) badges.push('⭐ Top rated');
  if (availability >= 90) badges.push('✅ Disponible');
  if (placements >= 50) badges.push('🎯 50+ placements');

  return {
    overall,
    specialization_match: specializationMatch,
    sector_match: sectorMatch,
    seniority_match: seniorityMatch,
    location_match: locationMatch,
    performance,
    availability,
    badges,
  };
}

/** Sort recruiters by match score (highest first) */
export function rankRecruiters(
  recruiters: RecruiterProfile[],
  mission: MissionForMatching
): Array<{ recruiter: RecruiterProfile; score: RecruiterMatchScore }> {
  return recruiters
    .map(recruiter => ({
      recruiter,
      score: computeRecruiterMatchScore(recruiter, mission),
    }))
    .sort((a, b) => b.score.overall - a.score.overall);
}
