import { useMemo } from 'react';
import { LinkedInProfile } from '../types';
import { ProfileData } from './types';

const getTenureDisplay = (start?: { year?: number; month?: number }, end?: { year?: number; month?: number }) => {
  if (!start?.year) return null;
  const startDate = new Date(start.year, (start.month || 1) - 1);
  const endDate = end?.year ? new Date(end.year, (end.month || 12) - 1) : new Date();
  const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
  const years = Math.floor(diffMonths / 12);
  const months = diffMonths % 12;
  if (years > 0 && months > 0) return `${years} an${years > 1 ? 's' : ''} ${months} mois`;
  if (years > 0) return `${years} an${years > 1 ? 's' : ''}`;
  if (months > 0) return `${months} mois`;
  return null;
};

const calculateExperienceFromDiploma = (education: any[]) => {
  if (!education || education.length === 0) return null;

  const relevantDegreeKeywords = [
    'bachelor', 'licence', 'bac+3', 'bac +3',
    'master', 'msc', 'm.sc', 'bac+5', 'bac +5', 'maîtrise',
    'mba',
    'ingénieur', 'engineer', 'engineering',
    'phd', 'doctorat', 'doctorate', 'bac+8', 'bac +8',
    'diplôme', 'degree', 'graduate',
    'grande école', 'grande ecole'
  ];

  const relevantEducation = education
    .filter((edu: any) => {
      if (!edu.end?.year) return false;
      const combined = `${(edu.degree || '').toLowerCase()} ${(edu.school || '').toLowerCase()} ${(edu.field_of_study || '').toLowerCase()}`;
      return relevantDegreeKeywords.some(keyword => combined.includes(keyword));
    })
    .sort((a: any, b: any) => (b.end?.year || 0) - (a.end?.year || 0));

  const diplomaToUse = relevantEducation[0] ||
    education.filter((edu: any) => edu.end?.year).sort((a: any, b: any) => (b.end?.year || 0) - (a.end?.year || 0))[0];

  if (!diplomaToUse?.end?.year) return null;

  const diplomaYear = diplomaToUse.end.year;
  const currentYear = new Date().getFullYear();
  const yearsOfExperience = currentYear - diplomaYear;

  if (yearsOfExperience <= 0) return null;
  return {
    years: yearsOfExperience,
    diplomaYear,
    diplomaName: diplomaToUse.degree || diplomaToUse.school,
  };
};

export function useProfileData(profile: LinkedInProfile): ProfileData {
  return useMemo(() => {
    const firstName = profile.first_name || profile.name?.split(' ')[0] || '';
    const lastName = profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '';
    const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
    const fullName = profile.name || `${firstName} ${lastName}`.trim();

    const workExperience = profile.work_experience || [];
    const currentJobs = workExperience.filter((exp: any) => !exp.end);
    const currentJob = currentJobs[0] || workExperience[0];
    const otherCurrentJobs = currentJobs.slice(1);
    const pastJobs = workExperience.filter((exp: any) => exp.end).slice(0, 5);

    const currentPosition = profile.current_positions?.[0];
    const currentCompany = currentJob?.company || currentPosition?.company;
    const currentRole = currentJob?.role || currentPosition?.role;

    const networkDistance = typeof profile.network_distance === 'string'
      ? parseInt(profile.network_distance.replace('DISTANCE_', ''))
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

    const experienceFromDiploma = calculateExperienceFromDiploma(education);
    const totalExperience = experienceFromDiploma
      ? `${experienceFromDiploma.years} an${experienceFromDiploma.years > 1 ? 's' : ''} d'exp.`
      : null;

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
