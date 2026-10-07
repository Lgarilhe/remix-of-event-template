import { ProfileDetailedTab } from '@/components/ats/candidate-detail/ProfileDetailedTab';
import type { LinkedInProfile } from '@/components/outreach/types';
import { parseDate } from '@/components/outreach/dateUtils';
import { normalizeCandidateProfile } from '@/lib/candidateProfile';

/** Reprend la fiche Profil existante, avec ses logos et ses listes dépliables. */
export function CandidateProfileContent({ profile }: { profile: LinkedInProfile }) {
  const data = normalizeCandidateProfile(profile, profile.id, profile.name);
  const detailedProfile = {
    ...data,
    work_experience: data.work_experience?.map(job => ({ ...job, start: parseDate(job.start), end: parseDate(job.end) })),
    education: data.education?.map(school => ({ ...school, school_logo: school.school_picture_url, start: parseDate(school.start), end: parseDate(school.end) })),
  };
  return <div className="min-w-0 [overflow-wrap:anywhere]" data-component="candidate-profile">
    <ProfileDetailedTab
      linkedinProfileData={detailedProfile}
      enrichedProfile={{
        name: data.name || '',
        summary: data.summary,
        skills: data.skills?.map(skill => skill.name),
        languages: data.languages?.map(language => [language.name, language.proficiency].filter(Boolean).join(' · ')),
      }}
    />
  </div>;
}
