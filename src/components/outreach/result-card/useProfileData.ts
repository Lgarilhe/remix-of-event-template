import { useMemo } from 'react';
import { LinkedInProfile } from '../types';
import { ProfileData } from './types';
import { parseDate } from '../dateUtils';
import { assessProfileExperience } from '../../../../supabase/functions/_shared/profile-experience.ts';

const getTenureDisplay = (start?: any, end?: any) => {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s?.year) return null;
  const startDate = new Date(s.year, (s.month || 1) - 1);
  const endDate = e?.year ? new Date(e.year, (e.month || 12) - 1) : new Date();
  const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
  const years = Math.floor(diffMonths / 12);
  const months = diffMonths % 12;
  if (years > 0 && months > 0) return `${years} an${years > 1 ? 's' : ''} ${months} mois`;
  if (years > 0) return `${years} an${years > 1 ? 's' : ''}`;
  if (months > 0) return `${months} mois`;
  return null;
};

export function useProfileData(profile: LinkedInProfile): ProfileData {
  return useMemo(() => {
    const firstName = profile.first_name || profile.name?.split(' ')[0] || '';
    const lastName = profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '';
    const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
    const fullName = profile.name || `${firstName} ${lastName}`.trim();

    const workExperience = (profile.work_experience || []).map((exp: any) => ({
      ...exp,
      role: exp.role || exp.position, // Normalize position → role
    }));
    const currentJobs = workExperience.filter((exp: any) => !exp.end && exp.current !== false);
    const currentJob = workExperience.find((exp: any) => exp.current === true) || currentJobs[0] || workExperience[0];
    const otherCurrentJobs = currentJobs.filter((j: any) => j !== currentJob);
    const pastJobs = workExperience.filter((exp: any) => exp.end || (exp.current === false)).slice(0, 5);

    const currentPosition = profile.current_positions?.[0];
    const currentCompany = currentJob?.company || currentPosition?.company;
    const currentRole = currentJob?.role || currentPosition?.role;

    const networkDistance = typeof profile.network_distance === 'string'
      ? parseInt(profile.network_distance.replace('DISTANCE_', '').replace('FIRST_DEGREE', '1').replace('SECOND_DEGREE', '2').replace('THIRD_DEGREE', '3'))
      : profile.network_distance;

    const profileUrl = profile.profile_url || profile.public_profile_url;
    const currentJobTenure = currentJob ? getTenureDisplay(currentJob.start, currentJob.end) : null;

    const skills = profile.skills?.slice(0, 8) || [];
    const education = profile.education || [];
    const educationPreview = education.slice(0, 2);
    const connectionsCount = profile.connections_count;

    const interests = profile.interests || [];
    const isLikelyToRespond = interests.includes('LIKELY_TO_RESPOND');
    const isActiveTalent = interests.includes('ACTIVE_TALENT');

    const experience = assessProfileExperience(profile);
    const experienceFromDiploma = null;
    const totalExperience = experience.source === 'work' && experience.years !== null
      ? `${experience.complete && !experience.approximate ? '' : '≈ '}${experience.years} an${experience.years > 1 ? 's' : ''} d'exp.${experience.complete ? '' : ' renseignée'}`
      : experience.educationYear ? `Formation ${experience.educationYear} · XP à vérifier` : null;

    return {
      firstName, lastName, initials, fullName,
      currentJob, otherCurrentJobs, pastJobs,
      currentCompany, currentRole, currentJobTenure,
      networkDistance, profileUrl, skills,
      education, educationPreview, connectionsCount,
      isLikelyToRespond, isActiveTalent,
      totalExperience, experienceFromDiploma,
    };
  }, [profile]);
}
